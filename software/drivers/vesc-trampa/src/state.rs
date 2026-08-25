use crate::protocol::VescCommandId;
use crate::vesc_trampa_proto;
use bytes::{Bytes, BytesMut};
use normfs::NormFS;
use normfs::UintN;
use parking_lot::RwLock;
use prost::Message;
use std::sync::Arc;

#[derive(Default)]
struct VescInferenceState {
    state: vesc_trampa_proto::InferenceState,
}

pub struct VescTrampaCommunicator {
    pub normfs: Arc<NormFS>,
    pub rx_queue_id: normfs::QueueId,
    pub tx_queue_id: normfs::QueueId,
    inference_queue_id: normfs::QueueId,
    inference_states_queue_id: normfs::QueueId,
    state: Arc<RwLock<VescInferenceState>>,
}

impl VescTrampaCommunicator {
    pub fn new(
        normfs: Arc<NormFS>,
        rx_queue_id: normfs::QueueId,
        tx_queue_id: normfs::QueueId,
        inference_queue_id: normfs::QueueId,
    ) -> Self {
        let inference_states_queue_id = normfs.resolve("inference-states");
        Self {
            normfs,
            rx_queue_id,
            tx_queue_id,
            inference_queue_id,
            inference_states_queue_id,
            state: Arc::new(RwLock::new(VescInferenceState::default())),
        }
    }

    fn send_envelope<M: Message>(
        &self,
        queue_id: &normfs::QueueId,
        envelope: &M,
    ) -> Result<normfs::UintN, normfs::Error> {
        let mut envelope_buf = Vec::new();
        envelope.encode(&mut envelope_buf).unwrap();
        self.normfs.enqueue(queue_id, Bytes::from(envelope_buf))
    }

    pub fn send_rx(
        &self,
        envelope: &crate::vesc_trampa_proto::RxEnvelope,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let ptr = self.send_envelope(&self.rx_queue_id, envelope)?;
        self.update_state(envelope, ptr);
        Ok(())
    }

    pub fn send_tx(
        &self,
        envelope: &crate::vesc_trampa_proto::TxEnvelope,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.send_envelope(&self.tx_queue_id, envelope)?;
        Ok(())
    }

    fn update_state(&self, envelope: &vesc_trampa_proto::RxEnvelope, ptr: UintN) {
        let Some(board) = envelope.board.as_ref() else {
            return;
        };

        match vesc_trampa_proto::VescTrampaSignalType::try_from(envelope.signal_type) {
            Ok(vesc_trampa_proto::VescTrampaSignalType::VescTrampaBoardConnect) => {
                self.add_board(board, envelope);
            }
            Ok(vesc_trampa_proto::VescTrampaSignalType::VescTrampaBoardDisconnect) => {
                self.remove_board(board);
            }
            Ok(vesc_trampa_proto::VescTrampaSignalType::VescTrampaBoardPacket) => {
                self.update_values(board, envelope, ptr);
            }
            Ok(vesc_trampa_proto::VescTrampaSignalType::VescTrampaCommand) => {}
            Ok(vesc_trampa_proto::VescTrampaSignalType::VescTrampaCommandSuccess) => {
                self.update_mode_for_command_success(board, envelope);
            }
            _ => {}
        }

        {
            let mut state = self.state.write();
            state.state.last_inference_queue_ptr = self.get_last_inference_id_bytes();
        }
        self.publish_inference_state();
    }

    fn add_board(
        &self,
        board: &vesc_trampa_proto::VescTrampaBoard,
        envelope: &vesc_trampa_proto::RxEnvelope,
    ) {
        let mut state = self.state.write();
        if state
            .state
            .boards
            .iter()
            .any(|board_state| Self::same_board(board_state.board.as_ref(), board))
        {
            return;
        }

        state
            .state
            .boards
            .push(vesc_trampa_proto::inference_state::BoardState {
                board: Some(board.clone()),
                motor_mode: vesc_trampa_proto::VescTrampaMotorMode::Unspecified as i32,
                monotonic_stamp_ns: envelope.monotonic_stamp_ns,
                local_stamp_ns: envelope.local_stamp_ns,
                app_start_id: envelope.app_start_id,
                values_payload: Bytes::new(),
                values_rx_pointer: Bytes::new(),
                values_monotonic_stamp_ns: 0,
                values_local_stamp_ns: 0,
                values_app_start_id: 0,
            });
    }

    fn remove_board(&self, board: &vesc_trampa_proto::VescTrampaBoard) {
        let mut state = self.state.write();
        state
            .state
            .boards
            .retain(|board_state| !Self::same_board(board_state.board.as_ref(), board));
    }

    fn update_values(
        &self,
        board: &vesc_trampa_proto::VescTrampaBoard,
        envelope: &vesc_trampa_proto::RxEnvelope,
        ptr: UintN,
    ) {
        let Some(packet) = envelope.board_packet.as_ref() else {
            return;
        };
        if packet.command_id != VescCommandId::GetValues.as_u32() {
            return;
        }

        let mut ptr_buf = BytesMut::with_capacity(8);
        ptr.write_value_to_buffer(&mut ptr_buf);
        let ptr_buf = ptr_buf.freeze();

        let mut state = self.state.write();
        if let Some(board_state) = state
            .state
            .boards
            .iter_mut()
            .find(|board_state| Self::same_board(board_state.board.as_ref(), board))
        {
            board_state.monotonic_stamp_ns = envelope.monotonic_stamp_ns;
            board_state.local_stamp_ns = envelope.local_stamp_ns;
            board_state.app_start_id = envelope.app_start_id;
            board_state.values_payload = packet.payload.clone();
            board_state.values_rx_pointer = ptr_buf;
            board_state.values_monotonic_stamp_ns = envelope.monotonic_stamp_ns;
            board_state.values_local_stamp_ns = envelope.local_stamp_ns;
            board_state.values_app_start_id = envelope.app_start_id;
        }
    }

    fn update_mode_for_command_success(
        &self,
        board: &vesc_trampa_proto::VescTrampaBoard,
        envelope: &vesc_trampa_proto::RxEnvelope,
    ) {
        let Some(command) = envelope.command.as_ref() else {
            return;
        };
        if !command.board_commands.is_empty() {
            self.set_motor_mode(board, vesc_trampa_proto::VescTrampaMotorMode::Unspecified);
            return;
        }

        let Some(motor_mode) = command.motor_mode.as_ref() else {
            return;
        };
        let mode = vesc_trampa_proto::VescTrampaMotorMode::try_from(motor_mode.mode)
            .unwrap_or(vesc_trampa_proto::VescTrampaMotorMode::Unspecified);
        if mode == vesc_trampa_proto::VescTrampaMotorMode::Hold {
            self.set_motor_mode(board, mode);
        }
    }

    fn set_motor_mode(
        &self,
        board: &vesc_trampa_proto::VescTrampaBoard,
        mode: vesc_trampa_proto::VescTrampaMotorMode,
    ) {
        let mut state = self.state.write();
        if let Some(board_state) = state
            .state
            .boards
            .iter_mut()
            .find(|board_state| Self::same_board(board_state.board.as_ref(), board))
        {
            board_state.motor_mode = mode as i32;
        }
    }

    fn same_board(
        state_board: Option<&vesc_trampa_proto::VescTrampaBoard>,
        board: &vesc_trampa_proto::VescTrampaBoard,
    ) -> bool {
        let Some(state_board) = state_board else {
            return false;
        };
        if !board.uuid.is_empty() || !state_board.uuid.is_empty() {
            return state_board.uuid == board.uuid;
        }
        state_board.port_name == board.port_name
    }

    fn get_last_inference_id_bytes(&self) -> Bytes {
        match self.normfs.get_last_id(&self.inference_states_queue_id) {
            Ok(id) => {
                let mut ptr_data = BytesMut::new();
                id.write_value_to_buffer(&mut ptr_data);
                ptr_data.freeze()
            }
            Err(error) => {
                log::warn!(
                    "Failed to get last inference ID from queue inference-states: {}",
                    error
                );
                Bytes::new()
            }
        }
    }

    fn publish_inference_state(&self) {
        let state = self.state.read();
        let mut buf = Vec::new();
        state.state.encode(&mut buf).unwrap();
        let data = Bytes::from(buf);
        let _ = self.normfs.enqueue(&self.inference_queue_id, data);
    }
}

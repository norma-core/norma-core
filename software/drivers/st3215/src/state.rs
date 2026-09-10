use crate::st3215_proto;
use bytes::{Bytes, BytesMut};
use log::warn;
use normfs::NormFS;
use normfs::UintN;
use prost::Message;
use station_iface::{Backpressure, WRITE_TIMEOUT, enqueue_with, try_enqueue_with};
use std::sync::atomic::AtomicBool;
use std::{collections::HashMap, sync::Arc};

type MotorBounds = HashMap<String, HashMap<u32, (u32, u32, bool)>>;
type CalibrationStops = HashMap<String, Arc<AtomicBool>>;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum CalibrationStatus {
    InProgress,
    Done,
    Failed,
    Stopped,
}

#[derive(Default)]
struct InferenceState {
    state: st3215_proto::InferenceState,
}

pub struct ST3215BusCommunicator {
    pub normfs: Arc<NormFS>,
    pub rx_queue_id: normfs::QueueId,
    pub tx_queue_id: normfs::QueueId,
    pub meta_queue_id: normfs::QueueId,
    inference_queue_id: normfs::QueueId,
    inference_states_queue_id: normfs::QueueId,
    state: Arc<parking_lot::RwLock<InferenceState>>,
    bounds: Arc<parking_lot::RwLock<MotorBounds>>,
    calibration_stops: Arc<parking_lot::RwLock<CalibrationStops>>,
}

impl ST3215BusCommunicator {
    pub async fn new(
        normfs: Arc<NormFS>,
        rx_queue_id: normfs::QueueId,
        tx_queue_id: normfs::QueueId,
        meta_queue_id: normfs::QueueId,
        inference_queue_id: normfs::QueueId,
    ) -> Result<Self, normfs::Error> {
        let inference_states_queue_id = normfs.resolve("inference-states");
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&meta_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&tx_queue_id).await?;
        normfs
            .ensure_queue_exists_for_write(&inference_queue_id)
            .await?;
        Ok(Self {
            normfs,
            rx_queue_id,
            tx_queue_id,
            meta_queue_id,
            inference_queue_id,
            inference_states_queue_id,
            state: Arc::new(parking_lot::RwLock::new(InferenceState::default())),
            bounds: Arc::new(parking_lot::RwLock::new(HashMap::new())),
            calibration_stops: Arc::new(parking_lot::RwLock::new(HashMap::new())),
        })
    }

    pub fn set_calibration_stop(&self, bus_serial: &str, stop_flag: Arc<AtomicBool>) {
        self.calibration_stops
            .write()
            .insert(bus_serial.to_string(), stop_flag);
    }

    pub fn get_calibration_stop(&self, bus_serial: &str) -> Option<Arc<AtomicBool>> {
        self.calibration_stops.read().get(bus_serial).cloned()
    }

    pub fn clear_calibration_stop(&self, bus_serial: &str) {
        self.calibration_stops.write().remove(bus_serial);
    }

    pub fn update_calibration_progress(
        &self,
        bus_serial: &str,
        current_step: u32,
        total_steps: u32,
        phase: &str,
        status: CalibrationStatus,
        error_message: Option<&str>,
    ) {
        log::info!(
            "update_calibration_progress called: bus='{}', status={:?}, step={}/{}",
            bus_serial,
            status,
            current_step,
            total_steps
        );

        // Update InferenceState with calibration progress
        {
            let mut state = self.state.write();
            log::info!(
                "InferenceState has {} buses, looking for '{}'",
                state.state.buses.len(),
                bus_serial
            );
            if let Some(bus_state) = state
                .state
                .buses
                .iter_mut()
                .find(|b| b.bus.as_ref().map(|b| b.serial_number.as_str()) == Some(bus_serial))
            {
                log::info!(
                    "Updating auto_calibration for bus '{}': status={:?}, step={}/{}, phase='{}'",
                    bus_serial,
                    status,
                    current_step,
                    total_steps,
                    phase
                );
                bus_state.auto_calibration = Some(st3215_proto::AutoCalibrationState {
                    status: match status {
                        CalibrationStatus::InProgress => {
                            st3215_proto::auto_calibration_state::Status::InProgress as i32
                        }
                        CalibrationStatus::Done => {
                            st3215_proto::auto_calibration_state::Status::Done as i32
                        }
                        CalibrationStatus::Failed => {
                            st3215_proto::auto_calibration_state::Status::Failed as i32
                        }
                        CalibrationStatus::Stopped => {
                            st3215_proto::auto_calibration_state::Status::Stopped as i32
                        }
                    },
                    current_step,
                    total_steps,
                    current_phase: phase.to_string(),
                    error_message: error_message.unwrap_or("").to_string(),
                });
            } else {
                warn!(
                    "Bus '{}' not found in InferenceState when updating calibration progress",
                    bus_serial
                );
            }
            state.state.last_inference_queue_ptr = self.get_last_inference_id_bytes();
        }

        // Publish updated InferenceState
        self.publish_inference_state_now();
    }

    pub fn clear_auto_calibration(&self, bus_serial: &str) {
        // Update InferenceState to set auto_calibration to None
        {
            let mut state = self.state.write();
            if let Some(bus_state) = state
                .state
                .buses
                .iter_mut()
                .find(|b| b.bus.as_ref().map(|b| b.serial_number.as_str()) == Some(bus_serial))
            {
                bus_state.auto_calibration = None;
            }
            state.state.last_inference_queue_ptr = self.get_last_inference_id_bytes();
        }

        // Publish updated InferenceState
        self.publish_inference_state_now();
    }

    fn encode<M: Message>(envelope: &M) -> Bytes {
        let mut envelope_buf = Vec::new();
        envelope.encode(&mut envelope_buf).unwrap();
        Bytes::from(envelope_buf)
    }

    /// A skipped record does not update the inference state.
    pub async fn send_rx(
        &self,
        envelope: &st3215_proto::RxEnvelope,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let data = Self::encode(envelope);
        let policy = Self::rx_policy(envelope.signal_type);
        let id = match policy {
            Backpressure::Skip => match self.normfs.try_enqueue(&self.rx_queue_id, data) {
                Ok(id) => id,
                Err(normfs::Error::WouldBlock) => return Ok(()),
                Err(e) => return Err(Box::new(e)),
            },
            Backpressure::Keep => {
                tokio::time::timeout(WRITE_TIMEOUT, self.normfs.enqueue(&self.rx_queue_id, data))
                    .await
                    .map_err(|_| "no page became free in time")??
            }
        };
        self.update_state(envelope, id, policy).await;
        Ok(())
    }

    fn rx_policy(signal_type: i32) -> Backpressure {
        match st3215_proto::St3215SignalType::try_from(signal_type) {
            Ok(st3215_proto::St3215SignalType::St3215DriveState)
            | Ok(st3215_proto::St3215SignalType::St3215Error) => Backpressure::Skip,
            _ => Backpressure::Keep,
        }
    }

    /// Called from the commands subscriber callback; must not block.
    pub fn send_tx(&self, envelope: &st3215_proto::TxEnvelope) {
        if let Err(e) = try_enqueue_with(
            &self.normfs,
            &self.tx_queue_id,
            Self::encode(envelope),
            Backpressure::Keep,
        ) {
            warn!("Failed to publish ST3215 command echo: {e}");
        }
    }

    pub async fn send_meta(
        &self,
        envelope: &st3215_proto::MetaEnvelope,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        enqueue_with(
            &self.normfs,
            &self.meta_queue_id,
            Self::encode(envelope),
            Backpressure::Keep,
        )
        .await?;
        Ok(())
    }

    fn add_bus(&self, bus_info: &st3215_proto::St3215Bus, envelope: &st3215_proto::RxEnvelope) {
        let mut state = self.state.write();
        if state
            .state
            .buses
            .iter()
            .any(|b| b.bus.as_ref().map(|b| &b.port_name) == Some(&bus_info.port_name))
        {
            return;
        }
        state
            .state
            .buses
            .push(st3215_proto::inference_state::BusState {
                bus: Some(bus_info.clone()),
                monotonic_stamp_ns: envelope.monotonic_stamp_ns,
                system_stamp_ns: envelope.local_stamp_ns,
                app_start_id: envelope.app_start_id,
                motors: Vec::new(),
                auto_calibration: None,
            });
    }

    fn remove_bus(&self, bus_info: &st3215_proto::St3215Bus) {
        let mut state = self.state.write();
        state
            .state
            .buses
            .retain(|b| b.bus.as_ref().map(|b| &b.port_name) != Some(&bus_info.port_name));
    }

    fn update_motor_state(&self, ptr: UintN, envelope: &st3215_proto::RxEnvelope) {
        let bus_info = match &envelope.bus {
            Some(bus) => bus,
            None => unreachable!("Received drive state envelope without bus info"),
        };

        let mut ptr_buf = BytesMut::with_capacity(8);
        ptr.write_value_to_buffer(&mut ptr_buf);
        let ptr_buf = ptr_buf.freeze();

        let mut state = self.state.write();
        let bounds = self.bounds.read();
        let bus_bounds = bounds.get(&bus_info.serial_number);

        if let Some(bus_state) = state
            .state
            .buses
            .iter_mut()
            .find(|b| b.bus.as_ref().map(|b| &b.port_name) == Some(&bus_info.port_name))
        {
            bus_state.monotonic_stamp_ns = envelope.monotonic_stamp_ns;
            bus_state.system_stamp_ns = envelope.local_stamp_ns;
            bus_state.app_start_id = envelope.app_start_id;

            let motor_id = envelope.motor_id;
            if motor_id == 0 {
                log::warn!(
                    "Received motor state with motor_id 0, skipping: {:?}",
                    envelope
                );
                // skip, invalid motor id
                return;
            }

            let motor_bounds = bus_bounds.and_then(|bb| bb.get(&motor_id));
            let (range_min, range_max, range_freezed) =
                motor_bounds.copied().unwrap_or((0, 0, false));

            if let Some(motor_state) = bus_state.motors.iter_mut().find(|m| m.id == motor_id) {
                motor_state.monotonic_stamp_ns = envelope.monotonic_stamp_ns;
                motor_state.system_stamp_ns = envelope.local_stamp_ns;
                motor_state.app_start_id = envelope.app_start_id;
                motor_state.state = envelope.data.clone();
                motor_state.error = envelope.error.clone();
                motor_state.rx_pointer = ptr_buf;
                motor_state.range_min = range_min;
                motor_state.range_max = range_max;
                motor_state.range_freezed = range_freezed;
            } else {
                bus_state
                    .motors
                    .push(st3215_proto::inference_state::MotorState {
                        id: motor_id,
                        rx_pointer: ptr_buf,
                        monotonic_stamp_ns: envelope.monotonic_stamp_ns,
                        system_stamp_ns: envelope.local_stamp_ns,
                        app_start_id: envelope.app_start_id,
                        state: envelope.data.clone(),
                        error: envelope.error.clone(),
                        range_min,
                        range_max,
                        range_freezed,
                        last_command: None,
                    });
            }
        }
    }

    fn remove_motor_state(&self, bus_info: &st3215_proto::St3215Bus, motor_id: u32) {
        let mut state = self.state.write();
        if let Some(bus_state) = state
            .state
            .buses
            .iter_mut()
            .find(|b| b.bus.as_ref().map(|b| &b.port_name) == Some(&bus_info.port_name))
        {
            bus_state.motors.retain(|m| m.id != motor_id);
        }
    }

    async fn update_state(
        &self,
        envelope: &st3215_proto::RxEnvelope,
        ptr: UintN,
        policy: Backpressure,
    ) {
        let bus_info = match &envelope.bus {
            Some(bus) => bus,
            None => return,
        };

        if bus_info.serial_number.is_empty() {
            return; // skip no-serial buses
        }

        match st3215_proto::St3215SignalType::try_from(envelope.signal_type) {
            Ok(st3215_proto::St3215SignalType::St3215BusConnect) => {
                self.add_bus(bus_info, envelope)
            }
            Ok(st3215_proto::St3215SignalType::St3215BusDisconnect) => self.remove_bus(bus_info),
            Ok(st3215_proto::St3215SignalType::St3215DriveState) => {
                self.update_motor_state(ptr, envelope)
            }
            Ok(st3215_proto::St3215SignalType::St3215Error) => {
                self.update_motor_state(ptr, envelope)
            }
            Ok(st3215_proto::St3215SignalType::St3215DriveDisconnect) => {
                self.remove_motor_state(bus_info, envelope.motor_id)
            }
            Ok(st3215_proto::St3215SignalType::St3215Command) => self.update_command_result(
                bus_info,
                envelope,
                st3215_proto::CommandResult::CrProcessing,
            ),
            Ok(st3215_proto::St3215SignalType::St3215CommandSuccess) => self.update_command_result(
                bus_info,
                envelope,
                st3215_proto::CommandResult::CrSuccess,
            ),
            Ok(st3215_proto::St3215SignalType::St3215CommandRejected) => self
                .update_command_result(bus_info, envelope, st3215_proto::CommandResult::CrRejected),
            Ok(st3215_proto::St3215SignalType::St3215CommandFailed) => self.update_command_result(
                bus_info,
                envelope,
                st3215_proto::CommandResult::CrFailed,
            ),
            _ => {}
        }

        {
            let mut state = self.state.write();
            state.state.last_inference_queue_ptr = self.get_last_inference_id_bytes();
        }
        self.publish_inference_state(policy).await;
    }

    pub fn reset_bounds(&self, bus_serial: &str) {
        let mut bounds = self.bounds.write();
        bounds.remove(bus_serial);
    }

    pub fn update_bounds(
        &self,
        bus_serial: &str,
        motor_id: u32,
        min_angle: u32,
        max_angle: u32,
        range_freezed: bool,
    ) {
        let mut bounds = self.bounds.write();
        let bus_bounds = bounds.entry(bus_serial.to_string()).or_default();
        bus_bounds.insert(motor_id, (min_angle, max_angle, range_freezed));
    }

    pub fn get_bounds(&self, bus_serial: &str, motor_id: u32) -> Option<(u32, u32, bool)> {
        let bounds = self.bounds.read();
        bounds
            .get(bus_serial)
            .and_then(|bus_bounds| bus_bounds.get(&motor_id).copied())
    }

    fn update_command_result(
        &self,
        bus_info: &st3215_proto::St3215Bus,
        envelope: &st3215_proto::RxEnvelope,
        result: st3215_proto::CommandResult,
    ) {
        let motor_id = envelope.motor_id;
        if motor_id == 0 {
            log::warn!("Received command with motor_id 0, skipping: {:?}", envelope);
            return;
        }

        let command = match &envelope.command {
            Some(cmd) => cmd,
            None => {
                log::warn!("No command in envelope, skipping state update");
                return;
            }
        };

        // Check if this is a SyncWrite command (broadcast)
        if motor_id == 254 {
            // BROADCAST_ID
            if let Some(sync_write) = &command.sync_write {
                log::debug!(
                    "Updating command result for SyncWrite - {} motors, command_id: {:02X?}, result: {:?}",
                    sync_write.motors.len(),
                    command.command_id,
                    result
                );

                // Update state for each motor in the sync_write
                let mut state = self.state.write();
                if let Some(bus_state) = state
                    .state
                    .buses
                    .iter_mut()
                    .find(|b| b.bus.as_ref().map(|b| &b.port_name) == Some(&bus_info.port_name))
                {
                    for motor_write in &sync_write.motors {
                        if let Some(motor_state) = bus_state
                            .motors
                            .iter_mut()
                            .find(|m| m.id == motor_write.motor_id)
                        {
                            motor_state.last_command = Some(st3215_proto::InferenceCommandState {
                                command: Some(command.clone()),
                                result: result as i32,
                            });
                        }
                    }
                    log::debug!(
                        "Updated SyncWrite command state for {} motors, command_id: {:02X?}",
                        sync_write.motors.len(),
                        command.command_id
                    );
                } else {
                    log::warn!("Bus not found in state for SyncWrite command result update");
                }
                return;
            }
        }

        // Single motor command
        log::debug!(
            "Updating command result for motor {}, command_id: {:02X?}, result: {:?}",
            motor_id,
            command.command_id,
            result
        );

        let mut state = self.state.write();
        if let Some(bus_state) = state
            .state
            .buses
            .iter_mut()
            .find(|b| b.bus.as_ref().map(|b| &b.port_name) == Some(&bus_info.port_name))
        {
            if let Some(motor_state) = bus_state.motors.iter_mut().find(|m| m.id == motor_id) {
                motor_state.last_command = Some(st3215_proto::InferenceCommandState {
                    command: Some(command.clone()),
                    result: result as i32,
                });
                log::debug!(
                    "Successfully updated command state for motor {}, command_id: {:02X?}",
                    motor_id,
                    command.command_id
                );
            } else {
                log::warn!(
                    "Motor {} not found in bus state for command result update",
                    motor_id
                );
            }
        } else {
            log::warn!(
                "Bus {} not found in state for command result update",
                bus_info.port_name
            );
        }
    }

    fn get_last_inference_id_bytes(&self) -> Bytes {
        match self.normfs.get_last_id(&self.inference_states_queue_id) {
            Ok(id) => {
                let mut ptr_data = BytesMut::new();
                id.write_value_to_buffer(&mut ptr_data);
                ptr_data.freeze()
            }
            Err(e) => {
                warn!(
                    "Failed to get last inference ID from queue {}: {}",
                    "inference-states", e
                );
                Bytes::new()
            }
        }
    }

    fn encode_inference_state(&self) -> Bytes {
        let mut buf = Vec::new();
        self.state.read().state.encode(&mut buf).unwrap();
        Bytes::from(buf)
    }

    async fn publish_inference_state(&self, policy: Backpressure) {
        let data = self.encode_inference_state();
        if let Err(e) = enqueue_with(&self.normfs, &self.inference_queue_id, data, policy).await {
            warn!("Failed to publish ST3215 inference state: {e}");
        }
    }

    /// Synchronous; some calibration paths run inside the meta subscriber callback.
    fn publish_inference_state_now(&self) {
        let data = self.encode_inference_state();
        if let Err(e) = try_enqueue_with(
            &self.normfs,
            &self.inference_queue_id,
            data,
            Backpressure::Keep,
        ) {
            warn!("Failed to publish ST3215 inference state: {e}");
        }
    }
}

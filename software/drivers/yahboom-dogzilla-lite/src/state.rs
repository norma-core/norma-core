use crate::yahboom_dogzilla_lite_proto::{
    self, YahboomDogzillaLiteDevice, YahboomDogzillaLiteSignalType, InferenceState, RxEnvelope, TxEnvelope,
};
use bytes::{Bytes, BytesMut};
use log::warn;
use normfs::{NormFS, UintN};
use prost::Message;
use std::sync::Arc;

type SendResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub(crate) struct YahboomDogzillaLiteCommunicator {
    pub(crate) normfs: Arc<NormFS>,
    pub(crate) rx_queue_id: normfs::QueueId,
    pub(crate) tx_queue_id: normfs::QueueId,
    pub(crate) inference_queue_id: normfs::QueueId,
    inference_states_queue_id: normfs::QueueId,
    state: Arc<parking_lot::RwLock<InferenceState>>,
}

impl YahboomDogzillaLiteCommunicator {
    pub(crate) fn new(
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
            state: Arc::new(parking_lot::RwLock::new(InferenceState::default())),
        }
    }

    pub(crate) fn send_rx(&self, envelope: &RxEnvelope) -> SendResult<()> {
        self.send_envelope(&self.rx_queue_id, envelope)?;
        if let Err(e) = self.update_state(envelope) {
            warn!("Failed to update YAHBOOM_DOGZILLA_LITE inference state: {}", e);
        }
        Ok(())
    }

    pub(crate) fn send_tx(&self, envelope: &TxEnvelope) -> SendResult<()> {
        self.send_envelope(&self.tx_queue_id, envelope)?;
        Ok(())
    }

    fn send_envelope<M: Message>(
        &self,
        queue_id: &normfs::QueueId,
        envelope: &M,
    ) -> SendResult<UintN> {
        let mut buf = Vec::new();
        envelope.encode(&mut buf)?;
        Ok(self.normfs.enqueue(queue_id, Bytes::from(buf))?)
    }

    fn add_device(&self, device: &YahboomDogzillaLiteDevice, envelope: &RxEnvelope) {
        let mut state = self.state.write();
        if let Some(device_state) = state
            .devices
            .iter_mut()
            .find(|d| d.device.as_ref().map(|d| &d.port_name) == Some(&device.port_name))
        {
            device_state.device = Some(device.clone());
            device_state.monotonic_stamp_ns = envelope.monotonic_stamp_ns;
            device_state.system_stamp_ns = envelope.local_stamp_ns;
            device_state.is_connected = true;
            return;
        }

        state
            .devices
            .push(yahboom_dogzilla_lite_proto::inference_state::DeviceState {
                device: Some(device.clone()),
                status: None,
                monotonic_stamp_ns: envelope.monotonic_stamp_ns,
                system_stamp_ns: envelope.local_stamp_ns,
                is_connected: true,
            });
    }

    fn disconnect_device(&self, device: &YahboomDogzillaLiteDevice, envelope: &RxEnvelope) {
        let mut state = self.state.write();
        if let Some(device_state) = state
            .devices
            .iter_mut()
            .find(|d| d.device.as_ref().map(|d| &d.port_name) == Some(&device.port_name))
        {
            device_state.device = Some(device.clone());
            device_state.monotonic_stamp_ns = envelope.monotonic_stamp_ns;
            device_state.system_stamp_ns = envelope.local_stamp_ns;
            device_state.is_connected = false;
        }
    }

    fn update_device_status(&self, envelope: &RxEnvelope) {
        let device = match &envelope.device {
            Some(d) => d,
            None => return,
        };

        let mut state = self.state.write();
        if let Some(device_state) = state
            .devices
            .iter_mut()
            .find(|d| d.device.as_ref().map(|d| &d.port_name) == Some(&device.port_name))
        {
            device_state.monotonic_stamp_ns = envelope.monotonic_stamp_ns;
            device_state.system_stamp_ns = envelope.local_stamp_ns;
            device_state.status = envelope.status.clone();
            device_state.is_connected = true;
        }
    }

    fn update_state(&self, envelope: &RxEnvelope) -> SendResult<()> {
        let device = match &envelope.device {
            Some(d) => d,
            None => return Ok(()),
        };

        match YahboomDogzillaLiteSignalType::try_from(envelope.signal_type) {
            Ok(YahboomDogzillaLiteSignalType::YahboomDogzillaLiteConnected) => self.add_device(device, envelope),
            Ok(YahboomDogzillaLiteSignalType::YahboomDogzillaLiteDisconnected) => {
                self.disconnect_device(device, envelope)
            }
            Ok(YahboomDogzillaLiteSignalType::YahboomDogzillaLiteStatusUpdate | YahboomDogzillaLiteSignalType::YahboomDogzillaLiteError) => {
                self.update_device_status(envelope);
            }
            _ => {}
        }

        {
            let mut state = self.state.write();
            state.last_inference_queue_ptr = self.get_last_inference_id_bytes().to_vec();
        }

        self.publish_state()
    }

    fn publish_state(&self) -> SendResult<()> {
        let state = self.state.read();
        let mut buf = Vec::new();
        state.encode(&mut buf)?;
        self.normfs
            .enqueue(&self.inference_queue_id, Bytes::from(buf))?;
        Ok(())
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
                    "Failed to get last inference ID from queue inference-states: {}",
                    e,
                );
                Bytes::new()
            }
        }
    }
}

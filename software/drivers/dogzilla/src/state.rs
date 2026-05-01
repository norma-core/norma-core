use crate::dogzilla_proto::{
    self, DogzillaDevice, DogzillaSignalType, InferenceState, RxEnvelope, TxEnvelope,
};
use bytes::{Bytes, BytesMut};
use log::warn;
use normfs::NormFS;
use normfs::UintN;
use prost::Message;
use std::sync::Arc;

pub struct DogzillaCommunicator {
    pub normfs: Arc<NormFS>,
    pub rx_queue_id: normfs::QueueId,
    pub tx_queue_id: normfs::QueueId,
    pub inference_queue_id: normfs::QueueId,
    state: Arc<parking_lot::RwLock<InferenceState>>,
}

impl DogzillaCommunicator {
    pub fn new(
        normfs: Arc<NormFS>,
        rx_queue_id: normfs::QueueId,
        tx_queue_id: normfs::QueueId,
        inference_queue_id: normfs::QueueId,
    ) -> Self {
        Self {
            normfs,
            rx_queue_id,
            tx_queue_id,
            inference_queue_id,
            state: Arc::new(parking_lot::RwLock::new(InferenceState::default())),
        }
    }

    fn send_envelope<M: Message>(
        &self,
        queue_id: &normfs::QueueId,
        envelope: &M,
    ) -> Result<UintN, normfs::Error> {
        let mut buf = Vec::new();
        envelope.encode(&mut buf).unwrap();
        self.normfs.enqueue(queue_id, Bytes::from(buf))
    }

    pub fn send_rx(
        &self,
        envelope: &RxEnvelope,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let ptr = self.send_envelope(&self.rx_queue_id, envelope)?;
        self.update_state(envelope, ptr);
        Ok(())
    }

    pub fn send_tx(
        &self,
        envelope: &TxEnvelope,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.send_envelope(&self.tx_queue_id, envelope)?;
        Ok(())
    }

    fn add_device(&self, device: &DogzillaDevice, envelope: &RxEnvelope) {
        let mut state = self.state.write();
        if state
            .devices
            .iter()
            .any(|d| d.device.as_ref().map(|d| &d.port_name) == Some(&device.port_name))
        {
            return;
        }
        state
            .devices
            .push(dogzilla_proto::inference_state::DeviceState {
                device: Some(device.clone()),
                status: None,
                monotonic_stamp_ns: envelope.monotonic_stamp_ns,
                system_stamp_ns: envelope.local_stamp_ns,
                is_connected: true,
            });
    }

    fn remove_device(&self, device: &DogzillaDevice) {
        let mut state = self.state.write();
        state
            .devices
            .retain(|d| d.device.as_ref().map(|d| &d.port_name) != Some(&device.port_name));
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
        }
    }

    fn update_state(&self, envelope: &RxEnvelope, _ptr: UintN) {
        let device = match &envelope.device {
            Some(d) => d,
            None => return,
        };

        match DogzillaSignalType::try_from(envelope.signal_type) {
            Ok(DogzillaSignalType::DogzillaConnected) => {
                self.add_device(device, envelope);
            }
            Ok(DogzillaSignalType::DogzillaDisconnected) => {
                self.remove_device(device);
            }
            Ok(DogzillaSignalType::DogzillaStatusUpdate) => {
                self.update_device_status(envelope);
            }
            Ok(DogzillaSignalType::DogzillaError) => {
                self.update_device_status(envelope);
            }
            _ => {}
        }

        {
            let mut state = self.state.write();
            state.last_inference_queue_ptr = self.get_last_inference_id_bytes().to_vec();
        }

        let state = self.state.read();
        let mut buf = Vec::new();
        state.encode(&mut buf).unwrap();
        let data = Bytes::from(buf);

        let iptr = self.normfs.enqueue(&self.inference_queue_id, data.clone());
        if iptr.is_err() {
            warn!("Failed to enqueue inference state: {}", iptr.err().unwrap());
            return;
        }

        let _ = iptr.unwrap();
    }

    fn get_last_inference_id_bytes(&self) -> Bytes {
        match self.normfs.get_last_id(&self.inference_queue_id) {
            Ok(id) => {
                let mut ptr_data = BytesMut::new();
                id.write_value_to_buffer(&mut ptr_data);
                ptr_data.freeze()
            }
            Err(e) => {
                warn!(
                    "Failed to get last inference ID from queue dogzilla/inference: {}",
                    e
                );
                Bytes::new()
            }
        }
    }
}

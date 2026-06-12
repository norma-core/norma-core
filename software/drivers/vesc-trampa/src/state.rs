use bytes::Bytes;
use normfs::NormFS;
use prost::Message;
use std::sync::Arc;

pub struct VescTrampaCommunicator {
    pub normfs: Arc<NormFS>,
    pub rx_queue_id: normfs::QueueId,
}

impl VescTrampaCommunicator {
    pub fn new(normfs: Arc<NormFS>, rx_queue_id: normfs::QueueId) -> Self {
        Self {
            normfs,
            rx_queue_id,
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
        self.send_envelope(&self.rx_queue_id, envelope)?;
        Ok(())
    }
}

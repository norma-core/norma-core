use anyhow::Result;
use bytes::Bytes;
use normfs::NormFS;
use prost::Message;
use station_iface::iface_proto::{
    drivers::QueueDataType,
    envelope::{QueueData, QueueOpt, RootQueueEnvelope, RootQueueEnvelopeType},
};
use std::sync::Arc;

pub const MAIN_QUEUE_ID: &str = "main";

pub struct MainQueue {
    normfs: Arc<NormFS>,
    queue_id: normfs::QueueId,
    station_uuid: Bytes,
}

impl MainQueue {
    pub async fn new(normfs: Arc<NormFS>, station_uuid: Bytes) -> Result<Self> {
        let queue_id = normfs.resolve(MAIN_QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&queue_id).await?;

        Ok(Self {
            normfs,
            queue_id,
            station_uuid,
        })
    }

    pub fn send_app_start(&self) -> Result<()> {
        let envelope = self.create_envelope(RootQueueEnvelopeType::RqetAppStart, None);
        self.send_envelope(envelope)
    }

    pub fn send_queue_start(
        &self,
        queue_id: &normfs::QueueId,
        data_type: QueueDataType,
        opts: Vec<QueueOpt>,
    ) -> Result<()> {
        let queue_data = QueueData {
            id: queue_id.as_str().to_string(),
            data_type: data_type as i32,
            opts,
        };

        let envelope =
            self.create_envelope(RootQueueEnvelopeType::RqetQueueStart, Some(queue_data));
        self.send_envelope(envelope)
    }

    fn create_envelope(
        &self,
        envelope_type: RootQueueEnvelopeType,
        queue: Option<QueueData>,
    ) -> RootQueueEnvelope {
        RootQueueEnvelope {
            r#type: envelope_type as i32,
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            station_uuid: self.station_uuid.clone(),
            queue,
        }
    }

    fn send_envelope(&self, envelope: RootQueueEnvelope) -> Result<()> {
        let mut buf = Vec::new();
        envelope.encode(&mut buf)?;

        self.normfs.enqueue(&self.queue_id, Bytes::from(buf))?;

        Ok(())
    }
}

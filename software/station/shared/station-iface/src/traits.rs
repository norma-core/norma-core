use crate::iface_proto::drivers;
use crate::iface_proto::envelope::QueueOpt;

pub trait StationEngine: Send + Sync + 'static {
    fn register_queue(
        &self,
        queue_id: &normfs::QueueId,
        queue_data_type: drivers::QueueDataType,
        opts: Vec<QueueOpt>,
    );
}

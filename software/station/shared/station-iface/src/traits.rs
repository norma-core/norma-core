use crate::SnapshotGate;
use crate::iface_proto::drivers;
use crate::iface_proto::envelope::QueueOpt;

pub trait StationEngine: Send + Sync + 'static {
    fn register_queue(
        &self,
        queue_id: &normfs::QueueId,
        queue_data_type: drivers::QueueDataType,
        opts: Vec<QueueOpt>,
    );

    /// A queue that will not be written again, such as a disconnected camera's.
    fn unregister_queue(&self, _queue_id: &normfs::QueueId) {}

    fn snapshot_gate(&self) -> SnapshotGate {
        SnapshotGate::default()
    }
}

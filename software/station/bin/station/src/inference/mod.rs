use crate::station_proto::inference::{InferenceRx, inference_rx};
use crate::station_proto::startups::StationStartup;
use bytes::Bytes;
use dashmap::DashMap;
use normfs::NormFS;
use normfs::UintN;
use prost::Message;
use station_iface::{STARTUP_WRITE_TIMEOUT, SnapshotGate};
use std::sync::Arc;

pub(crate) const QUEUE_ID: &str = "inference-states";
pub(crate) const STARTUPS_QUEUE_ID: &str = "startups";

pub struct Inference {
    normfs: Arc<NormFS>,
    // Track latest pointer per queue (queue_id -> (pointer, data_type))
    latest_pointers: Arc<DashMap<String, (UintN, i32)>>,
    gate: SnapshotGate,
}

/// Stops the worker on drop; otherwise a failed startup hangs on the runtime drop.
impl Drop for Inference {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl Inference {
    pub fn shutdown(&self) {
        self.gate.close();
    }

    pub async fn start_queue(normfs: &Arc<NormFS>) -> Result<(), normfs::Error> {
        let queue_id = normfs.resolve(QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&queue_id).await?;

        let startups_queue_id = normfs.resolve(STARTUPS_QUEUE_ID);
        normfs
            .ensure_queue_exists_for_write(&startups_queue_id)
            .await?;

        Ok(())
    }

    async fn notify_startup(normfs: &Arc<NormFS>) -> Result<(), normfs::Error> {
        let inference_queue_id = normfs.resolve(QUEUE_ID);
        let inference_queue_ptr = match normfs.get_last_id(&inference_queue_id) {
            Ok(id) => id.value_to_bytes(),
            Err(_) => Bytes::new(),
        };

        let startup = StationStartup {
            monotonic_stamp_ns: normfs_time::monotonic_stamp_ns(),
            local_stamp_ns: normfs_time::local_stamp_ns(),
            app_start_id: normfs_time::app_start_id(),
            station_uuid: normfs.get_instance_id_bytes(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            git_hash: env!("GIT_HASH").to_string(),
            inference_queue_ptr,
        };

        let startups_queue_id = normfs.resolve(STARTUPS_QUEUE_ID);
        normfs
            .ensure_queue_exists_for_write(&startups_queue_id)
            .await?;
        normfs
            .enqueue_timeout(
                &startups_queue_id,
                Bytes::from(startup.encode_to_vec()),
                STARTUP_WRITE_TIMEOUT,
            )
            .await
            .map(|_| ())
    }

    pub async fn start(normfs: Arc<NormFS>, gate: SnapshotGate) -> Self {
        if let Err(e) = Self::notify_startup(&normfs).await {
            log::error!("Failed to publish station startup: {:?}", e);
        }

        let latest_pointers: Arc<DashMap<String, (UintN, i32)>> = Arc::new(DashMap::new());

        let queue_id = normfs.resolve(QUEUE_ID);

        let worker_gate = gate.clone();
        let worker_normfs = normfs.clone();
        let worker_pointers = latest_pointers.clone();
        let worker_queue_id = queue_id.clone();

        tokio::task::spawn_blocking(move || {
            while let Some(turn) = worker_gate.wait() {
                // Snapshot all latest pointers
                let entries: Vec<inference_rx::Entry> = worker_pointers
                    .iter()
                    .map(|entry| inference_rx::Entry {
                        queue: entry.key().clone(),
                        r#type: entry.value().1,
                        ptr: entry.value().0.value_to_bytes(),
                    })
                    .collect();
                drop(turn);

                if !entries.is_empty() {
                    // Publish complete snapshot to inference-states
                    let rx = InferenceRx {
                        entries,
                        local_stamp_ns: normfs_time::local_stamp_ns(),
                        monotonic_stamp_ns: normfs_time::monotonic_stamp_ns(),
                        app_start_id: normfs_time::app_start_id(),
                    };

                    if let Err(e) =
                        worker_normfs.try_enqueue(&worker_queue_id, Bytes::from(rx.encode_to_vec()))
                        && !matches!(e, normfs::Error::WouldBlock)
                    {
                        log::error!("Failed to enqueue inference state to NormFS: {:?}", e);
                    }
                }
            }

            log::info!("Inference worker thread exiting");
        });

        Self {
            normfs,
            latest_pointers,
            gate,
        }
    }

    pub fn register_queue(&self, queue_id: &normfs::QueueId, queue_data_type: i32) {
        let queue_path = queue_id.as_str().to_string();
        let latest_pointers = self.latest_pointers.clone();
        let gate = self.gate.clone();

        log::info!(
            "Inference: registering queue '{}' with type {}",
            queue_id,
            queue_data_type
        );

        let callback = Box::new(move |entries: &[(UintN, Bytes)]| {
            if let Some((id, _bytes)) = entries.last() {
                latest_pointers.insert(queue_path.clone(), (id.clone(), queue_data_type));
                gate.changed();
            }
            true // Continue subscription
        });

        match self.normfs.subscribe(queue_id, callback) {
            Ok(subscriber_id) => {
                log::info!(
                    "Inference: subscribed to queue '{}' with subscriber_id {}",
                    queue_id,
                    subscriber_id
                );
            }
            Err(e) => {
                log::error!("Failed to subscribe to queue '{}': {:?}", queue_id, e);
            }
        }
    }
}

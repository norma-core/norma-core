use crate::station_proto::inference::{InferenceRx, inference_rx};
use crate::station_proto::startups::StationStartup;
use bytes::Bytes;
use dashmap::DashMap;
use normfs::NormFS;
use normfs::UintN;
use parking_lot::{Condvar, Mutex};
use prost::Message;
use std::sync::Arc;
use tokio::sync::mpsc;

const QUEUE_ID: &str = "inference-states";
const STARTUPS_QUEUE_ID: &str = "startups";

pub type InferenceSignal = Arc<(Mutex<bool>, Condvar)>;

pub struct Inference {
    shutdown_tx: mpsc::UnboundedSender<()>,
    normfs: Arc<NormFS>,
    // Track latest pointer per queue (queue_id -> (pointer, data_type))
    latest_pointers: Arc<DashMap<String, (UintN, i32)>>,
    signal: InferenceSignal,
}

impl Inference {
    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(());

        // Signal worker thread to wake up and exit
        let (lock, cvar) = &*self.signal;
        let mut signaled = lock.lock();
        *signaled = true;
        cvar.notify_one();
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

    fn notify_startup(normfs: &Arc<NormFS>) -> Result<(), normfs::Error> {
        let inference_queue_id = normfs.resolve(QUEUE_ID);
        let inference_queue_ptr = match normfs.get_last_id(&inference_queue_id) {
            Ok(id) => id.value_to_bytes(),
            Err(_) => Bytes::new(),
        };

        let startup = StationStartup {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            station_uuid: normfs.get_instance_id_bytes(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            git_hash: env!("GIT_HASH").to_string(),
            inference_queue_ptr,
        };

        let startups_queue_id = normfs.resolve(STARTUPS_QUEUE_ID);
        normfs.enqueue(&startups_queue_id, Bytes::from(startup.encode_to_vec()))?;
        Ok(())
    }

    pub fn start(normfs: Arc<NormFS>) -> Self {
        if let Err(e) = Self::notify_startup(&normfs) {
            log::error!("Failed to publish station startup: {:?}", e);
        }

        let (shutdown_tx, mut shutdown_rx) = mpsc::unbounded_channel();
        let signal = Arc::new((Mutex::new(false), Condvar::new()));

        let latest_pointers: Arc<DashMap<String, (UintN, i32)>> = Arc::new(DashMap::new());

        let queue_id = normfs.resolve(QUEUE_ID);

        let worker_signal = signal.clone();
        let worker_normfs = normfs.clone();
        let worker_pointers = latest_pointers.clone();
        let worker_queue_id = queue_id.clone();

        tokio::task::spawn_blocking(move || {
            let (lock, cvar) = &*worker_signal;
            let mut signaled = lock.lock();

            loop {
                // Wait for signal
                while !*signaled {
                    cvar.wait(&mut signaled);
                }

                // Check if shutdown requested
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }

                // Clear signal flag (new updates during rebuild will set it again)
                *signaled = false;

                // Release lock while we work
                drop(signaled);

                // Snapshot all latest pointers
                let entries: Vec<inference_rx::Entry> = worker_pointers
                    .iter()
                    .map(|entry| inference_rx::Entry {
                        queue: entry.key().clone(),
                        r#type: entry.value().1,
                        ptr: entry.value().0.value_to_bytes(),
                    })
                    .collect();

                if !entries.is_empty() {
                    // Publish complete snapshot to inference-states
                    let rx = InferenceRx {
                        entries,
                        local_stamp_ns: systime::get_local_stamp_ns(),
                        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                        app_start_id: systime::get_app_start_id(),
                    };

                    match worker_normfs.enqueue(&worker_queue_id, Bytes::from(rx.encode_to_vec())) {
                        Ok(_) => {}
                        Err(e) => {
                            log::error!("Failed to enqueue inference state to NormFS: {:?}", e);
                        }
                    }
                }

                // Re-acquire lock for next iteration
                signaled = lock.lock();
            }

            log::info!("Inference worker thread exiting");
        });

        Self {
            shutdown_tx,
            normfs,
            latest_pointers,
            signal,
        }
    }

    pub fn register_queue(&self, queue_id: &normfs::QueueId, queue_data_type: i32) {
        let queue_path = queue_id.as_str().to_string();
        let latest_pointers = self.latest_pointers.clone();
        let signal = self.signal.clone();

        log::info!(
            "Inference: registering queue '{}' with type {}",
            queue_id,
            queue_data_type
        );

        let callback = Box::new(move |entries: &[(UintN, Bytes)]| {
            if let Some((id, _bytes)) = entries.last() {
                latest_pointers.insert(queue_path.clone(), (id.clone(), queue_data_type));

                // Signal worker thread to rebuild and publish
                let (lock, cvar) = &*signal;
                let mut signaled = lock.lock();
                *signaled = true;
                cvar.notify_one();
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

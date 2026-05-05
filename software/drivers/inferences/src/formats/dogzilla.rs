use std::collections::HashMap;
use std::sync::Arc;

use bytes::Bytes;
use dogzilla::dogzilla_proto::InferenceState;
use normfs::{NormFS, UintN};
use parking_lot::Mutex;
use prost::Message;
use station_iface::iface_proto::drivers::QueueDataType;
use station_iface::iface_proto::inference::{InferenceRx, inference_rx};

const RAW_DOGZILLA_QUEUE_ID: &str = "dogzilla/inference";

#[derive(Clone, Eq, PartialEq)]
struct PublishKey {
    raw_ptr: Vec<u8>,
}

lazy_static::lazy_static! {
    static ref LAST_PUBLISHED: Mutex<HashMap<String, PublishKey>> = Mutex::new(HashMap::new());
}

pub async fn mirror_state(
    normfs: &Arc<NormFS>,
    inference_rx: &InferenceRx,
    config: &station_iface::config::Inference,
    shm_writer: Option<&crate::ShmWriter>,
) -> Result<(), Box<dyn std::error::Error>> {
    let raw_entry = match find_raw_dogzilla_entry(inference_rx) {
        Some(entry) => entry,
        None => return Ok(()),
    };

    let publish_key = PublishKey {
        raw_ptr: raw_entry.ptr.to_vec(),
    };

    if is_published(&config.queue_id, &publish_key) {
        return Ok(());
    }

    let raw_ptr = UintN::read_value_from_slice(&raw_entry.ptr, raw_entry.ptr.len())?;
    let raw_data = read_queue_entry(normfs, &raw_entry.queue, raw_ptr).await?;

    InferenceState::decode(raw_data.as_ref())?;

    let output_queue_id = normfs.resolve(&config.queue_id);
    normfs.enqueue(&output_queue_id, raw_data.clone())?;

    if let Some(writer) = shm_writer {
        writer.write_bytes(&raw_data, inference_rx.monotonic_stamp_ns);
    }

    mark_published(&config.queue_id, publish_key);

    Ok(())
}

fn find_raw_dogzilla_entry(inference_rx: &InferenceRx) -> Option<&inference_rx::Entry> {
    inference_rx.entries.iter().find(|entry| {
        is_raw_dogzilla_queue(&entry.queue)
            && entry_type(entry) == Some(QueueDataType::QdtDogzillaInference)
            && !entry.ptr.is_empty()
    })
}

fn is_raw_dogzilla_queue(queue: &str) -> bool {
    queue == RAW_DOGZILLA_QUEUE_ID
        || (queue.starts_with('/') && queue.ends_with("/dogzilla/inference"))
}

fn entry_type(entry: &inference_rx::Entry) -> Option<QueueDataType> {
    QueueDataType::try_from(entry.r#type).ok()
}

fn is_published(output_queue: &str, key: &PublishKey) -> bool {
    LAST_PUBLISHED
        .lock()
        .get(output_queue)
        .is_some_and(|last_key| last_key == key)
}

fn mark_published(output_queue: &str, key: PublishKey) {
    LAST_PUBLISHED.lock().insert(output_queue.to_string(), key);
}

async fn read_queue_entry(
    normfs: &Arc<NormFS>,
    queue: &str,
    ptr: UintN,
) -> Result<Bytes, Box<dyn std::error::Error>> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let queue_id = normfs.resolve(queue);
    normfs
        .read(
            &queue_id,
            normfs::ReadPosition::Absolute(ptr.clone()),
            1,
            1,
            tx,
        )
        .await?;

    match rx.recv().await {
        Some(entry) => Ok(entry.data),
        None => Err(format!("no data received from queue {} at ptr {}", queue, ptr).into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dogzilla::dogzilla_proto::inference_state::DeviceState;
    use std::path::PathBuf;

    #[test]
    fn raw_selection_uses_only_raw_dogzilla_queue() {
        let inference_rx = InferenceRx {
            entries: vec![
                entry(
                    "inference/dogzilla",
                    vec![1],
                    QueueDataType::QdtDogzillaInference,
                ),
                entry(
                    RAW_DOGZILLA_QUEUE_ID,
                    vec![2],
                    QueueDataType::QdtDogzillaInference,
                ),
            ],
            ..Default::default()
        };

        let selected = find_raw_dogzilla_entry(&inference_rx).expect("raw entry");
        assert_eq!(selected.queue, RAW_DOGZILLA_QUEUE_ID);
        assert_eq!(selected.ptr, vec![2]);
    }

    #[test]
    fn raw_selection_accepts_normfs_absolute_queue_path() {
        let inference_rx = InferenceRx {
            entries: vec![entry(
                "/station-instance/dogzilla/inference",
                vec![3],
                QueueDataType::QdtDogzillaInference,
            )],
            ..Default::default()
        };

        let selected = find_raw_dogzilla_entry(&inference_rx).expect("raw entry");
        assert_eq!(selected.queue, "/station-instance/dogzilla/inference");
        assert_eq!(selected.ptr, vec![3]);
    }

    #[test]
    fn publish_guard_dedupes_raw_pointer() {
        let output = "inference/dogzilla-test-publish-guard";
        let first_key = PublishKey { raw_ptr: vec![1] };
        let second_key = PublishKey { raw_ptr: vec![2] };

        assert!(!is_published(output, &first_key));
        mark_published(output, first_key.clone());
        assert!(is_published(output, &first_key));
        assert!(!is_published(output, &second_key));
    }

    #[tokio::test]
    async fn mirror_state_enqueues_raw_state() {
        let base_path = temp_path("dogzilla-mirror-state");
        std::fs::create_dir_all(&base_path).expect("create temp normfs directory");
        let normfs = Arc::new(
            NormFS::new(base_path.clone(), normfs::NormFsSettings::default())
                .await
                .expect("create normfs"),
        );

        let raw_queue_id = normfs.resolve(RAW_DOGZILLA_QUEUE_ID);
        let output_queue = format!(
            "inference/dogzilla-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        );
        let output_queue_id = normfs.resolve(&output_queue);

        normfs
            .ensure_queue_exists_for_write(&raw_queue_id)
            .await
            .expect("raw queue");
        normfs
            .ensure_queue_exists_for_write(&output_queue_id)
            .await
            .expect("output queue");

        let raw_state = InferenceState {
            devices: vec![DeviceState {
                is_connected: true,
                ..Default::default()
            }],
            ..Default::default()
        };
        let raw_ptr = normfs
            .enqueue(&raw_queue_id, Bytes::from(raw_state.encode_to_vec()))
            .expect("enqueue raw state");

        let inference_rx = InferenceRx {
            monotonic_stamp_ns: 123,
            entries: vec![entry(
                raw_queue_id.as_str(),
                raw_ptr.value_to_bytes(),
                QueueDataType::QdtDogzillaInference,
            )],
            ..Default::default()
        };
        let config = station_iface::config::Inference {
            queue_id: output_queue.clone(),
            shm: PathBuf::new(),
            shm_size_mb: 1,
            format: "dogzilla".to_string(),
            st3215_bus: "auto".to_string(),
            update_interval: std::time::Duration::from_millis(100),
        };

        mirror_state(&normfs, &inference_rx, &config, None)
            .await
            .expect("mirror state");

        let output_ptr = normfs.get_last_id(&output_queue_id).expect("output ptr");
        let output_data = read_queue_entry(&normfs, &output_queue, output_ptr)
            .await
            .expect("read output");
        let output_state = InferenceState::decode(output_data.as_ref()).expect("decode output");

        assert_eq!(output_state.devices.len(), 1);

        normfs.close().await.expect("close normfs");
        let _ = std::fs::remove_dir_all(base_path);
    }

    fn entry(queue: &str, ptr: impl Into<Bytes>, queue_type: QueueDataType) -> inference_rx::Entry {
        inference_rx::Entry {
            queue: queue.to_string(),
            ptr: ptr.into(),
            r#type: queue_type as i32,
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }
}

use std::collections::HashMap;
use std::sync::Arc;

use bytes::Bytes;
use yahboom_dogzilla_lite::yahboom_dogzilla_lite_proto::InferenceState;
use normfs::{NormFS, UintN};
use parking_lot::Mutex;
use prost::Message;
use station_iface::iface_proto::drivers::QueueDataType;
use station_iface::iface_proto::inference::{InferenceRx, inference_rx};

const RAW_YAHBOOM_DOGZILLA_LITE_QUEUE_ID: &str = "yahboom-dogzilla-lite/inference";

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
    let raw_entry = match find_raw_yahboom_dogzilla_lite_entry(inference_rx) {
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

fn find_raw_yahboom_dogzilla_lite_entry(inference_rx: &InferenceRx) -> Option<&inference_rx::Entry> {
    inference_rx.entries.iter().find(|entry| {
        is_raw_yahboom_dogzilla_lite_queue(&entry.queue)
            && entry_type(entry) == Some(QueueDataType::QdtYahboomDogzillaLiteInference)
            && !entry.ptr.is_empty()
    })
}

fn is_raw_yahboom_dogzilla_lite_queue(queue: &str) -> bool {
    queue == RAW_YAHBOOM_DOGZILLA_LITE_QUEUE_ID
        || (queue.starts_with('/') && queue.ends_with("/yahboom-dogzilla-lite/inference"))
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

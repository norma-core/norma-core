use std::sync::Arc;

use bytes::Bytes;
use normfs::NormFS;
use prost::Message;
use station_iface::iface_proto::{commands::StationCommandsPack, drivers::StationCommandType};
use station_iface::{Backpressure, try_enqueue_with};

use crate::station_proto::inference_tags::{Command, CommandType, RxEnvelope};

const QUEUE_ID: &str = "inference-tags/rx";

pub async fn start(normfs: Arc<NormFS>) -> Result<(), normfs::Error> {
    let tags_queue_id = normfs.resolve(QUEUE_ID);
    normfs.ensure_queue_exists_for_write(&tags_queue_id).await?;

    let commands_queue_id = normfs.resolve(station_iface::COMMANDS_QUEUE_ID);
    let handler_normfs = normfs.clone();
    normfs.subscribe(
        &commands_queue_id,
        Box::new(move |entries: &[(normfs::UintN, Bytes)]| {
            for (_, data) in entries {
                let pack = match StationCommandsPack::decode(data.as_ref()) {
                    Ok(pack) => pack,
                    Err(e) => {
                        log::error!("Failed to decode StationCommandsPack: {}", e);
                        continue;
                    }
                };
                for cmd in &pack.commands {
                    if cmd.r#type() != StationCommandType::StcInferenceTagCommand {
                        continue;
                    }
                    let tag_cmd = match Command::decode(cmd.body.as_ref()) {
                        Ok(c) => c,
                        Err(e) => {
                            log::error!("Failed to decode inference_tags command: {}", e);
                            continue;
                        }
                    };
                    publish(
                        &handler_normfs,
                        &tags_queue_id,
                        tag_cmd.r#type(),
                        tag_cmd.inference_queue_ptr,
                        tag_cmd.tag,
                    );
                }
            }
            true
        }),
    )?;

    Ok(())
}

/// Called from a subscriber callback; must not block.
fn publish(
    normfs: &NormFS,
    queue_id: &normfs::QueueId,
    cmd_type: CommandType,
    inference_queue_ptr: Bytes,
    tag: String,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        r#type: cmd_type as i32,
        inference_queue_ptr,
        tag,
    };
    if let Err(e) = try_enqueue_with(
        normfs,
        queue_id,
        Bytes::from(envelope.encode_to_vec()),
        Backpressure::Keep,
    ) {
        log::error!("Failed to publish inference tag: {e}");
    }
}

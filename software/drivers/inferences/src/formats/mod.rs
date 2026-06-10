use std::sync::Arc;
use normfs::NormFS;
use normfs::UintN;

mod normvla;

pub async fn process_inference_entry(
    normfs: &Arc<NormFS>,
    id: &UintN,
    inference_rx: &station_iface::iface_proto::inference::InferenceRx,
    config: &station_iface::config::Inference,
    shm_writer: Option<&crate::ShmWriter>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Route to appropriate format generator based on config.format
    match config.format.as_str() {
        "normvla" => {
            normvla::generate_frame(normfs, id, inference_rx, config, shm_writer).await?;
        }
        _ => {
            log::warn!("Unknown inference format: {}, skipping", config.format);
        }
    }

    Ok(())
}

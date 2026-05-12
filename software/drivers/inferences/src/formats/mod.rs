use std::sync::Arc;
use normfs::NormFS;
use normfs::UintN;

mod normvla;
#[cfg(feature = "yahboom-dogzilla-lite")]
mod yahboom_dogzilla_lite;

pub fn queue_data_type_for_format(
    format: &str,
) -> station_iface::iface_proto::drivers::QueueDataType {
    match format {
        "yahboom-dogzilla-lite" => station_iface::iface_proto::drivers::QueueDataType::QdtYahboomDogzillaLiteInference,
        _ => station_iface::iface_proto::drivers::QueueDataType::QdtInferenceFrames,
    }
}

pub async fn process_inference_entry(
    normfs: &Arc<NormFS>,
    id: &UintN,
    inference_rx: &station_iface::iface_proto::inference::InferenceRx,
    config: &station_iface::config::Inference,
    shm_writer: Option<&crate::ShmWriter>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Route to appropriate format generator based on config.format
    match config.format.as_str() {
        "yahboom-dogzilla-lite" => {
            #[cfg(feature = "yahboom-dogzilla-lite")]
            yahboom_dogzilla_lite::mirror_state(normfs, inference_rx, config, shm_writer).await?;

            #[cfg(not(feature = "yahboom-dogzilla-lite"))]
            log::warn!("Yahboom Dogzilla Lite inference requested but not compiled (missing 'yahboom-dogzilla-lite' feature)");
        }
        "normvla" => {
            normvla::generate_frame(normfs, id, inference_rx, config, shm_writer).await?;
        }
        _ => {
            log::warn!("Unknown inference format: {}, skipping", config.format);
        }
    }

    Ok(())
}

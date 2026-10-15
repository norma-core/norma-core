#[cfg(target_os = "linux")]
mod buffer;
#[cfg(target_os = "linux")]
mod camera;
#[cfg(target_os = "linux")]
mod capture;
mod config;
mod error;
#[cfg(target_os = "linux")]
mod format;
#[cfg(target_os = "linux")]
mod frame2tensor;
#[cfg(target_os = "linux")]
mod pipeline;
#[cfg(target_os = "linux")]
mod state;

#[cfg(target_os = "linux")]
pub use camera::Ov5647Camera;
#[cfg(target_os = "linux")]
pub use capture::{CaptureSession, CapturedImage};
pub use config::{CaptureConfig, DEFAULT_HEIGHT, DEFAULT_WIDTH, Quality};
pub use error::{Ov5647Error, Result};
#[cfg(target_os = "linux")]
pub use pipeline::Ov5647Handle;

use normfs::NormFS;
use station_iface::StationEngine;
use std::sync::Arc;
use std::time::Duration;
use usbvideo::codec::VideoCodec;

#[cfg(target_os = "linux")]
#[allow(clippy::too_many_arguments)]
pub async fn start_ov5647<K: StationEngine + Send + Sync + 'static>(
    normfs: Arc<NormFS>,
    engine: Arc<K>,
    width: u32,
    height: u32,
    frames_per_second: u32,
    queue_id: &str,
    codec: VideoCodec,
    keyframe_interval: Duration,
) -> Result<Ov5647Handle> {
    log::info!(
        "OV5647 driver enabled (width={} height={} fps={}, queue={}, codec={:?})",
        width,
        height,
        frames_per_second,
        queue_id,
        codec
    );

    let handle = pipeline::Ov5647Manager::new(
        normfs,
        engine,
        width,
        height,
        frames_per_second,
        queue_id.to_string(),
        codec,
        keyframe_interval,
    )
    .await?;

    Ok(handle)
}

#[cfg(not(target_os = "linux"))]
pub struct Ov5647Handle;

#[cfg(not(target_os = "linux"))]
impl Ov5647Handle {
    pub async fn stop(&self) {}
}

#[cfg(not(target_os = "linux"))]
#[allow(clippy::too_many_arguments)]
pub async fn start_ov5647<K: StationEngine + Send + Sync + 'static>(
    _normfs: Arc<NormFS>,
    _engine: Arc<K>,
    _width: u32,
    _height: u32,
    _frames_per_second: u32,
    _queue_id: &str,
    _codec: VideoCodec,
    _keyframe_interval: Duration,
) -> Result<Ov5647Handle> {
    Err(Ov5647Error::NotSupported(
        "OV5647 driver requires Linux with libcamera".to_string(),
    ))
}

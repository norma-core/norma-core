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

#[cfg(target_os = "linux")]
pub async fn start_ov5647<K: StationEngine + Send + Sync + 'static>(
    normfs: Arc<NormFS>,
    engine: Arc<K>,
    width: u32,
    height: u32,
    frames_per_second: u32,
    queue_id: &str,
) -> Result<Ov5647Handle> {
    log::info!(
        "OV5647 driver enabled (width={} height={} fps={}, queue={})",
        width,
        height,
        frames_per_second,
        queue_id
    );

    let handle = pipeline::Ov5647Manager::new(
        normfs,
        engine,
        width,
        height,
        frames_per_second,
        queue_id.to_string(),
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
pub async fn start_ov5647<K: StationEngine + Send + Sync + 'static>(
    _normfs: Arc<NormFS>,
    _engine: Arc<K>,
    _width: u32,
    _height: u32,
    _frames_per_second: u32,
    _queue_id: &str,
) -> Result<Ov5647Handle> {
    Err(Ov5647Error::NotSupported(
        "OV5647 driver requires Linux with libcamera".to_string(),
    ))
}

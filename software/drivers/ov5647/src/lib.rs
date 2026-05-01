//! OV5647 Camera Station Driver
//!
//! Provides video capture from OV5647 sensor via libcamera.
//!
//! # Architecture
//!
//! This driver follows the station driver pattern:
//! - `start_ov5647()` - Entry point that creates the driver manager
//! - `Ov5647Manager` - Implements the `Driver` trait
//! - `StateTracker` - Manages inference state with lock-free reads
//! - `Ov5647Camera` / `CaptureSession` - libcamera integration
//!
//! # Frame Processing
//!
//! Captured frames are processed into dual formats:
//! - JPEG for browser display (configurable quality)
//! - NCHW tensors for ML inference (planar RGB)
//!
//! # Platform Support
//!
//! This driver only works on Linux with libcamera installed.
//! On other platforms, it provides stub implementations.

mod buffer;
mod config;
mod error;
mod frame2tensor;
mod state;

// Linux-only modules (require libcamera)
#[cfg(target_os = "linux")]
mod camera;
#[cfg(target_os = "linux")]
mod capture;
#[cfg(target_os = "linux")]
mod format;
#[cfg(target_os = "linux")]
mod pipeline;

// Re-export public types
#[cfg(target_os = "linux")]
pub use camera::Ov5647Camera;
#[cfg(target_os = "linux")]
pub use capture::{CaptureSession, CapturedImage};
pub use config::{CaptureConfig, Quality, DEFAULT_HEIGHT, DEFAULT_WIDTH};
pub use error::{Ov5647Error, Result};
#[cfg(target_os = "linux")]
pub use pipeline::Ov5647Handle;

use std::sync::Arc;
use station_iface::StationEngine;
use normfs::NormFS;

/// Generated protobuf types.
pub mod proto {
    pub mod frame {
        include!(concat!(env!("OUT_DIR"), "/ov5647.frame.rs"));
    }

    include!(concat!(env!("OUT_DIR"), "/ov5647.rs"));

    pub mod drivers {
        include!(concat!(env!("OUT_DIR"), "/drivers.rs"));
    }
}

/// Start the OV5647 camera driver.
///
/// # Arguments
///
/// * `normfs` - NormFS instance for queue management
/// * `engine` - Station engine for registration
/// * `width` - Preferred capture width
/// * `height` - Preferred capture height
/// * `frames_per_second` - Target capture FPS
/// * `queue_id` - Queue ID for this driver
///
/// # Returns
///
/// Returns an [`Ov5647Handle`] that must be kept alive for the driver to run.
/// Dropping the handle or calling [`Ov5647Handle::stop`] shuts down the background task.
///
/// # Platform Support
///
/// This function only works on Linux. On other platforms, it returns an error.
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
    ).await?;

    Ok(handle)
}

/// Stub handle for non-Linux platforms.
#[cfg(not(target_os = "linux"))]
pub struct Ov5647Handle;

#[cfg(not(target_os = "linux"))]
impl Ov5647Handle {
    /// Signal the background task to stop (no-op on non-Linux).
    pub async fn stop(&self) {}
}

/// Start the OV5647 camera driver (stub for non-Linux platforms).
#[cfg(not(target_os = "linux"))]
pub async fn start_ov5647<K: StationEngine + Send + Sync + 'static>(
    _normfs: Arc<NormFS>,
    _engine: Arc<K>,
    _width: u32,
    _height: u32,
    _frames_per_second: u32,
    _queue_id: &str,
) -> Result<Ov5647Handle> {
    Err(Ov5647Error::NotSupported("OV5647 driver requires Linux with libcamera".to_string()))
}

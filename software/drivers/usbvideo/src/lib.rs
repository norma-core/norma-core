use std::{sync::Arc, path::PathBuf};
use station_iface::StationEngine;
use normfs::NormFS;

pub mod usbvideo_proto {
    pub mod frame {
        include!("proto/frame.rs");
    }
    pub mod usbvideo {
        include!("proto/usbvideo.rs");
    }
}

mod converters;
mod state;

pub mod pipeline;

// Re-export resize and jpeg conversion functions
pub use converters::{resize_rgb_bilinear, calculate_resize_dimensions};
pub use converters::mjpeg::{convert_mjpeg_to_rgb, convert_rgb_to_jpeg};

#[cfg(target_os = "macos")]
pub mod osx;

#[cfg(target_os = "linux")]
pub mod linux;

/// A requested camera capture resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

/// Parse a `resolution` config string.
///
/// Returns `Ok(None)` for `"auto"`, `Ok(Some(_))` for `"<width>x<height>"`,
/// and `Err(_)` for anything else. Callers warn and treat `Err` as `"auto"`.
pub fn parse_resolution(value: &str) -> Result<Option<Resolution>, String> {
    let trimmed = value.trim();

    if trimmed.eq_ignore_ascii_case("auto") {
        return Ok(None);
    }

    let (w, h) = trimmed.split_once(['x', 'X']).ok_or_else(|| {
        format!("expected \"auto\" or \"<width>x<height>\", got {:?}", value)
    })?;

    let width: u32 = w
        .parse()
        .map_err(|_| format!("invalid width {:?} in resolution {:?}", w, value))?;
    let height: u32 = h
        .parse()
        .map_err(|_| format!("invalid height {:?} in resolution {:?}", h, value))?;

    if width == 0 || height == 0 {
        return Err(format!(
            "resolution {:?} must have non-zero width and height",
            value
        ));
    }

    Ok(Some(Resolution { width, height }))
}

#[derive(Debug, Clone)]
pub struct USBVideoConfig {
    /// Target size for resizing frames (shortest dimension). Default: 224
    /// Set to 0 to disable resizing.
    pub resize_target: u32,

    /// Requested camera capture resolution. `None` selects a format automatically.
    /// Independent of `resize_target`, which controls the stored frame size.
    pub resolution: Option<Resolution>,

    /// Drop this many frames after each frame that is kept. `0` keeps every frame.
    pub frame_skip: u32,
}

impl Default for USBVideoConfig {
    fn default() -> Self {
        Self {
            resize_target: 224,
            resolution: None,
            frame_skip: 0,
        }
    }
}

#[cfg(target_os = "macos")]
pub async fn start_usbvideo<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    base_path: PathBuf,
    config: USBVideoConfig,
) -> Arc<pipeline::USBVideoManager<osx::CameraMacDriver>>{
    Arc::new(
        pipeline::USBVideoManager::new(
            osx::CameraMacDriver::new(),
            normfs,
            station_engine,
            base_path,
            config,
        ).await
    )
}

#[cfg(target_os = "linux")]
pub async fn start_usbvideo<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    base_path: PathBuf,
    config: USBVideoConfig,
) -> Arc<pipeline::USBVideoManager<linux::CameraLinuxDriver>>{
    Arc::new(
        pipeline::USBVideoManager::new(
            linux::CameraLinuxDriver::new(),
            normfs,
            station_engine,
            base_path,
            config,
        ).await
    )
}

/// Process main run loop briefly to handle AVFoundation notifications (macOS only)
/// Call this periodically (e.g. every 100ms) from your main thread
#[cfg(target_os = "macos")]
pub fn process_main_run_loop() {
    osx::process_main_run_loop();
}

#[cfg(not(target_os = "macos"))]
pub fn process_main_run_loop() {
    // No-op on non-macOS platforms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_resolution_auto() {
        assert_eq!(parse_resolution("auto"), Ok(None));
        assert_eq!(parse_resolution("AUTO"), Ok(None));
        assert_eq!(parse_resolution("  auto  "), Ok(None));
    }

    #[test]
    fn test_parse_resolution_valid() {
        assert_eq!(
            parse_resolution("1280x720"),
            Ok(Some(Resolution { width: 1280, height: 720 }))
        );
        assert_eq!(
            parse_resolution("640X480"),
            Ok(Some(Resolution { width: 640, height: 480 }))
        );
    }

    #[test]
    fn test_parse_resolution_invalid() {
        assert!(parse_resolution("720p").is_err());
        assert!(parse_resolution("1280 x 720").is_err());
        assert!(parse_resolution("").is_err());
        assert!(parse_resolution("abc").is_err());
    }

    #[test]
    fn test_parse_resolution_zero_dimension_is_error() {
        assert!(parse_resolution("0x0").is_err());
        assert!(parse_resolution("1280x0").is_err());
        assert!(parse_resolution("0x720").is_err());
    }
}

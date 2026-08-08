use normfs::NormFS;
use station_iface::StationEngine;
use std::{path::PathBuf, sync::Arc};

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
pub use converters::mjpeg::{convert_mjpeg_to_rgb, convert_rgb_to_jpeg};
pub use converters::{FourCCFormat, calculate_resize_dimensions, resize_rgb_bilinear};

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

/// How a format preference selects camera capture resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionPreference {
    Exact(Resolution),
    Max,
}

/// How a format preference selects camera capture frame rate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FpsPreference {
    Exact(f32),
    Min,
    Max,
}

/// A complete camera capture format preference.
///
/// Config entries are parsed from `"<resolution>@<fps>,<format>"`, for example
/// `"1024x768@20fps,mjpeg"` or `"max@minfps,jpeg"`. All three fields are
/// required so a configured list is an ordered list of complete fallbacks.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CameraFormatPreference {
    pub resolution: ResolutionPreference,
    pub fps: FpsPreference,
    pub format: FourCCFormat,
}

fn parse_format_resolution(value: &str) -> Result<ResolutionPreference, String> {
    let trimmed = value.trim();

    if trimmed.eq_ignore_ascii_case("max") {
        return Ok(ResolutionPreference::Max);
    }

    let (w, h) = trimmed
        .split_once(['x', 'X'])
        .ok_or_else(|| format!("expected \"max\" or \"<width>x<height>\", got {:?}", value))?;

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

    Ok(ResolutionPreference::Exact(Resolution { width, height }))
}

fn parse_format_fps(value: &str) -> Result<FpsPreference, String> {
    let trimmed = value.trim();
    let normalized = trimmed.to_ascii_lowercase();

    if normalized == "min" || normalized == "minfps" {
        return Ok(FpsPreference::Min);
    }

    if normalized == "max" || normalized == "maxfps" {
        return Ok(FpsPreference::Max);
    }

    let Some(fps) = normalized.strip_suffix("fps") else {
        return Err(format!(
            "expected \"minfps\", \"maxfps\", or \"<fps>fps\", got {:?}",
            value
        ));
    };

    let fps: f32 = fps
        .parse()
        .map_err(|_| format!("invalid fps {:?} in format preference {:?}", fps, value))?;

    if !fps.is_finite() || fps <= 0.0 {
        return Err(format!("fps {:?} must be a positive finite value", value));
    }

    Ok(FpsPreference::Exact(fps))
}

fn parse_camera_format(value: &str) -> Result<FourCCFormat, String> {
    let normalized = value.trim().to_ascii_lowercase();

    match normalized.as_str() {
        "yuy2" | "yuyv" => Ok(FourCCFormat::Yuv2),
        "420v" => Ok(FourCCFormat::Yuv420v),
        "i420" | "yv12" => Ok(FourCCFormat::Yuv420),
        "rgb" | "rgb3" => Ok(FourCCFormat::Rgb),
        "bgr" | "bgr3" => Ok(FourCCFormat::Bgr),
        "rgba" => Ok(FourCCFormat::Rgba),
        "bgra" => Ok(FourCCFormat::Bgra),
        "argb" => Ok(FourCCFormat::Argb),
        "abgr" => Ok(FourCCFormat::Abgr),
        "mjpg" | "mjpeg" | "jpeg" | "jpg" => Ok(FourCCFormat::Mjpeg),
        _ => Err(format!(
            "expected a supported camera format, got {:?}",
            value
        )),
    }
}

/// Parse one complete `formats` entry.
pub fn parse_format_preference(value: &str) -> Result<CameraFormatPreference, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err("format preference must not be empty".to_string());
    }

    let (resolution_and_fps, format) = trimmed
        .rsplit_once(',')
        .ok_or_else(|| format!("expected \"<resolution>@<fps>,<format>\", got {:?}", value))?;

    if resolution_and_fps.contains(',') || format.contains(',') {
        return Err(format!(
            "expected exactly one comma in format preference {:?}",
            value
        ));
    }

    let (resolution, fps) = resolution_and_fps
        .split_once('@')
        .ok_or_else(|| format!("expected \"<resolution>@<fps>,<format>\", got {:?}", value))?;

    if resolution.contains('@') || fps.contains('@') {
        return Err(format!(
            "expected exactly one @ in format preference {:?}",
            value
        ));
    }

    Ok(CameraFormatPreference {
        resolution: parse_format_resolution(resolution)?,
        fps: parse_format_fps(fps)?,
        format: parse_camera_format(format)?,
    })
}

/// Parse the ordered `formats` config list.
pub fn parse_format_preferences<I, S>(values: I) -> Result<Vec<CameraFormatPreference>, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    values
        .into_iter()
        .enumerate()
        .map(|(idx, value)| {
            let value = value.as_ref();
            parse_format_preference(value)
                .map_err(|e| format!("formats[{}] {:?}: {}", idx, value, e))
        })
        .collect()
}

#[derive(Debug, Clone)]
pub struct USBVideoConfig {
    /// Target size for resizing frames (shortest dimension). Default: 224
    /// Set to 0 to disable resizing.
    pub resize_target: u32,

    /// Ordered camera capture format preferences. Empty selects a format
    /// automatically using the legacy preference order.
    pub formats: Vec<CameraFormatPreference>,

    /// Drop this many frames after each frame that is kept. `0` keeps every frame.
    pub frame_skip: u32,
}

impl Default for USBVideoConfig {
    fn default() -> Self {
        Self {
            resize_target: 224,
            formats: Vec::new(),
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
) -> Arc<pipeline::USBVideoManager<osx::CameraMacDriver>> {
    Arc::new(
        pipeline::USBVideoManager::new(
            osx::CameraMacDriver::new(),
            normfs,
            station_engine,
            base_path,
            config,
        )
        .await,
    )
}

#[cfg(target_os = "linux")]
pub async fn start_usbvideo<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    base_path: PathBuf,
    config: USBVideoConfig,
) -> Arc<pipeline::USBVideoManager<linux::CameraLinuxDriver>> {
    Arc::new(
        pipeline::USBVideoManager::new(
            linux::CameraLinuxDriver::new(),
            normfs,
            station_engine,
            base_path,
            config,
        )
        .await,
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
    fn test_parse_format_preference_exact() {
        assert_eq!(
            parse_format_preference("1024x768@20fps,mjpeg"),
            Ok(CameraFormatPreference {
                resolution: ResolutionPreference::Exact(Resolution {
                    width: 1024,
                    height: 768
                }),
                fps: FpsPreference::Exact(20.0),
                format: FourCCFormat::Mjpeg,
            })
        );
    }

    #[test]
    fn test_parse_format_preference_variants() {
        assert_eq!(
            parse_format_preference("max@minfps,jpeg"),
            Ok(CameraFormatPreference {
                resolution: ResolutionPreference::Max,
                fps: FpsPreference::Min,
                format: FourCCFormat::Mjpeg,
            })
        );
    }

    #[test]
    fn test_parse_format_preference_rejects_partial_specs() {
        assert!(parse_format_preference("1280x720,mjpeg").is_err());
        assert!(parse_format_preference("1280x720@30fps").is_err());
        assert!(parse_format_preference("mjpeg").is_err());
        assert!(parse_format_preference("max").is_err());
    }

    #[test]
    fn test_parse_format_preference_invalid() {
        assert!(parse_format_preference("720p@30fps,mjpeg").is_err());
        assert!(parse_format_preference("1280 x 720@30fps,mjpeg").is_err());
        assert!(parse_format_preference("1280x720@0fps,mjpeg").is_err());
        assert!(parse_format_preference("1280x720@30fps,unknown").is_err());
    }
}

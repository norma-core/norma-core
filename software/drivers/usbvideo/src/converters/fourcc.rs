use crate::usbvideo_proto::usbvideo;
use crate::{CameraFormatPreference, FpsPreference, ResolutionPreference};

pub fn fourcc_from_u32(fourcc: u32) -> [u8; 4] {
    fourcc.to_be_bytes()
}

pub fn fourcc_to_string(format: &[u8; 4]) -> String {
    String::from_utf8_lossy(format).into()
}

/// The formats a camera should be tried with, in preference order.
pub struct FormatSelection {
    pub formats: Vec<usbvideo::CameraFormat>,

    /// Formats were configured but the camera offers no matching convertible
    /// format. When this is set `formats` is empty: callers log a warning naming
    /// the camera and ignore it rather than opening an unintended format.
    pub requested_formats_unavailable: bool,
}

/// The automatic preference order: MJPEG first, then highest frame rate,
/// then lowest pixel count.
fn format_cmp(a: &usbvideo::CameraFormat, b: &usbvideo::CameraFormat) -> std::cmp::Ordering {
    let a_fourcc = FourCCFormat::from_fourcc_u32(a.fourcc).unwrap();
    let b_fourcc = FourCCFormat::from_fourcc_u32(b.fourcc).unwrap();

    let a_is_mjpeg = a_fourcc == FourCCFormat::Mjpeg;
    let b_is_mjpeg = b_fourcc == FourCCFormat::Mjpeg;

    // First priority: MJPEG format
    match (a_is_mjpeg, b_is_mjpeg) {
        (true, false) => return std::cmp::Ordering::Less,
        (false, true) => return std::cmp::Ordering::Greater,
        _ => {}
    }

    // Second priority: Maximum framerate (descending order)
    match b.frames_per_second.partial_cmp(&a.frames_per_second) {
        Some(std::cmp::Ordering::Equal) | None => {}
        Some(other) => return other,
    }

    // Third priority: Resolution (ascending order - prefer lower resolution)
    let a_resolution = a.width as u64 * a.height as u64;
    let b_resolution = b.width as u64 * b.height as u64;
    a_resolution.cmp(&b_resolution)
}

fn format_pixel_count(format: &usbvideo::CameraFormat) -> u64 {
    format.width as u64 * format.height as u64
}

const FPS_EPSILON: f32 = 0.05;

fn fps_matches(actual: f32, expected: f32) -> bool {
    (actual - expected).abs() <= FPS_EPSILON
}

pub fn same_camera_format(a: &usbvideo::CameraFormat, b: &usbvideo::CameraFormat) -> bool {
    a.fourcc == b.fourcc
        && a.index == b.index
        && a.width == b.width
        && a.height == b.height
        && fps_matches(a.frames_per_second, b.frames_per_second)
        && a.guid == b.guid
        && a.frame_index == b.frame_index
}

pub fn select_manual_camera_format(
    formats: &[usbvideo::CameraFormat],
    manual_format: &usbvideo::CameraFormat,
) -> FormatSelection {
    if FourCCFormat::from_fourcc_u32(manual_format.fourcc).is_none() {
        return FormatSelection {
            formats: Vec::new(),
            requested_formats_unavailable: true,
        };
    }

    let selected = formats
        .iter()
        .find(|format| same_camera_format(format, manual_format))
        .cloned();

    let requested_formats_unavailable = selected.is_none();
    FormatSelection {
        formats: selected.into_iter().collect(),
        requested_formats_unavailable,
    }
}

fn fps_cmp(a: f32, b: f32) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

fn format_preference_cmp(
    a: &usbvideo::CameraFormat,
    b: &usbvideo::CameraFormat,
    preference: CameraFormatPreference,
) -> std::cmp::Ordering {
    let resolution_order = match preference.resolution {
        ResolutionPreference::Exact(_) => std::cmp::Ordering::Equal,
        ResolutionPreference::Max => format_pixel_count(b).cmp(&format_pixel_count(a)),
    };
    if resolution_order != std::cmp::Ordering::Equal {
        return resolution_order;
    }

    let fps_order = match preference.fps {
        FpsPreference::Exact(_) => std::cmp::Ordering::Equal,
        FpsPreference::Min => fps_cmp(a.frames_per_second, b.frames_per_second),
        FpsPreference::Max => fps_cmp(b.frames_per_second, a.frames_per_second),
    };
    if fps_order != std::cmp::Ordering::Equal {
        return fps_order;
    }

    a.index
        .cmp(&b.index)
        .then_with(|| a.frame_index.cmp(&b.frame_index))
        .then_with(|| a.width.cmp(&b.width))
        .then_with(|| a.height.cmp(&b.height))
}

fn formats_matching_preference(
    formats: &[usbvideo::CameraFormat],
    preference: CameraFormatPreference,
) -> Vec<usbvideo::CameraFormat> {
    let mut matches: Vec<usbvideo::CameraFormat> = formats
        .iter()
        .filter(|format| FourCCFormat::from_fourcc_u32(format.fourcc) == Some(preference.format))
        .cloned()
        .collect();

    if let ResolutionPreference::Exact(resolution) = preference.resolution {
        matches.retain(|format| {
            format.width == resolution.width && format.height == resolution.height
        });
    }

    if let FpsPreference::Exact(fps) = preference.fps {
        matches.retain(|format| fps_matches(format.frames_per_second, fps));
    }

    matches.sort_by(|a, b| format_preference_cmp(a, b, preference));
    matches
}

/// Filter to convertible formats and order them by preference.
///
/// When `format_preferences` is empty, the legacy automatic preference order is
/// used. Otherwise each complete preference is matched in list order. Exact
/// resolution and FPS selectors are strict; `max`, `minfps`, and `maxfps`
/// selectors order all matches so the capture loop can fall back if a preferred
/// mode opens but never delivers frames.
pub fn filter_and_sort_cameras_formats(
    formats: &[usbvideo::CameraFormat],
    format_preferences: &[CameraFormatPreference],
) -> FormatSelection {
    let mut suitable_formats: Vec<usbvideo::CameraFormat> = formats
        .iter()
        .filter(|format| FourCCFormat::from_fourcc_u32(format.fourcc).is_some())
        .cloned()
        .collect();

    if format_preferences.is_empty() {
        suitable_formats.sort_by(format_cmp);
        return FormatSelection {
            formats: suitable_formats,
            requested_formats_unavailable: false,
        };
    }

    let mut selected_formats: Vec<usbvideo::CameraFormat> = Vec::new();
    for preference in format_preferences {
        for format in formats_matching_preference(&suitable_formats, *preference) {
            if !selected_formats
                .iter()
                .any(|selected| same_camera_format(selected, &format))
            {
                selected_formats.push(format);
            }
        }
    }

    let requested_formats_unavailable = selected_formats.is_empty();
    FormatSelection {
        formats: selected_formats,
        requested_formats_unavailable,
    }
}

/// Supported FourCC formats for conversion
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FourCCFormat {
    /// YUV 4:2:2 format (YUYV)
    Yuv2,
    /// YUV 4:2:0 format (three-plane: I420, YV12)
    Yuv420,
    /// Apple's YUV 4:2:0 format (two-plane: 420v)
    Yuv420v,

    /// RGB - Red, Green, Blue (3 bytes per pixel)
    Rgb,
    /// BGR - Blue, Green, Red (3 bytes per pixel)
    Bgr,
    /// RGBA - Red, Green, Blue, Alpha (4 bytes per pixel)
    Rgba,
    /// BGRA - Blue, Green, Red, Alpha (4 bytes per pixel)
    Bgra,
    /// ARGB - Alpha, Red, Green, Blue (4 bytes per pixel)
    Argb,
    /// ABGR - Alpha, Blue, Green, Red (4 bytes per pixel)
    Abgr,

    /// MJPEG - Motion JPEG (compressed JPEG frames)
    Mjpeg,
}

impl FourCCFormat {
    /// Create from FourCC bytes
    pub fn from_fourcc(fourcc: &[u8; 4]) -> Option<Self> {
        match fourcc {
            b"YUY2" | b"YUYV" => Some(FourCCFormat::Yuv2),
            b"420v" => Some(FourCCFormat::Yuv420v),
            b"I420" | b"YV12" => Some(FourCCFormat::Yuv420),
            b"RGB3" | b"RGB " => Some(FourCCFormat::Rgb),
            b"BGR3" | b"BGR " => Some(FourCCFormat::Bgr),
            b"RGBA" => Some(FourCCFormat::Rgba),
            b"BGRA" => Some(FourCCFormat::Bgra),
            b"ARGB" => Some(FourCCFormat::Argb),
            b"ABGR" => Some(FourCCFormat::Abgr),
            b"MJPG" | b"JPEG" => Some(FourCCFormat::Mjpeg),
            _ => None,
        }
    }

    /// Create from FourCC u32 (big-endian)
    pub fn from_fourcc_u32(fourcc: u32) -> Option<Self> {
        let bytes = fourcc.to_be_bytes();
        Self::from_fourcc(&bytes)
    }

    /// Get the FourCC string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            FourCCFormat::Yuv2 => "YUY2",
            FourCCFormat::Yuv420 => "I420",
            FourCCFormat::Yuv420v => "420v",
            FourCCFormat::Rgb => "RGB3",
            FourCCFormat::Bgr => "BGR3",
            FourCCFormat::Rgba => "RGBA",
            FourCCFormat::Bgra => "BGRA",
            FourCCFormat::Argb => "ARGB",
            FourCCFormat::Abgr => "ABGR",
            FourCCFormat::Mjpeg => "MJPG",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CameraFormatPreference, FpsPreference, Resolution, ResolutionPreference};

    fn fmt(fourcc: &[u8; 4], width: u32, height: u32, fps: f32) -> usbvideo::CameraFormat {
        usbvideo::CameraFormat {
            fourcc: u32::from_be_bytes(*fourcc),
            index: 0,
            width,
            height,
            frames_per_second: fps,
            guid: Default::default(),
            frame_index: 0,
        }
    }

    fn dims(sel: &FormatSelection) -> Vec<(u32, u32)> {
        sel.formats.iter().map(|f| (f.width, f.height)).collect()
    }

    fn modes(sel: &FormatSelection) -> Vec<(u32, u32, f32)> {
        sel.formats
            .iter()
            .map(|f| (f.width, f.height, f.frames_per_second))
            .collect()
    }

    #[test]
    fn test_auto_uses_existing_ordering() {
        let formats = vec![fmt(b"YUY2", 640, 480, 30.0), fmt(b"MJPG", 1280, 720, 30.0)];
        let sel = filter_and_sort_cameras_formats(&formats, &[]);
        assert!(!sel.requested_formats_unavailable);
        // MJPEG wins over YUY2 regardless of resolution
        assert_eq!(dims(&sel), vec![(1280, 720), (640, 480)]);
    }

    #[test]
    fn test_unsupported_fourcc_is_filtered_out() {
        let formats = vec![fmt(b"XXXX", 640, 480, 30.0), fmt(b"MJPG", 640, 480, 30.0)];
        let sel = filter_and_sort_cameras_formats(&formats, &[]);
        assert_eq!(sel.formats.len(), 1);
        assert_eq!(sel.formats[0].fourcc, u32::from_be_bytes(*b"MJPG"));
    }

    #[test]
    fn test_configured_exact_match_only() {
        let formats = vec![fmt(b"MJPG", 640, 480, 60.0), fmt(b"YUY2", 1280, 720, 10.0)];
        let prefs = [CameraFormatPreference {
            resolution: ResolutionPreference::Exact(Resolution {
                width: 1280,
                height: 720,
            }),
            fps: FpsPreference::Exact(10.0),
            format: FourCCFormat::Yuv2,
        }];
        let sel = filter_and_sort_cameras_formats(&formats, &prefs);
        assert!(!sel.requested_formats_unavailable);
        // Only the requested complete format is kept; the 640x480 MJPEG that
        // would win the auto sort is dropped.
        assert_eq!(dims(&sel), vec![(1280, 720)]);
    }

    #[test]
    fn test_configured_order_is_fallback_order() {
        let formats = vec![
            fmt(b"YUY2", 1280, 720, 30.0),
            fmt(b"MJPG", 1280, 720, 15.0),
            fmt(b"MJPG", 1280, 720, 60.0),
        ];
        let prefs = [
            CameraFormatPreference {
                resolution: ResolutionPreference::Exact(Resolution {
                    width: 1280,
                    height: 720,
                }),
                fps: FpsPreference::Exact(15.0),
                format: FourCCFormat::Mjpeg,
            },
            CameraFormatPreference {
                resolution: ResolutionPreference::Exact(Resolution {
                    width: 1280,
                    height: 720,
                }),
                fps: FpsPreference::Exact(30.0),
                format: FourCCFormat::Yuv2,
            },
        ];
        let sel = filter_and_sort_cameras_formats(&formats, &prefs);
        assert!(!sel.requested_formats_unavailable);
        let fps: Vec<f32> = sel.formats.iter().map(|f| f.frames_per_second).collect();
        assert_eq!(fps, vec![15.0, 30.0]);
    }

    #[test]
    fn test_max_resolution_min_fps_jpeg_preference_keeps_ordered_fallbacks() {
        let formats = vec![
            fmt(b"MJPG", 640, 480, 30.0),
            fmt(b"MJPG", 1920, 1080, 30.0),
            fmt(b"MJPG", 1920, 1080, 5.0),
            fmt(b"MJPG", 1280, 720, 10.0),
            fmt(b"YUY2", 3840, 2160, 1.0),
        ];
        let prefs = [CameraFormatPreference {
            resolution: ResolutionPreference::Max,
            fps: FpsPreference::Min,
            format: FourCCFormat::Mjpeg,
        }];
        let sel = filter_and_sort_cameras_formats(&formats, &prefs);
        assert!(!sel.requested_formats_unavailable);
        assert_eq!(
            modes(&sel),
            vec![
                (1920, 1080, 5.0),
                (1920, 1080, 30.0),
                (1280, 720, 10.0),
                (640, 480, 30.0),
            ]
        );
        assert!(
            sel.formats
                .iter()
                .all(|format| format.fourcc == u32::from_be_bytes(*b"MJPG"))
        );
    }

    #[test]
    fn test_non_matching_configured_formats_dropped() {
        let formats = vec![
            fmt(b"MJPG", 640, 480, 30.0),
            fmt(b"MJPG", 1280, 720, 30.0),
            fmt(b"YUY2", 320, 240, 30.0),
        ];
        let prefs = [CameraFormatPreference {
            resolution: ResolutionPreference::Exact(Resolution {
                width: 1280,
                height: 720,
            }),
            fps: FpsPreference::Exact(30.0),
            format: FourCCFormat::Mjpeg,
        }];
        let sel = filter_and_sort_cameras_formats(&formats, &prefs);
        assert!(!sel.requested_formats_unavailable);
        // Only the requested complete format survives; other formats are not
        // kept as a fallback tail.
        assert_eq!(dims(&sel), vec![(1280, 720)]);
    }

    #[test]
    fn test_exact_fps_allows_standard_rounding() {
        let formats = vec![
            fmt(b"MJPG", 1280, 720, 29.97),
            fmt(b"MJPG", 1280, 720, 25.0),
        ];
        let prefs = [CameraFormatPreference {
            resolution: ResolutionPreference::Exact(Resolution {
                width: 1280,
                height: 720,
            }),
            fps: FpsPreference::Exact(30.0),
            format: FourCCFormat::Mjpeg,
        }];
        let sel = filter_and_sort_cameras_formats(&formats, &prefs);
        assert!(!sel.requested_formats_unavailable);
        assert_eq!(dims(&sel), vec![(1280, 720)]);
        assert_eq!(sel.formats[0].frames_per_second, 29.97);
    }

    #[test]
    fn test_no_match_returns_empty_and_sets_flag() {
        let formats = vec![fmt(b"YUY2", 640, 480, 30.0), fmt(b"MJPG", 320, 240, 30.0)];
        let prefs = [CameraFormatPreference {
            resolution: ResolutionPreference::Exact(Resolution {
                width: 1920,
                height: 1080,
            }),
            fps: FpsPreference::Exact(30.0),
            format: FourCCFormat::Mjpeg,
        }];
        let sel = filter_and_sort_cameras_formats(&formats, &prefs);
        assert!(sel.requested_formats_unavailable);
        // No fallback to a different complete format: the camera will be ignored.
        assert!(sel.formats.is_empty());
    }

    #[test]
    fn test_manual_format_selects_exact_format_without_fallback() {
        let formats = vec![
            fmt(b"MJPG", 640, 480, 30.0),
            fmt(b"MJPG", 1280, 720, 30.0),
            fmt(b"YUY2", 320, 240, 30.0),
        ];
        let sel = select_manual_camera_format(&formats, &formats[1]);

        assert!(!sel.requested_formats_unavailable);
        assert_eq!(dims(&sel), vec![(1280, 720)]);
    }

    #[test]
    fn test_manual_format_unavailable_does_not_fallback() {
        let formats = vec![fmt(b"MJPG", 640, 480, 30.0)];
        let manual = fmt(b"MJPG", 1280, 720, 30.0);
        let sel = select_manual_camera_format(&formats, &manual);

        assert!(sel.requested_formats_unavailable);
        assert!(sel.formats.is_empty());
    }

    #[test]
    fn test_manual_format_matches_nominal_fps_with_tolerance() {
        let formats = vec![fmt(b"MJPG", 320, 240, 30.00003)];
        let manual = fmt(b"MJPG", 320, 240, 30.0);
        let sel = select_manual_camera_format(&formats, &manual);

        assert!(!sel.requested_formats_unavailable);
        assert_eq!(dims(&sel), vec![(320, 240)]);
    }

    #[test]
    fn test_auto_selection_restores_configured_fallbacks() {
        let formats = vec![
            fmt(b"MJPG", 1920, 1080, 30.0),
            fmt(b"MJPG", 1920, 1080, 15.0),
            fmt(b"MJPG", 1280, 720, 30.0),
        ];
        let prefs = [CameraFormatPreference {
            resolution: ResolutionPreference::Max,
            fps: FpsPreference::Min,
            format: FourCCFormat::Mjpeg,
        }];

        let sel = filter_and_sort_cameras_formats(&formats, &prefs);

        assert!(!sel.requested_formats_unavailable);
        assert_eq!(
            modes(&sel),
            vec![(1920, 1080, 15.0), (1920, 1080, 30.0), (1280, 720, 30.0)]
        );
    }
}

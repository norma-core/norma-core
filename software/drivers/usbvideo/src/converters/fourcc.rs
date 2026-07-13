use crate::Resolution;
use crate::usbvideo_proto::usbvideo;

pub fn fourcc_from_u32(fourcc: u32) -> [u8; 4] {
    fourcc.to_be_bytes()
}

pub fn fourcc_to_string(format: &[u8; 4]) -> String {
    String::from_utf8_lossy(format).into()
}

/// The formats a camera should be tried with, in preference order.
pub struct FormatSelection {
    pub formats: Vec<usbvideo::CameraFormat>,

    /// A resolution was requested but the camera offers no format at it. When
    /// this is set `formats` is empty: callers log a warning naming the camera
    /// and ignore it rather than falling back to a different resolution.
    pub resolution_unavailable: bool,
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

/// Filter to convertible formats and order them by preference.
///
/// When `resolution` is `Some`, only formats matching it exactly are returned,
/// ordered by preference. No other resolution is offered as a fallback: an
/// explicit resolution request must never be silently satisfied by a different
/// resolution, so if the requested resolution fails to open at runtime the
/// camera simply records nothing. When no format matches the request `formats`
/// is empty and `resolution_unavailable` is set so the caller ignores the camera.
pub fn filter_and_sort_cameras_formats(
    formats: &[usbvideo::CameraFormat],
    resolution: Option<Resolution>,
) -> FormatSelection {
    let mut suitable_formats: Vec<usbvideo::CameraFormat> = formats
        .iter()
        .filter(|format| FourCCFormat::from_fourcc_u32(format.fourcc).is_some())
        .cloned()
        .collect();

    let Some(requested) = resolution else {
        suitable_formats.sort_by(format_cmp);
        return FormatSelection { formats: suitable_formats, resolution_unavailable: false };
    };

    suitable_formats.retain(|f| f.width == requested.width && f.height == requested.height);

    if suitable_formats.is_empty() {
        return FormatSelection { formats: Vec::new(), resolution_unavailable: true };
    }

    suitable_formats.sort_by(format_cmp);
    FormatSelection { formats: suitable_formats, resolution_unavailable: false }
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
    use crate::Resolution;

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

    #[test]
    fn test_auto_uses_existing_ordering() {
        let formats = vec![
            fmt(b"YUY2", 640, 480, 30.0),
            fmt(b"MJPG", 1280, 720, 30.0),
        ];
        let sel = filter_and_sort_cameras_formats(&formats, None);
        assert!(!sel.resolution_unavailable);
        // MJPEG wins over YUY2 regardless of resolution
        assert_eq!(dims(&sel), vec![(1280, 720), (640, 480)]);
    }

    #[test]
    fn test_unsupported_fourcc_is_filtered_out() {
        let formats = vec![fmt(b"XXXX", 640, 480, 30.0), fmt(b"MJPG", 640, 480, 30.0)];
        let sel = filter_and_sort_cameras_formats(&formats, None);
        assert_eq!(sel.formats.len(), 1);
        assert_eq!(sel.formats[0].fourcc, u32::from_be_bytes(*b"MJPG"));
    }

    #[test]
    fn test_exact_match_only() {
        let formats = vec![
            fmt(b"MJPG", 640, 480, 60.0),
            fmt(b"YUY2", 1280, 720, 10.0),
        ];
        let res = Some(Resolution { width: 1280, height: 720 });
        let sel = filter_and_sort_cameras_formats(&formats, res);
        assert!(!sel.resolution_unavailable);
        // Only the requested resolution is kept; the 640x480 MJPEG that would
        // win the auto sort is dropped rather than offered as a fallback.
        assert_eq!(dims(&sel), vec![(1280, 720)]);
    }

    #[test]
    fn test_mjpeg_and_fps_ordering_within_matches() {
        let formats = vec![
            fmt(b"YUY2", 1280, 720, 30.0),
            fmt(b"MJPG", 1280, 720, 15.0),
            fmt(b"MJPG", 1280, 720, 60.0),
        ];
        let res = Some(Resolution { width: 1280, height: 720 });
        let sel = filter_and_sort_cameras_formats(&formats, res);
        assert!(!sel.resolution_unavailable);
        let fps: Vec<f32> = sel.formats.iter().map(|f| f.frames_per_second).collect();
        // MJPEG first (60 then 15), then YUY2
        assert_eq!(fps, vec![60.0, 15.0, 30.0]);
    }

    #[test]
    fn test_non_matching_formats_dropped() {
        let formats = vec![
            fmt(b"MJPG", 640, 480, 30.0),
            fmt(b"MJPG", 1280, 720, 30.0),
            fmt(b"YUY2", 320, 240, 30.0),
        ];
        let res = Some(Resolution { width: 1280, height: 720 });
        let sel = filter_and_sort_cameras_formats(&formats, res);
        assert!(!sel.resolution_unavailable);
        // Only the requested resolution survives; other resolutions are not
        // kept as a fallback tail.
        assert_eq!(dims(&sel), vec![(1280, 720)]);
    }

    #[test]
    fn test_no_match_returns_empty_and_sets_flag() {
        let formats = vec![
            fmt(b"YUY2", 640, 480, 30.0),
            fmt(b"MJPG", 320, 240, 30.0),
        ];
        let res = Some(Resolution { width: 1920, height: 1080 });
        let sel = filter_and_sort_cameras_formats(&formats, res);
        assert!(sel.resolution_unavailable);
        // No fallback to a different resolution: the camera will be ignored.
        assert!(sel.formats.is_empty());
    }
}
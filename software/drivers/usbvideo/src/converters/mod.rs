pub mod mjpeg;
mod resize;
mod rgb;
mod yuv2;
mod yuv420;
mod yuv420v;
mod yuv_tables;

use bytes::Bytes;
use log::debug;
use mjpeg::convert_rgb_to_jpeg;
mod fourcc;

pub use fourcc::*;
pub use resize::{calculate_resize_dimensions, resize_rgb_bilinear};

pub struct ConvertResult {
    pub jpeg: Bytes,
    pub width: u32,
    pub height: u32,
}

/// Process frame conversion based on format with optional resizing
/// resize_target: Target size for shortest dimension (e.g., 224). Set to 0 to disable resizing.
pub fn convert_frame(
    width: u16,
    height: u16,
    format: FourCCFormat,
    data: Bytes,
    resize_target: u32,
) -> Result<ConvertResult, String> {
    let stamp = std::time::Instant::now();

    // Step 1: Convert to RGB
    let rgb_data = if format == FourCCFormat::Mjpeg {
        mjpeg::convert_mjpeg_to_rgb(width, height, &data)?
    } else {
        match format {
            FourCCFormat::Yuv2 => yuv2::convert_yuv2_to_rgb(width, height, data),
            FourCCFormat::Yuv420 => yuv420::convert_yuv420_to_rgb(width, height, data),
            FourCCFormat::Yuv420v => yuv420v::convert_420v_to_rgb(width, height, data),
            FourCCFormat::Rgb => rgb::convert_rgb_to_rgb(width, height, format, data),
            FourCCFormat::Bgr => rgb::convert_rgb_to_rgb(width, height, format, data),
            FourCCFormat::Rgba => rgb::convert_rgb_to_rgb(width, height, format, data),
            FourCCFormat::Bgra => rgb::convert_rgb_to_rgb(width, height, format, data),
            FourCCFormat::Argb => rgb::convert_rgb_to_rgb(width, height, format, data),
            FourCCFormat::Abgr => rgb::convert_rgb_to_rgb(width, height, format, data),
            FourCCFormat::Mjpeg => mjpeg::convert_mjpeg_to_rgb(width, height, &data),
        }?
    }
    .freeze();

    debug!("Conversion from {:?} took {:?}", format, stamp.elapsed());

    // Step 2: Resize if needed
    let (final_width, final_height, final_rgb) = if resize_target > 0 {
        let (new_width, new_height) =
            calculate_resize_dimensions(width as u32, height as u32, resize_target);

        if new_width != width as u32 || new_height != height as u32 {
            debug!(
                "Resizing from {}x{} to {}x{} (target: {})",
                width, height, new_width, new_height, resize_target
            );
            let resize_stamp = std::time::Instant::now();
            let resized = resize_rgb_bilinear(
                &rgb_data,
                width as u32,
                height as u32,
                new_width,
                new_height,
            );
            debug!("Resize took {:?}", resize_stamp.elapsed());
            (new_width, new_height, resized)
        } else {
            (width as u32, height as u32, rgb_data)
        }
    } else {
        (width as u32, height as u32, rgb_data)
    };

    // Step 3: Convert to JPEG and tensor
    let jpeg_data = convert_rgb_to_jpeg(final_width as u16, final_height as u16, final_rgb, 90)?;

    Ok(ConvertResult {
        jpeg: jpeg_data,
        width: final_width,
        height: final_height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fourcc_format_from_bytes() {
        assert_eq!(FourCCFormat::from_fourcc(b"YUY2"), Some(FourCCFormat::Yuv2));
        assert_eq!(FourCCFormat::from_fourcc(b"YUYV"), Some(FourCCFormat::Yuv2));
        assert_eq!(
            FourCCFormat::from_fourcc(b"420v"),
            Some(FourCCFormat::Yuv420v)
        );
        assert_eq!(
            FourCCFormat::from_fourcc(b"I420"),
            Some(FourCCFormat::Yuv420)
        );
        assert_eq!(
            FourCCFormat::from_fourcc(b"YV12"),
            Some(FourCCFormat::Yuv420)
        );
        assert_eq!(FourCCFormat::from_fourcc(b"RGB3"), Some(FourCCFormat::Rgb));
        assert_eq!(FourCCFormat::from_fourcc(b"BGR3"), Some(FourCCFormat::Bgr));
        assert_eq!(FourCCFormat::from_fourcc(b"RGBA"), Some(FourCCFormat::Rgba));
        assert_eq!(FourCCFormat::from_fourcc(b"BGRA"), Some(FourCCFormat::Bgra));
        assert_eq!(
            FourCCFormat::from_fourcc(b"MJPG"),
            Some(FourCCFormat::Mjpeg)
        );
        assert_eq!(
            FourCCFormat::from_fourcc(b"JPEG"),
            Some(FourCCFormat::Mjpeg)
        );
        assert_eq!(FourCCFormat::from_fourcc(b"XXXX"), None);
    }

    #[test]
    fn test_fourcc_format_from_u32() {
        let yuy2_u32 = u32::from_be_bytes(*b"YUY2");
        assert_eq!(
            FourCCFormat::from_fourcc_u32(yuy2_u32),
            Some(FourCCFormat::Yuv2)
        );
    }
}

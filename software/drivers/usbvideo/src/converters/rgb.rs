use super::FourCCFormat;
use bytes::{Bytes, BytesMut};

pub fn convert_rgb_to_rgb(
    width: u16,
    height: u16,
    format: FourCCFormat,
    data: Bytes,
) -> Result<BytesMut, String> {
    let width = width as usize;
    let height = height as usize;

    // Determine bytes per pixel based on format
    let bytes_per_pixel = match format {
        FourCCFormat::Rgb | FourCCFormat::Bgr => 3,
        FourCCFormat::Rgba | FourCCFormat::Bgra | FourCCFormat::Argb | FourCCFormat::Abgr => 4,
        _ => return Err(format!("Invalid RGB format: {:?}", format)),
    };

    // Validate data size
    let expected_size = width * height * bytes_per_pixel;
    if data.len() != expected_size {
        return Err(format!(
            "Invalid RGB data size: expected {} bytes, got {} bytes",
            expected_size,
            data.len()
        ));
    }

    // If already RGB format, just return a copy
    if format == FourCCFormat::Rgb {
        return Ok(BytesMut::from(data));
    }

    // Allocate output buffer for RGB data (3 bytes per pixel, no alpha)
    let output_size = width * height * 3;
    let mut output = BytesMut::with_capacity(output_size);
    output.resize(output_size, 0);

    // Process RGB data based on format
    let mut out_idx = 0;
    for y in 0..height {
        for x in 0..width {
            let pixel_idx = y * width + x;
            let src_idx = pixel_idx * bytes_per_pixel;

            let (r, g, b) = match format {
                FourCCFormat::Rgb => (data[src_idx], data[src_idx + 1], data[src_idx + 2]),
                FourCCFormat::Bgr => (data[src_idx + 2], data[src_idx + 1], data[src_idx]),
                FourCCFormat::Rgba => (data[src_idx], data[src_idx + 1], data[src_idx + 2]),
                FourCCFormat::Bgra => (data[src_idx + 2], data[src_idx + 1], data[src_idx]),
                FourCCFormat::Argb => (data[src_idx + 1], data[src_idx + 2], data[src_idx + 3]),
                FourCCFormat::Abgr => (data[src_idx + 3], data[src_idx + 2], data[src_idx + 1]),
                _ => unreachable!(), // Already validated above
            };

            output[out_idx] = r;
            output[out_idx + 1] = g;
            output[out_idx + 2] = b;
            out_idx += 3;
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_rgb_to_rgb() {
        let width = 2;
        let height = 2;

        // Create RGB data (2x2 image, 3 bytes per pixel)
        let rgb_data = vec![
            255, 0, 0, // Red pixel
            0, 255, 0, // Green pixel
            0, 0, 255, // Blue pixel
            255, 255, 255, // White pixel
        ];

        let data = Bytes::from(rgb_data.clone());
        let result = convert_rgb_to_rgb(width, height, FourCCFormat::Rgb, data).unwrap();

        // Check output size (2x2x3 = 12 bytes)
        assert_eq!(result.len(), 12);

        // Verify RGB format (should be unchanged for RGB input)
        assert_eq!(result[0], 255); // Red pixel R
        assert_eq!(result[1], 0); // Red pixel G
        assert_eq!(result[2], 0); // Red pixel B

        assert_eq!(result[3], 0); // Green pixel R
        assert_eq!(result[4], 255); // Green pixel G
        assert_eq!(result[5], 0); // Green pixel B

        assert_eq!(result[6], 0); // Blue pixel R
        assert_eq!(result[7], 0); // Blue pixel G
        assert_eq!(result[8], 255); // Blue pixel B

        assert_eq!(result[9], 255); // White pixel R
        assert_eq!(result[10], 255); // White pixel G
        assert_eq!(result[11], 255); // White pixel B
    }

    #[test]
    fn test_convert_bgr_to_rgb() {
        let width = 2;
        let height = 2;

        // Create BGR data (2x2 image, 3 bytes per pixel)
        let bgr_data = vec![
            0, 0, 255, // Red pixel (BGR order)
            0, 255, 0, // Green pixel
            255, 0, 0, // Blue pixel (BGR order)
            255, 255, 255, // White pixel
        ];

        let data = Bytes::from(bgr_data);
        let result = convert_rgb_to_rgb(width, height, FourCCFormat::Bgr, data).unwrap();

        // Verify conversion from BGR to RGB
        assert_eq!(result[0], 255); // Red pixel R
        assert_eq!(result[1], 0); // Red pixel G
        assert_eq!(result[2], 0); // Red pixel B

        assert_eq!(result[3], 0); // Green pixel R
        assert_eq!(result[4], 255); // Green pixel G
        assert_eq!(result[5], 0); // Green pixel B
    }

    #[test]
    fn test_convert_rgba_to_rgb() {
        let width = 2;
        let height = 1;

        // Create RGBA data (2x1 image, 4 bytes per pixel)
        let rgba_data = vec![
            255, 0, 0, 128, // Red pixel with alpha
            0, 255, 0, 255, // Green pixel with alpha
        ];

        let data = Bytes::from(rgba_data);
        let result = convert_rgb_to_rgb(width, height, FourCCFormat::Rgba, data).unwrap();

        // Check output size (2x1x3 = 6 bytes, alpha ignored)
        assert_eq!(result.len(), 6);

        // Verify RGB values (alpha channel dropped)
        assert_eq!(result[0], 255); // Red pixel R
        assert_eq!(result[1], 0); // Red pixel G
        assert_eq!(result[2], 0); // Red pixel B

        assert_eq!(result[3], 0); // Green pixel R
        assert_eq!(result[4], 255); // Green pixel G
        assert_eq!(result[5], 0); // Green pixel B
    }

    #[test]
    fn test_convert_argb_to_rgb() {
        let width = 1;
        let height = 2;

        // Create ARGB data (1x2 image, 4 bytes per pixel)
        let argb_data = vec![
            255, 255, 0, 0, // Red pixel with alpha first
            128, 0, 255, 0, // Green pixel with alpha first
        ];

        let data = Bytes::from(argb_data);
        let result = convert_rgb_to_rgb(width, height, FourCCFormat::Argb, data).unwrap();

        // Check output size (1x2x3 = 6 bytes)
        assert_eq!(result.len(), 6);

        // Verify RGB values
        assert_eq!(result[0], 255); // Red pixel R
        assert_eq!(result[1], 0); // Red pixel G
        assert_eq!(result[2], 0); // Red pixel B

        assert_eq!(result[3], 0); // Green pixel R
        assert_eq!(result[4], 255); // Green pixel G
        assert_eq!(result[5], 0); // Green pixel B
    }

    #[test]
    fn test_invalid_data_size() {
        let width = 2;
        let height = 2;
        let data = Bytes::from(vec![0; 10]); // Wrong size for RGB

        let result = convert_rgb_to_rgb(width, height, FourCCFormat::Rgb, data);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_format() {
        let width = 2;
        let height = 2;
        let data = Bytes::from(vec![0; 12]);

        // Try to use a YUV format with RGB converter
        let result = convert_rgb_to_rgb(width, height, FourCCFormat::Yuv2, data);
        assert!(result.is_err());
    }
}

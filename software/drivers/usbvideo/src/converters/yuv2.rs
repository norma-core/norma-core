use super::yuv_tables::get_yuv_to_rgb_tables;
use bytes::{Bytes, BytesMut};

/// Convert YUV2 (YUYV) format to RGB format
///
/// YUV2/YUYV format: Y0 U0 Y1 V0 Y2 U2 Y3 V2 ...
/// Each pair of pixels shares U and V values
///
/// Output RGB format: R0 G0 B0 R1 G1 B1 ... (interleaved RGB values)
///
/// # Arguments
/// * `width` - Frame width in pixels
/// * `height` - Frame height in pixels
/// * `data` - Raw YUV2 data
///
/// # Returns
/// * `Ok(Bytes)` - Converted RGB data
/// * `Err(String)` - Error message if conversion fails
pub fn convert_yuv2_to_rgb(width: u16, height: u16, data: Bytes) -> Result<BytesMut, String> {
    let width = width as usize;
    let height = height as usize;

    // YUV2 has 2 bytes per pixel (4 bytes per 2 pixels)
    let expected_size = width * height * 2;
    if data.len() != expected_size {
        return Err(format!(
            "Invalid YUV2 data size: expected {} bytes, got {} bytes",
            expected_size,
            data.len()
        ));
    }

    // Ensure width is even (YUV2 requirement)
    if !width.is_multiple_of(2) {
        return Err(format!("Width must be even for YUV2 format, got {}", width));
    }

    // Get shared lookup tables for optimized conversion
    let tables = get_yuv_to_rgb_tables();

    // Allocate output buffer for RGB data (3 bytes per pixel)
    let output_size = width * height * 3;
    let mut output = BytesMut::with_capacity(output_size);
    output.resize(output_size, 0);

    // Process YUV2 data using optimized lookup tables
    unsafe {
        let mut out_idx = 0;
        for y in 0..height {
            for x in (0..width).step_by(2) {
                // Get YUV values for two pixels
                let base_idx = (y * width + x) * 2;
                let y0 = data[base_idx];
                let u = data[base_idx + 1];
                let y1 = data[base_idx + 2];
                let v = data[base_idx + 3];

                // Convert YUV to RGB for first pixel using lookup tables
                let (r0, g0, b0) = tables.yuv_to_rgb_fast(y0, u, v);
                output[out_idx] = r0;
                output[out_idx + 1] = g0;
                output[out_idx + 2] = b0;
                out_idx += 3;

                // Convert YUV to RGB for second pixel using lookup tables
                let (r1, g1, b1) = tables.yuv_to_rgb_fast(y1, u, v);
                output[out_idx] = r1;
                output[out_idx + 1] = g1;
                output[out_idx + 2] = b1;
                out_idx += 3;
            }
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_yuv2_to_rgb() {
        // Create a simple 2x2 YUV2 image
        let width = 2;
        let height = 2;

        // YUV2 data for 2x2 image (8 bytes total)
        let yuv_data = vec![
            // Row 0: Y0 U0 Y1 V0
            235, 128, 235, 128, // Two white pixels
            // Row 1: Y0 U0 Y1 V0
            16, 128, 16, 128, // Two black pixels
        ];

        let data = Bytes::from(yuv_data);
        let result = convert_yuv2_to_rgb(width, height, data).unwrap();

        // Check output size (2x2x3 = 12 bytes)
        assert_eq!(result.len(), 12);

        // Verify RGB format (interleaved)
        // First white pixel (R, G, B)
        assert!(result[0] > 230); // R
        assert!(result[1] > 230); // G
        assert!(result[2] > 230); // B

        // Second white pixel (R, G, B)
        assert!(result[3] > 230); // R
        assert!(result[4] > 230); // G
        assert!(result[5] > 230); // B

        // First black pixel (R, G, B)
        assert!(result[6] < 20); // R
        assert!(result[7] < 20); // G
        assert!(result[8] < 20); // B

        // Second black pixel (R, G, B)
        assert!(result[9] < 20); // R
        assert!(result[10] < 20); // G
        assert!(result[11] < 20); // B
    }

    #[test]
    fn test_invalid_data_size() {
        let width = 4;
        let height = 2;
        let data = Bytes::from(vec![0; 10]); // Wrong size

        let result = convert_yuv2_to_rgb(width, height, data);
        assert!(result.is_err());
    }

    #[test]
    fn test_odd_width() {
        let width = 3; // Odd width
        let height = 2;
        let data = Bytes::from(vec![0; 12]);

        let result = convert_yuv2_to_rgb(width, height, data);
        assert!(result.is_err());
    }
}

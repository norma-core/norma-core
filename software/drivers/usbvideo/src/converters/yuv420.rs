use super::yuv_tables::get_yuv_to_rgb_tables;
use bytes::{Bytes, BytesMut};

/// Convert YUV 4:2:0 format to RGB format
///
/// YUV 4:2:0 format has:
/// - Full resolution Y plane (width * height bytes)
/// - Quarter resolution U plane (width/2 * height/2 bytes)
/// - Quarter resolution V plane (width/2 * height/2 bytes)
///
/// Total size: width * height * 1.5 bytes
///
/// Output RGB format: R0 G0 B0 R1 G1 B1 ... (interleaved RGB values)
///
/// # Arguments
/// * `width` - Frame width in pixels
/// * `height` - Frame height in pixels
/// * `data` - Raw YUV 4:2:0 data
///
/// # Returns
/// * `Ok(Bytes)` - Converted RGB data
/// * `Err(String)` - Error message if conversion fails
pub fn convert_yuv420_to_rgb(width: u16, height: u16, data: Bytes) -> Result<BytesMut, String> {
    let width = width as usize;
    let height = height as usize;

    // YUV 4:2:0 has 1.5 bytes per pixel
    let y_size = width * height;
    let uv_size = (width / 2) * (height / 2);
    let expected_size = y_size + (uv_size * 2);

    if data.len() != expected_size {
        return Err(format!(
            "Invalid YUV 4:2:0 data size: expected {} bytes, got {} bytes",
            expected_size,
            data.len()
        ));
    }

    // Ensure width and height are even (YUV 4:2:0 requirement)
    if !width.is_multiple_of(2) || !height.is_multiple_of(2) {
        return Err(format!(
            "Width and height must be even for YUV 4:2:0 format, got {}x{}",
            width, height
        ));
    }

    // Get shared lookup tables for optimized conversion
    let tables = get_yuv_to_rgb_tables();

    // Allocate output buffer for RGB data (3 bytes per pixel)
    let output_size = width * height * 3;
    let mut output = BytesMut::with_capacity(output_size);
    output.resize(output_size, 0);

    // Get pointers to Y, U, and V planes
    let y_plane = &data[0..y_size];
    let u_plane = &data[y_size..y_size + uv_size];
    let v_plane = &data[y_size + uv_size..];

    // Process YUV 4:2:0 data using optimized lookup tables
    unsafe {
        let mut out_idx = 0;
        for y in 0..height {
            for x in 0..width {
                // Get Y value for current pixel
                let y_val = y_plane[y * width + x];

                // Get U and V values (subsampled by 2x2)
                let uv_x = x / 2;
                let uv_y = y / 2;
                let uv_idx = uv_y * (width / 2) + uv_x;
                let u_val = u_plane[uv_idx];
                let v_val = v_plane[uv_idx];

                // Convert YUV to RGB using lookup tables
                let (r, g, b) = tables.yuv_to_rgb_fast(y_val, u_val, v_val);
                output[out_idx] = r;
                output[out_idx + 1] = g;
                output[out_idx + 2] = b;
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
    fn test_convert_yuv420_to_rgb() {
        // Create a simple 4x4 YUV 4:2:0 image
        let width = 4;
        let height = 4;

        // YUV 4:2:0 data for 4x4 image
        // Y plane: 16 bytes
        // U plane: 4 bytes (2x2)
        // V plane: 4 bytes (2x2)
        // Total: 24 bytes
        let mut yuv_data = vec![];

        // Y plane - gradient from black to white
        for i in 0..16 {
            yuv_data.push((i * 16) as u8);
        }

        // U plane - neutral (128)
        yuv_data.extend(std::iter::repeat_n(128, 4));

        // V plane - neutral (128)
        yuv_data.extend(std::iter::repeat_n(128, 4));

        let data = Bytes::from(yuv_data);
        let result = convert_yuv420_to_rgb(width, height, data).unwrap();

        // Check output size (4x4x3 = 48 bytes)
        assert_eq!(result.len(), 48);

        // Verify RGB format (interleaved)
        // First pixel should be dark (Y=0)
        assert!(result[0] < 10); // R
        assert!(result[1] < 10); // G
        assert!(result[2] < 10); // B

        // Last pixel should be brighter (Y=240)
        assert!(result[45] > 230); // R
        assert!(result[46] > 230); // G
        assert!(result[47] > 230); // B
    }

    #[test]
    fn test_invalid_data_size() {
        let width = 4;
        let height = 4;
        let data = Bytes::from(vec![0; 20]); // Wrong size (should be 24)

        let result = convert_yuv420_to_rgb(width, height, data);
        assert!(result.is_err());
    }

    #[test]
    fn test_odd_dimensions() {
        let width = 3; // Odd width
        let height = 4;
        let data = Bytes::from(vec![0; 18]); // 3*4*1.5 = 18

        let result = convert_yuv420_to_rgb(width, height, data);
        assert!(result.is_err());

        let width = 4;
        let height = 3; // Odd height
        let data = Bytes::from(vec![0; 18]); // 4*3*1.5 = 18

        let result = convert_yuv420_to_rgb(width, height, data);
        assert!(result.is_err());
    }
}

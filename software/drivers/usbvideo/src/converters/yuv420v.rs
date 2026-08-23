use super::yuv_tables::get_yuv_to_rgb_tables;
use bytes::{Bytes, BytesMut};

/// Fallback YUV420v to RGB converter for non-aligned dimensions
fn convert_420v_to_rgb_fallback(width: u16, height: u16, data: Bytes) -> Result<BytesMut, String> {
    let width = width as usize;
    let height = height as usize;

    // Validate inputs
    let y_size = width * height;
    let uv_size = width * height / 2;
    let expected_size = y_size + uv_size;

    if data.len() < expected_size {
        return Err(format!(
            "Invalid 420v data size: expected at least {} bytes, got {} bytes",
            expected_size,
            data.len()
        ));
    }

    if !width.is_multiple_of(2) || !height.is_multiple_of(2) {
        return Err(format!(
            "Width and height must be even for 420v format, got {}x{}",
            width, height
        ));
    }

    // Get shared lookup tables
    let tables = get_yuv_to_rgb_tables();

    // Allocate output buffer
    let output_size = width * height * 3;
    let mut output = vec![0u8; output_size];

    unsafe {
        let y_ptr = data.as_ptr();
        let uv_ptr = y_ptr.add(y_size);
        let out_ptr = output.as_mut_ptr();

        let half_width = width / 2;

        // Process 2x2 blocks
        for block_y in 0..height / 2 {
            let y0 = block_y * 2;
            let y1 = y0 + 1;

            // Pre-calculate row pointers
            let y0_row = y_ptr.add(y0 * width);
            let y1_row = y_ptr.add(y1 * width);
            let uv_row = uv_ptr.add(block_y * half_width * 2);
            let out0_row = out_ptr.add(y0 * width * 3);
            let out1_row = out_ptr.add(y1 * width * 3);

            for block_x in 0..half_width {
                let x0 = block_x * 2;
                let x1 = x0 + 1;

                // Get UV values for this 2x2 block
                let uv_offset = block_x * 2;
                let u = *uv_row.add(uv_offset) as usize;
                let v = *uv_row.add(uv_offset + 1) as usize;

                // Get pre-computed UV contributions from lookup tables
                let r_uv = tables.rv_table[v];
                let g_uv = tables.gu_table[u] + tables.gv_table[v];
                let b_uv = tables.bu_table[u];

                // Process 4 pixels using lookup tables and unsafe access
                // Top-left pixel
                let y_val = *y0_row.add(x0) as i16;
                let out_offset = x0 * 3;
                *out0_row.add(out_offset) = tables.clamp(y_val + r_uv);
                *out0_row.add(out_offset + 1) = tables.clamp(y_val + g_uv);
                *out0_row.add(out_offset + 2) = tables.clamp(y_val + b_uv);

                // Top-right pixel
                let y_val = *y0_row.add(x1) as i16;
                let out_offset = x1 * 3;
                *out0_row.add(out_offset) = tables.clamp(y_val + r_uv);
                *out0_row.add(out_offset + 1) = tables.clamp(y_val + g_uv);
                *out0_row.add(out_offset + 2) = tables.clamp(y_val + b_uv);

                // Bottom-left pixel
                let y_val = *y1_row.add(x0) as i16;
                let out_offset = x0 * 3;
                *out1_row.add(out_offset) = tables.clamp(y_val + r_uv);
                *out1_row.add(out_offset + 1) = tables.clamp(y_val + g_uv);
                *out1_row.add(out_offset + 2) = tables.clamp(y_val + b_uv);

                // Bottom-right pixel
                let y_val = *y1_row.add(x1) as i16;
                let out_offset = x1 * 3;
                *out1_row.add(out_offset) = tables.clamp(y_val + r_uv);
                *out1_row.add(out_offset + 1) = tables.clamp(y_val + g_uv);
                *out1_row.add(out_offset + 2) = tables.clamp(y_val + b_uv);
            }
        }
    }

    Ok(BytesMut::from(output.as_slice()))
}

/// Fast YUV420v to RGB converter using lookup tables and unrolled loops
/// Processes 8 pixels at once for maximum performance
pub fn convert_420v_to_rgb(width: u16, height: u16, data: Bytes) -> Result<BytesMut, String> {
    let width = width as usize;
    let height = height as usize;

    // Validate inputs
    let y_size = width * height;
    let uv_size = width * height / 2;
    let expected_size = y_size + uv_size;

    if data.len() < expected_size {
        return Err(format!(
            "Invalid 420v data size: expected at least {} bytes, got {} bytes",
            expected_size,
            data.len()
        ));
    }

    if !width.is_multiple_of(8) || !height.is_multiple_of(2) {
        // Fall back to regular version for non-aligned widths
        return convert_420v_to_rgb_fallback(width as u16, height as u16, data);
    }

    // Get shared lookup tables
    let tables = get_yuv_to_rgb_tables();

    // Allocate output buffer
    let output_size = width * height * 3;
    let mut output = vec![0u8; output_size];

    unsafe {
        let y_ptr = data.as_ptr();
        let uv_ptr = y_ptr.add(y_size);
        let out_ptr = output.as_mut_ptr();

        let half_width = width / 2;

        // Process 2x8 blocks (16 pixels at once)
        for block_y in 0..height / 2 {
            let y0 = block_y * 2;
            let y1 = y0 + 1;

            let y0_row = y_ptr.add(y0 * width);
            let y1_row = y_ptr.add(y1 * width);
            let uv_row = uv_ptr.add(block_y * half_width * 2);
            let out0_row = out_ptr.add(y0 * width * 3);
            let out1_row = out_ptr.add(y1 * width * 3);

            for block_x in (0..half_width).step_by(4) {
                // Process 4 UV pairs (8 pixels horizontally)
                for i in 0..4 {
                    let x_base = (block_x + i) * 2;
                    let uv_offset = (block_x + i) * 2;

                    let u = *uv_row.add(uv_offset) as usize;
                    let v = *uv_row.add(uv_offset + 1) as usize;

                    let r_uv = tables.rv_table[v];
                    let g_uv = tables.gu_table[u] + tables.gv_table[v];
                    let b_uv = tables.bu_table[u];

                    // Unroll the inner loop for 2x2 pixels
                    // Process both pixels in top row
                    let y_val0 = *y0_row.add(x_base) as i16;
                    let y_val1 = *y0_row.add(x_base + 1) as i16;

                    let out_base = x_base * 3;
                    *out0_row.add(out_base) = tables.clamp(y_val0 + r_uv);
                    *out0_row.add(out_base + 1) = tables.clamp(y_val0 + g_uv);
                    *out0_row.add(out_base + 2) = tables.clamp(y_val0 + b_uv);
                    *out0_row.add(out_base + 3) = tables.clamp(y_val1 + r_uv);
                    *out0_row.add(out_base + 4) = tables.clamp(y_val1 + g_uv);
                    *out0_row.add(out_base + 5) = tables.clamp(y_val1 + b_uv);

                    // Process both pixels in bottom row
                    let y_val0 = *y1_row.add(x_base) as i16;
                    let y_val1 = *y1_row.add(x_base + 1) as i16;

                    *out1_row.add(out_base) = tables.clamp(y_val0 + r_uv);
                    *out1_row.add(out_base + 1) = tables.clamp(y_val0 + g_uv);
                    *out1_row.add(out_base + 2) = tables.clamp(y_val0 + b_uv);
                    *out1_row.add(out_base + 3) = tables.clamp(y_val1 + r_uv);
                    *out1_row.add(out_base + 4) = tables.clamp(y_val1 + g_uv);
                    *out1_row.add(out_base + 5) = tables.clamp(y_val1 + b_uv);
                }
            }
        }
    }

    Ok(BytesMut::from(output.as_slice()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_conversion() {
        let width = 16;
        let height = 16;
        let mut yuv_data = vec![0u8; width * height + width * height / 2];

        // Fill with test pattern
        for (i, item) in yuv_data.iter_mut().enumerate().take(width * height) {
            *item = (i % 256) as u8;
        }
        for item in yuv_data
            .iter_mut()
            .skip(width * height)
            .take(width * height / 2)
        {
            *item = 128;
        }

        let data = Bytes::from(yuv_data);

        // Test the implementation
        let result = convert_420v_to_rgb(width as u16, height as u16, data).unwrap();

        // Should produce correct output size
        assert_eq!(result.len(), width * height * 3);
    }

    #[test]
    fn test_non_aligned_dimensions() {
        // Test with dimensions not aligned to 8
        let width = 10;
        let height = 10;
        let mut yuv_data = vec![0u8; width * height + width * height / 2];

        // Fill with test pattern
        for (i, item) in yuv_data.iter_mut().enumerate().take(width * height) {
            *item = (i % 256) as u8;
        }
        for item in yuv_data
            .iter_mut()
            .skip(width * height)
            .take(width * height / 2)
        {
            *item = 128;
        }

        let data = Bytes::from(yuv_data);

        // Should fall back to non-unrolled version
        let result = convert_420v_to_rgb(width as u16, height as u16, data).unwrap();

        // Should produce correct output size
        assert_eq!(result.len(), width * height * 3);
    }
}

use std::sync::OnceLock;

// Global lookup tables - initialized once using OnceLock (thread-safe)
static YUV_TO_RGB_TABLES: OnceLock<YuvToRgbTables> = OnceLock::new();

/// Pre-computed lookup tables for YUV to RGB conversion
/// Using ITU-R BT.601 coefficients
pub struct YuvToRgbTables {
    // Pre-computed Y contributions for R, G, B
    pub y_table: [u8; 256],

    // Pre-computed UV contributions
    pub rv_table: [i16; 256], // V contribution to R
    pub gu_table: [i16; 256], // U contribution to G
    pub gv_table: [i16; 256], // V contribution to G
    pub bu_table: [i16; 256], // U contribution to B

    // Clamp table for fast clamping
    pub clamp_table: [u8; 1024], // Maps -384 to 639 -> 0 to 255
}

impl YuvToRgbTables {
    fn new() -> Self {
        let mut tables = YuvToRgbTables {
            y_table: [0; 256],
            rv_table: [0; 256],
            gu_table: [0; 256],
            gv_table: [0; 256],
            bu_table: [0; 256],
            clamp_table: [0; 1024],
        };

        // Initialize Y table (identity for now, could apply gamma correction)
        for i in 0..256 {
            tables.y_table[i] = i as u8;
        }

        // Initialize UV contribution tables
        for i in 0..256 {
            let u_centered = i as i32 - 128;
            let v_centered = i as i32 - 128;

            // Using ITU-R BT.601 coefficients with fixed-point arithmetic
            tables.rv_table[i] = ((1436 * v_centered) >> 10) as i16;
            tables.gu_table[i] = ((-352 * u_centered) >> 10) as i16;
            tables.gv_table[i] = ((-731 * v_centered) >> 10) as i16;
            tables.bu_table[i] = ((1815 * u_centered) >> 10) as i16;
        }

        // Initialize clamp table
        // Index 384 corresponds to value 0
        for i in 0..1024 {
            let val = i as i32 - 384;
            tables.clamp_table[i] = val.clamp(0, 255) as u8;
        }

        tables
    }

    /// Fast clamping using lookup table
    #[inline(always)]
    pub unsafe fn clamp(&self, val: i16) -> u8 {
        // Add 384 to shift into positive range for table lookup
        unsafe { *self.clamp_table.get_unchecked((val + 384) as usize) }
    }

    /// Convert YUV to RGB using lookup tables
    #[inline(always)]
    pub unsafe fn yuv_to_rgb_fast(&self, y: u8, u: u8, v: u8) -> (u8, u8, u8) {
        unsafe {
            let y_val = *self.y_table.get_unchecked(y as usize) as i16;
            let rv = *self.rv_table.get_unchecked(v as usize);
            let gu = *self.gu_table.get_unchecked(u as usize);
            let gv = *self.gv_table.get_unchecked(v as usize);
            let bu = *self.bu_table.get_unchecked(u as usize);

            let r = self.clamp(y_val + rv);
            let g = self.clamp(y_val + gu + gv);
            let b = self.clamp(y_val + bu);

            (r, g, b)
        }
    }
}

/// Get the global YUV to RGB conversion tables
pub fn get_yuv_to_rgb_tables() -> &'static YuvToRgbTables {
    YUV_TO_RGB_TABLES.get_or_init(YuvToRgbTables::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_yuv_to_rgb_fast() {
        let tables = get_yuv_to_rgb_tables();

        unsafe {
            // Test with known YUV values
            let (r, g, b) = tables.yuv_to_rgb_fast(235, 128, 128); // Near white
            assert!(r > 230 && g > 230 && b > 230);

            let (r, g, b) = tables.yuv_to_rgb_fast(16, 128, 128); // Near black
            assert!(r < 20 && g < 20 && b < 20);
        }
    }
}

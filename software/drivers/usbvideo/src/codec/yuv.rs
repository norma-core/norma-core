// BT.601 limited range, which is what VP8 streams and WebCodecs assume.

fn clamp(v: i32) -> u8 {
    v.clamp(0, 255) as u8
}

/// Even dimensions only: VP8 subsamples chroma by two in both directions.
pub fn rgb_to_i420(width: usize, height: usize, rgb: &[u8]) -> Vec<u8> {
    let (cw, ch) = (width / 2, height / 2);
    let mut out = vec![0u8; width * height + 2 * cw * ch];
    let (y_plane, uv) = out.split_at_mut(width * height);
    let (u_plane, v_plane) = uv.split_at_mut(cw * ch);

    for row in 0..height {
        for col in 0..width {
            let i = (row * width + col) * 3;
            let (r, g, b) = (rgb[i] as i32, rgb[i + 1] as i32, rgb[i + 2] as i32);
            y_plane[row * width + col] = clamp(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
        }
    }
    for row in 0..ch {
        for col in 0..cw {
            let (mut r, mut g, mut b) = (0i32, 0i32, 0i32);
            for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                let i = ((row * 2 + dy) * width + col * 2 + dx) * 3;
                r += rgb[i] as i32;
                g += rgb[i + 1] as i32;
                b += rgb[i + 2] as i32;
            }
            let (r, g, b) = ((r + 2) / 4, (g + 2) / 4, (b + 2) / 4);
            u_plane[row * cw + col] = clamp(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
            v_plane[row * cw + col] = clamp(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
pub fn i420_to_rgb(
    width: usize,
    height: usize,
    y: &[u8],
    y_stride: usize,
    u: &[u8],
    u_stride: usize,
    v: &[u8],
    v_stride: usize,
) -> Vec<u8> {
    let mut rgb = vec![0u8; width * height * 3];
    for row in 0..height {
        for col in 0..width {
            let c = y[row * y_stride + col] as i32 - 16;
            let d = u[(row / 2) * u_stride + col / 2] as i32 - 128;
            let e = v[(row / 2) * v_stride + col / 2] as i32 - 128;
            let i = (row * width + col) * 3;
            rgb[i] = clamp((298 * c + 409 * e + 128) >> 8);
            rgb[i + 1] = clamp((298 * c - 100 * d - 208 * e + 128) >> 8);
            rgb[i + 2] = clamp((298 * c + 516 * d + 128) >> 8);
        }
    }
    rgb
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_colour_survives_the_round_trip() {
        let (w, h) = (8, 4);
        let rgb: Vec<u8> = [200u8, 60, 30].repeat(w * h);
        let yuv = rgb_to_i420(w, h, &rgb);
        let (cw, ch) = (w / 2, h / 2);
        let back = i420_to_rgb(
            w,
            h,
            &yuv[..w * h],
            w,
            &yuv[w * h..w * h + cw * ch],
            cw,
            &yuv[w * h + cw * ch..],
            cw,
        );
        for (a, b) in rgb.iter().zip(back.iter()) {
            assert!((*a as i32 - *b as i32).abs() <= 3, "{a} vs {b}");
        }
    }
}

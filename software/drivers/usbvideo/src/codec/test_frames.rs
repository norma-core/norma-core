/// Smooth gradients, a moving blob and a little sensor noise, the same for
/// the same `t`.
pub fn camera_like(w: usize, h: usize, t: usize) -> Vec<u8> {
    let mut seed = (t as u32).wrapping_mul(2654435761).wrapping_add(1);
    let mut rgb = vec![0u8; w * h * 3];
    let (cx, cy) = ((w / 3 + t * 2) % w, (h / 2 + t) % h);
    for y in 0..h {
        for x in 0..w {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 24) % 7) as i32 - 3;
            let d = (x as i32 - cx as i32).pow(2) + (y as i32 - cy as i32).pow(2);
            let blob = if d < 900 { 80 } else { 0 };
            let i = (y * w + x) * 3;
            rgb[i] = (40 + x * 150 / w) as u8;
            rgb[i + 1] = ((60 + y * 120 / h) as i32 + blob + noise).clamp(0, 255) as u8;
            rgb[i + 2] = ((90 + (x + y) * 60 / (w + h)) as i32 + noise).clamp(0, 255) as u8;
        }
    }
    rgb
}

pub fn psnr(a: &[u8], b: &[u8]) -> f64 {
    let mse = a
        .iter()
        .zip(b)
        .map(|(x, y)| (*x as f64 - *y as f64).powi(2))
        .sum::<f64>()
        / a.len() as f64;
    10.0 * (255.0 * 255.0 / mse.max(1e-9)).log10()
}

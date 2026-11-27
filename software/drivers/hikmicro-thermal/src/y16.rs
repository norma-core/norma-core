use std::io;

const ZSTD_LEVEL: i32 = 1;

/// Packs one little-endian Y16 plane on its own, so any frame still decodes by id.
pub struct Y16Encoder {
    zstd: zstd::bulk::Compressor<'static>,
    pixels: Vec<u16>,
    planes: Vec<u8>,
}

impl Y16Encoder {
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            zstd: zstd::bulk::Compressor::new(ZSTD_LEVEL)?,
            pixels: Vec::new(),
            planes: Vec::new(),
        })
    }

    pub fn encode(&mut self, y16: &[u8], width: usize) -> io::Result<Vec<u8>> {
        let n = plane_pixels(y16.len(), width)?;
        self.pixels.clear();
        let (pairs, _) = y16.as_chunks::<2>();
        self.pixels
            .extend(pairs.iter().map(|&b| u16::from_le_bytes(b)));
        self.planes.resize(y16.len(), 0);
        let (lo, hi) = self.planes.split_at_mut(n);
        let px = &self.pixels;
        for row in (0..n).step_by(width) {
            for i in row..row + width {
                let residual = zigzag(px[i].wrapping_sub(predict(px, i, row, width)));
                lo[i] = residual as u8;
                hi[i] = (residual >> 8) as u8;
            }
        }
        self.zstd.compress(&self.planes)
    }
}

pub fn decode(data: &[u8], width: usize, height: usize) -> io::Result<Vec<u8>> {
    let len = width
        .checked_mul(height)
        .and_then(|n| n.checked_mul(2))
        .ok_or_else(|| invalid("Y16 plane size overflows"))?;
    let n = plane_pixels(len, width)?;
    let planes = zstd::bulk::decompress(data, len)?;
    if planes.len() != len {
        return Err(invalid(format!(
            "Y16 planes are {} bytes, expected {}",
            planes.len(),
            len
        )));
    }

    let mut px = vec![0u16; n];
    for row in (0..n).step_by(width) {
        for i in row..row + width {
            let residual = unzigzag(planes[i] as u16 | (planes[n + i] as u16) << 8);
            px[i] = predict(&px, i, row, width).wrapping_add(residual);
        }
    }
    Ok(px.iter().flat_map(|v| v.to_le_bytes()).collect())
}

fn plane_pixels(len: usize, width: usize) -> io::Result<usize> {
    match width.checked_mul(2) {
        Some(row) if width > 0 && len > 0 && len.is_multiple_of(row) => Ok(len / 2),
        _ => Err(invalid(format!(
            "{} bytes is not a whole Y16 plane of width {}",
            len, width
        ))),
    }
}

// MED from LOCO-I; the first row predicts from the left, the first column from above.
#[inline]
fn predict(px: &[u16], i: usize, row: usize, width: usize) -> u16 {
    if row == 0 {
        return if i == 0 { 0 } else { px[i - 1] };
    }
    if i == row {
        return px[i - width];
    }
    let (a, b, c) = (px[i - 1], px[i - width], px[i - width - 1]);
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    if c >= hi {
        lo
    } else if c <= lo {
        hi
    } else {
        // a + b - c, ordered so the u16 never overflows.
        lo + (hi - c)
    }
}

#[inline]
fn zigzag(r: u16) -> u16 {
    let r = r as i16;
    ((r << 1) ^ (r >> 15)) as u16
}

#[inline]
fn unzigzag(v: u16) -> u16 {
    (v >> 1) ^ (v & 1).wrapping_neg()
}

fn invalid(msg: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn le(plane: &[u16]) -> Vec<u8> {
        plane.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    fn round_trip(plane: &[u16], width: usize) -> Vec<u8> {
        let mut encoder = Y16Encoder::new().unwrap();
        let bytes = le(plane);
        let packed = encoder.encode(&bytes, width).unwrap();
        let height = plane.len() / width;
        assert_eq!(decode(&packed, width, height).unwrap(), bytes);
        packed
    }

    fn noise(seed: u64, n: usize) -> Vec<u16> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                s as u16
            })
            .collect()
    }

    #[test]
    fn round_trips_extremes_and_patterns() {
        let (w, h) = (256, 192);
        let n = w * h;
        let checker: Vec<u16> = (0..n)
            .map(|i| if (i % w + i / w) % 2 == 0 { 0 } else { 0xffff })
            .collect();
        let ramp: Vec<u16> = (0..n).map(|i| (i * 7) as u16).collect();
        let gradient: Vec<u16> = (0..n).map(|i| (i % w * 97 + i / w * 211) as u16).collect();
        let scene: Vec<u16> = noise(7, n).iter().map(|v| 7600 + (v & 7)).collect();
        for plane in [
            vec![0; n],
            vec![0xffff; n],
            vec![0x1234; n],
            checker,
            ramp,
            gradient,
            noise(1, n),
            scene,
        ] {
            round_trip(&plane, w);
        }
    }

    #[test]
    fn round_trips_odd_sizes() {
        for (w, h) in [(1, 1), (1, 7), (7, 1), (3, 5), (255, 193)] {
            round_trip(&noise((w * h) as u64, w * h), w);
        }
    }

    #[test]
    fn encoder_is_reusable_across_sizes() {
        let mut encoder = Y16Encoder::new().unwrap();
        for (w, h) in [(256, 192), (3, 5), (256, 192)] {
            let bytes = le(&noise(9, w * h));
            let packed = encoder.encode(&bytes, w).unwrap();
            assert_eq!(decode(&packed, w, h).unwrap(), bytes);
        }
    }

    #[test]
    fn smooth_frame_packs_small() {
        let (w, h) = (256, 192);
        let plane: Vec<u16> = (0..w * h).map(|i| 7000 + (i % w + i / w) as u16).collect();
        assert!(round_trip(&plane, w).len() < 1024);
    }

    #[test]
    fn rejects_partial_planes() {
        let mut encoder = Y16Encoder::new().unwrap();
        assert!(encoder.encode(&[], 256).is_err());
        assert!(encoder.encode(&[0; 6], 0).is_err());
        assert!(encoder.encode(&[0; 7], 1).is_err());
        assert!(encoder.encode(&[0; 10], 2).is_err());
        assert!(encoder.encode(&[0; 4], usize::MAX).is_err());
    }

    #[test]
    fn rejects_corrupt_or_mismatched_input() {
        let (w, h) = (16, 8);
        let packed = round_trip(&noise(3, w * h), w);
        assert!(decode(&[], w, h).is_err());
        assert!(decode(&packed[..packed.len() / 2], w, h).is_err());
        assert!(decode(&packed, w, h - 1).is_err());
        assert!(decode(&packed, w, h + 1).is_err());
        assert!(decode(&packed, 0, h).is_err());
        assert!(decode(&packed, usize::MAX, 3).is_err());
        assert!(decode(b"not a zstd frame", w, h).is_err());
        let mut flipped = packed.clone();
        for i in 0..flipped.len() {
            flipped[i] ^= 0x5a;
            let _ = decode(&flipped, w, h);
            flipped[i] ^= 0x5a;
        }
    }

    fn base64(bytes: &[u8]) -> String {
        const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for c in bytes.chunks(3) {
            let n = (c[0] as u32) << 16
                | (*c.get(1).unwrap_or(&0) as u32) << 8
                | *c.get(2).unwrap_or(&0) as u32;
            for k in 0..4 {
                out.push(if k <= c.len() {
                    ABC[(n >> (18 - 6 * k) & 63) as usize] as char
                } else {
                    '='
                });
            }
        }
        out
    }

    /// Prints the viewer's y16-fixtures.ts; run with `-- --ignored --nocapture`.
    #[test]
    #[ignore = "generator"]
    fn print_viewer_fixtures() {
        let mut encoder = Y16Encoder::new().unwrap();
        let mut x = 0x2545_f491u32;
        let mut noise = |n: usize| -> Vec<u16> {
            (0..n)
                .map(|_| {
                    x ^= x << 13;
                    x ^= x >> 17;
                    x ^= x << 5;
                    x as u16
                })
                .collect()
        };
        let small: Vec<(usize, usize, Vec<u16>)> = vec![
            (1, 1, vec![0xffff]),
            (7, 1, noise(7)),
            (1, 7, noise(7)),
            (
                5,
                3,
                (0..15)
                    .map(|i| if i % 2 == 0 { 0 } else { 0xffff })
                    .collect(),
            ),
            (9, 7, noise(63)),
            (4, 4, vec![0; 16]),
            (
                48,
                32,
                noise(48 * 32)
                    .iter()
                    .enumerate()
                    .map(|(i, v)| 7600 + (i % 48) as u16 * 2 + (i / 48) as u16 + (v & 15))
                    .collect(),
            ),
        ];
        println!(
            "// Encoded by hikmicro-thermal's Y16Encoder; regenerate with its ignored print_viewer_fixtures test."
        );
        println!(
            "export const SMALL_PLANES: {{ width: number; height: number; y16: string; encoded: string }}[] = ["
        );
        for (w, h, plane) in small {
            let raw = le(&plane);
            let packed = encoder.encode(&raw, w).unwrap();
            let (raw, packed) = (base64(&raw), base64(&packed));
            println!("  {{ width: {w}, height: {h}, y16: '{raw}', encoded: '{packed}' }},");
        }
        println!("];\n");
        // sensorFramePixel() in y16.test.ts.
        let pixel = |x: usize, y: usize| match (x, y) {
            (0, 0) | (255, 191) => 0xffff,
            (255, 0) | (0, 191) => 0,
            _ => (7600 + 3 * x + 5 * y + (x * y) % 4) as u16,
        };
        let full: Vec<u16> = (0..256 * 192).map(|i| pixel(i % 256, i / 256)).collect();
        let packed = encoder.encode(&le(&full), 256).unwrap();
        println!("export const SENSOR_FRAME_ENCODED = '{}';", base64(&packed));
    }
}

use bytes::Bytes;
use std::time::{Duration, Instant};
use usbvideo::codec::{VideoDecoder, VideoEncoder, Vp8Decoder, Vp8Encoder};

fn cpu_s() -> f64 {
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut ru) };
    let t = |tv: libc::timeval| tv.tv_sec as f64 + tv.tv_usec as f64 / 1e6;
    t(ru.ru_utime) + t(ru.ru_stime)
}

fn camera_like(w: usize, h: usize, t: usize) -> Vec<u8> {
    let mut seed = (t as u32).wrapping_mul(2654435761).wrapping_add(1);
    let mut rgb = vec![0u8; w * h * 3];
    let (cx, cy) = ((w / 3 + t * 2) % w, (h / 2 + t) % h);
    let r2 = (w * h / 60) as i32;
    for y in 0..h {
        for x in 0..w {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let noise = ((seed >> 24) % 7) as i32 - 3;
            let d = (x as i32 - cx as i32).pow(2) + (y as i32 - cy as i32).pow(2);
            let blob = if d < r2 { 80 } else { 0 };
            let i = (y * w + x) * 3;
            rgb[i] = (40 + x * 150 / w) as u8;
            rgb[i + 1] = ((60 + y * 120 / h) as i32 + blob + noise).clamp(0, 255) as u8;
            rgb[i + 2] = ((90 + (x + y) * 60 / (w + h)) as i32 + noise).clamp(0, 255) as u8;
        }
    }
    rgb
}

const MIN: Duration = Duration::from_secs(30);

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 || !matches!(args[1].as_str(), "jpeg" | "vp8") {
        eprintln!(
            "usage: codec_bench <jpeg|vp8> <width> <height> <round>\n\
             encodes then decodes {}s of camera-like frames at that size",
            MIN.as_secs()
        );
        std::process::exit(2);
    }
    let (codec, w, h, round) = (
        args[1].as_str(),
        args[2].parse::<usize>().unwrap(),
        args[3].parse::<usize>().unwrap(),
        &args[4],
    );
    let frames: Vec<Vec<u8>> = (0..300).map(|t| camera_like(w, h, t)).collect();

    // Encode for at least MIN, a keyframe every 30 frames as at 30 fps.
    let mut packets: Vec<Vec<u8>> = Vec::new();
    let (mut n, mut bytes) = (0usize, 0usize);
    let mut enc = (codec == "vp8").then(|| Vp8Encoder::new(w as u32, h as u32).unwrap());
    let (start, c0) = (Instant::now(), cpu_s());
    while start.elapsed() < MIN {
        let f = &frames[n % frames.len()];
        let data = match &mut enc {
            Some(e) => e.encode(f, n % 30 == 0).unwrap().data,
            None => {
                usbvideo::convert_rgb_to_jpeg(w as u16, h as u16, Bytes::copy_from_slice(f), 90)
                    .unwrap()
                    .to_vec()
            }
        };
        bytes += data.len();
        if packets.len() < 300 {
            packets.push(data);
        }
        n += 1;
    }
    let enc_cpu = cpu_s() - c0;
    let enc_wall = start.elapsed().as_secs_f64();

    // Decode the first 300 packets over and over for at least MIN.
    let (mut m, start, c1) = (0usize, Instant::now(), cpu_s());
    let mut dec = (codec == "vp8").then(|| Vp8Decoder::new().unwrap());
    while start.elapsed() < MIN {
        let i = m % packets.len();
        match &mut dec {
            Some(d) => {
                if i == 0 {
                    *d = Vp8Decoder::new().unwrap();
                }
                d.decode(&packets[i]).unwrap();
            }
            None => {
                usbvideo::convert_mjpeg_to_rgb(
                    w as u16,
                    h as u16,
                    &Bytes::copy_from_slice(&packets[i]),
                )
                .unwrap();
            }
        }
        m += 1;
    }
    let dec_cpu = cpu_s() - c1;
    let dec_wall = start.elapsed().as_secs_f64();
    println!(
        "RESULT codec={codec} size={w}x{h} round={round} frames={n} bytes_per_frame={} enc_cpu_us={:.1} enc_wall_s={:.1} dec_frames={m} dec_cpu_us={:.1} dec_wall_s={:.1}",
        bytes / n,
        enc_cpu / n as f64 * 1e6,
        enc_wall,
        dec_cpu / m as f64 * 1e6,
        dec_wall
    );
}

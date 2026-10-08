use std::ffi::{CStr, c_char, c_int, c_uint};
use std::ptr;

use super::{DecodedFrame, EncodedFrame, VideoDecoder, VideoEncoder, i420_to_rgb, rgb_to_i420};

/// Lower is better; 63 is the worst. The bitrate cap binds first on busy
/// scenes, so this only decides how little a still scene costs.
const CQ_LEVEL: c_int = 24;
/// Negative is a fixed realtime speed; a positive value makes libvpx pick one
/// from encode times against the 30 fps the shim assumes.
const CPU_USED: c_int = -12;

#[repr(C)]
struct RawEncoder {
    _private: [u8; 0],
}

#[repr(C)]
struct RawDecoder {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn nc_vp8_enc_new(
        w: c_uint,
        h: c_uint,
        cq_level: c_int,
        cpu_used: c_int,
        msg: *mut c_char,
        msg_len: usize,
    ) -> *mut RawEncoder;
    #[allow(clippy::too_many_arguments)]
    fn nc_vp8_enc_encode(
        e: *mut RawEncoder,
        i420: *mut u8,
        force_keyframe: c_int,
        out: *mut *const u8,
        out_len: *mut usize,
        keyframe: *mut c_int,
        msg: *mut c_char,
        msg_len: usize,
    ) -> c_int;
    fn nc_vp8_enc_free(e: *mut RawEncoder);
    fn nc_vp8_dec_new(msg: *mut c_char, msg_len: usize) -> *mut RawDecoder;
    #[allow(clippy::too_many_arguments)]
    fn nc_vp8_dec_decode(
        d: *mut RawDecoder,
        data: *const u8,
        len: usize,
        w: *mut c_uint,
        h: *mut c_uint,
        planes: *mut *const u8,
        strides: *mut c_int,
        msg: *mut c_char,
        msg_len: usize,
    ) -> c_int;
    fn nc_vp8_dec_free(d: *mut RawDecoder);
}

fn message(buf: &[c_char; 256]) -> String {
    // SAFETY: the shim always NUL-terminates through snprintf.
    unsafe { CStr::from_ptr(buf.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

pub struct Vp8Encoder {
    raw: *mut RawEncoder,
    width: u32,
    height: u32,
}

// SAFETY: the encoder is only touched through &mut self.
unsafe impl Send for Vp8Encoder {}

impl Vp8Encoder {
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err(format!(
                "VP8 needs even, non-zero dimensions, got {width}x{height}"
            ));
        }
        let mut msg = [0 as c_char; 256];
        // SAFETY: the message buffer outlives the call.
        let raw = unsafe {
            nc_vp8_enc_new(
                width,
                height,
                CQ_LEVEL,
                CPU_USED,
                msg.as_mut_ptr(),
                msg.len(),
            )
        };
        if raw.is_null() {
            return Err(message(&msg));
        }
        Ok(Self { raw, width, height })
    }
}

impl VideoEncoder for Vp8Encoder {
    fn width(&self) -> u32 {
        self.width
    }

    fn height(&self) -> u32 {
        self.height
    }

    fn encode(&mut self, rgb: &[u8], force_keyframe: bool) -> Result<EncodedFrame, String> {
        let (w, h) = (self.width as usize, self.height as usize);
        if rgb.len() != w * h * 3 {
            return Err(format!(
                "expected {} RGB bytes, got {}",
                w * h * 3,
                rgb.len()
            ));
        }
        let mut yuv = rgb_to_i420(w, h, rgb);
        let (mut out, mut out_len, mut keyframe) = (ptr::null(), 0usize, 0 as c_int);
        let mut msg = [0 as c_char; 256];
        // SAFETY: `yuv` is a full I420 frame of the encoder's size; the packet
        // is copied out before the next call on the encoder.
        let rc = unsafe {
            nc_vp8_enc_encode(
                self.raw,
                yuv.as_mut_ptr(),
                force_keyframe as c_int,
                &mut out,
                &mut out_len,
                &mut keyframe,
                msg.as_mut_ptr(),
                msg.len(),
            )
        };
        if rc != 0 {
            return Err(message(&msg));
        }
        Ok(EncodedFrame {
            // SAFETY: the shim points `out` at `out_len` bytes it owns.
            data: unsafe { std::slice::from_raw_parts(out, out_len) }.to_vec(),
            keyframe: keyframe != 0,
        })
    }
}

impl Drop for Vp8Encoder {
    fn drop(&mut self) {
        // SAFETY: created by nc_vp8_enc_new and freed once.
        unsafe { nc_vp8_enc_free(self.raw) }
    }
}

pub struct Vp8Decoder {
    raw: *mut RawDecoder,
}

// SAFETY: the decoder is only touched through &mut self.
unsafe impl Send for Vp8Decoder {}

impl Vp8Decoder {
    pub fn new() -> Result<Self, String> {
        let mut msg = [0 as c_char; 256];
        // SAFETY: the message buffer outlives the call.
        let raw = unsafe { nc_vp8_dec_new(msg.as_mut_ptr(), msg.len()) };
        if raw.is_null() {
            return Err(message(&msg));
        }
        Ok(Self { raw })
    }
}

impl VideoDecoder for Vp8Decoder {
    fn decode(&mut self, packet: &[u8]) -> Result<DecodedFrame, String> {
        let (mut w, mut h) = (0 as c_uint, 0 as c_uint);
        let mut planes = [ptr::null::<u8>(); 3];
        let mut strides = [0 as c_int; 3];
        let mut msg = [0 as c_char; 256];
        // SAFETY: the packet is borrowed for the call; the planes belong to
        // the decoder and are converted before the next call on it.
        unsafe {
            let rc = nc_vp8_dec_decode(
                self.raw,
                packet.as_ptr(),
                packet.len(),
                &mut w,
                &mut h,
                planes.as_mut_ptr(),
                strides.as_mut_ptr(),
                msg.as_mut_ptr(),
                msg.len(),
            );
            if rc != 0 {
                return Err(message(&msg));
            }
            let (w, h) = (w as usize, h as usize);
            let (ys, us, vs) = (
                strides[0] as usize,
                strides[1] as usize,
                strides[2] as usize,
            );
            let (c_rows, c_cols) = (h.div_ceil(2), w.div_ceil(2));
            let y = std::slice::from_raw_parts(planes[0], ys * (h - 1) + w);
            let u = std::slice::from_raw_parts(planes[1], us * (c_rows - 1) + c_cols);
            let v = std::slice::from_raw_parts(planes[2], vs * (c_rows - 1) + c_cols);
            Ok(DecodedFrame {
                width: w as u32,
                height: h as u32,
                rgb: i420_to_rgb(w, h, y, ys, u, us, v, vs),
            })
        }
    }
}

impl Drop for Vp8Decoder {
    fn drop(&mut self) {
        // SAFETY: created by nc_vp8_dec_new and freed once.
        unsafe { nc_vp8_dec_free(self.raw) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::test_frames::{camera_like, psnr};

    #[test]
    fn frames_round_trip_with_keyframes_where_asked() {
        let (w, h) = (298, 224);
        let mut enc = Vp8Encoder::new(w, h).unwrap();
        let mut dec = Vp8Decoder::new().unwrap();
        for t in 0..20 {
            let src = camera_like(w as usize, h as usize, t);
            let packet = enc.encode(&src, t == 0 || t == 10).unwrap();
            assert_eq!(packet.keyframe, t == 0 || t == 10, "frame {t}");
            let out = dec.decode(&packet.data).unwrap();
            assert_eq!((out.width, out.height), (w, h));
            assert!(
                psnr(&src, &out.rgb) > 30.0,
                "frame {t}: {}",
                psnr(&src, &out.rgb)
            );
        }
    }

    #[test]
    fn odd_dimensions_are_refused() {
        assert!(Vp8Encoder::new(223, 168).is_err());
    }

    #[test]
    fn a_p_frame_alone_does_not_decode_to_a_picture() {
        let (w, h) = (64, 48);
        let mut enc = Vp8Encoder::new(w, h).unwrap();
        let _key = enc.encode(&camera_like(64, 48, 0), true).unwrap();
        let p = enc.encode(&camera_like(64, 48, 1), false).unwrap();
        assert!(!p.keyframe);
        let mut dec = Vp8Decoder::new().unwrap();
        assert!(dec.decode(&p.data).is_err());
    }
}

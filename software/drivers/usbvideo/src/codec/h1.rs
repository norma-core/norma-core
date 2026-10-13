use std::ffi::{CStr, c_char, c_int, c_uint};
use std::ptr;

use super::{EncodedFrame, VideoEncoder, rgb_to_i420};

#[repr(C)]
struct RawEncoder {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn nc_h1_enc_new(w: c_uint, h: c_uint, msg: *mut c_char, msg_len: usize) -> *mut RawEncoder;
    #[allow(clippy::too_many_arguments)]
    fn nc_h1_enc_encode(
        e: *mut RawEncoder,
        i420: *const u8,
        force_keyframe: c_int,
        out: *mut *const u8,
        out_len: *mut usize,
        keyframe: *mut c_int,
        msg: *mut c_char,
        msg_len: usize,
    ) -> c_int;
    fn nc_h1_enc_free(e: *mut RawEncoder);
}

fn message(buf: &[c_char; 256]) -> String {
    // SAFETY: the shim always NUL-terminates through snprintf.
    unsafe { CStr::from_ptr(buf.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

/// VP8 in the i.MX 8M Mini's H1 hardware encoder.
pub struct H1Encoder {
    raw: *mut RawEncoder,
    width: u32,
    height: u32,
}

// SAFETY: the encoder is only touched through &mut self.
unsafe impl Send for H1Encoder {}

impl H1Encoder {
    /// Fails where libhantro_h1 or the H1 device is missing.
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        if width == 0 || height == 0 || !width.is_multiple_of(4) || !height.is_multiple_of(2) {
            return Err(format!(
                "H1 needs a width in fours and an even height, got {width}x{height}"
            ));
        }
        let mut msg = [0 as c_char; 256];
        // SAFETY: the message buffer outlives the call.
        let raw = unsafe { nc_h1_enc_new(width, height, msg.as_mut_ptr(), msg.len()) };
        if raw.is_null() {
            return Err(message(&msg));
        }
        Ok(Self { raw, width, height })
    }
}

impl VideoEncoder for H1Encoder {
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
        let yuv = rgb_to_i420(w, h, rgb);
        let (mut out, mut out_len, mut keyframe) = (ptr::null(), 0usize, 0 as c_int);
        let mut msg = [0 as c_char; 256];
        // SAFETY: `yuv` is a full I420 frame of the encoder's size; the packet
        // is copied out before the next call on the encoder.
        let rc = unsafe {
            nc_h1_enc_encode(
                self.raw,
                yuv.as_ptr(),
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

impl Drop for H1Encoder {
    fn drop(&mut self) {
        // SAFETY: created by nc_h1_enc_new and freed once.
        unsafe { nc_h1_enc_free(self.raw) }
    }
}

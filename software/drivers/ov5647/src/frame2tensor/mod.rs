mod jpeg;

pub use jpeg::JpegEncoder;

use bytes::Bytes;

use crate::buffer::{FrameData, PixelFormat};
use crate::config::Quality;
use crate::error::Result;

pub struct ConvertResult {
    pub jpeg: Bytes,
}

pub fn convert_frame(frame: &FrameData, jpeg_quality: Quality) -> Result<ConvertResult> {
    if frame.format == PixelFormat::Mjpeg {
        return Ok(ConvertResult {
            jpeg: Bytes::from(frame.buffer.clone()),
        });
    }

    let encoder = JpegEncoder::new(jpeg_quality);
    let jpeg_data = encoder.encode(frame)?;

    Ok(ConvertResult {
        jpeg: Bytes::from(jpeg_data),
    })
}

//! Frame processing and conversion utilities.
//!
//! This module provides conversion from raw camera frames to JPEG for browser display.

mod jpeg;

pub use jpeg::JpegEncoder;

use bytes::Bytes;

use crate::buffer::{FrameData, PixelFormat};
use crate::config::Quality;
use crate::error::Result;

/// Result of frame conversion containing JPEG data.
pub struct ConvertResult {
    pub jpeg: Bytes,
}

/// Process a raw frame into JPEG format.
pub fn convert_frame(
    frame: &FrameData,
    jpeg_quality: Quality,
) -> Result<ConvertResult> {
    // MJPEG input is already JPEG — return directly
    if frame.format == PixelFormat::Mjpeg {
        return Ok(ConvertResult {
            jpeg: Bytes::from(frame.buffer.clone()),
        });
    }

    // For all other formats, encode to JPEG via TurboJPEG
    let encoder = JpegEncoder::new(jpeg_quality);
    let jpeg_data = encoder.encode(frame)?;

    Ok(ConvertResult {
        jpeg: Bytes::from(jpeg_data),
    })
}

mod chain;
mod keyframes;
#[cfg(test)]
pub(crate) mod test_frames;
mod vp8;
mod yuv;

pub use chain::{ChainError, FrameReader, decode_chain, keyframe_of};
pub use keyframes::{KEYFRAME_INTERVAL_NS, KeyframePolicy};
pub use vp8::{Vp8Decoder, Vp8Encoder};
pub use yuv::{i420_to_rgb, rgb_to_i420};

/// Which codec frames are stored with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VideoCodec {
    /// One JPEG per entry, each decodable alone.
    #[default]
    Jpeg,
    Vp8,
}

pub struct EncodedFrame {
    pub data: Vec<u8>,
    pub keyframe: bool,
}

/// Turns RGB frames of one size into packets, one packet per frame.
pub trait VideoEncoder: Send {
    fn width(&self) -> u32;
    fn height(&self) -> u32;
    fn encode(&mut self, rgb: &[u8], force_keyframe: bool) -> Result<EncodedFrame, String>;
}

/// Turns packets back into RGB, in the order they were encoded.
pub trait VideoDecoder: Send {
    fn decode(&mut self, packet: &[u8]) -> Result<DecodedFrame, String>;
}

#[derive(Clone, PartialEq, Eq)]
pub struct DecodedFrame {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<u8>,
}

impl std::fmt::Debug for DecodedFrame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DecodedFrame")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("rgb_len", &self.rgb.len())
            .finish()
    }
}

//! Camera configuration types.

use std::path::PathBuf;

pub const DEFAULT_WIDTH: u32 = 320;
pub const DEFAULT_HEIGHT: u32 = 240;

/// Capture configuration parameters.
#[derive(Debug, Clone)]
pub struct CaptureConfig {
    /// Image width.
    pub width: u32,
    /// Image height.
    pub height: u32,
    /// JPEG quality.
    pub quality: Quality,
    /// Optional path to save raw frame bytes.
    pub raw_output_path: Option<PathBuf>,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            quality: Quality::MEDIUM,
            raw_output_path: None,
        }
    }
}

/// JPEG quality setting (1-100).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quality(u8);

impl Quality {
    /// High quality (95).
    pub const HIGH: Quality = Quality(95);
    /// Medium quality (80).
    pub const MEDIUM: Quality = Quality(80);
    /// Low quality (60).
    pub const LOW: Quality = Quality(60);

    /// Create a custom quality value.
    ///
    /// Value is clamped to 1-100.
    #[allow(dead_code)]
    pub fn new(value: u8) -> Self {
        Quality(value.clamp(1, 100))
    }

    /// Get the quality value.
    pub fn value(&self) -> u8 {
        self.0
    }
}

impl Default for Quality {
    fn default() -> Self {
        Quality::MEDIUM
    }
}

impl From<u8> for Quality {
    fn from(value: u8) -> Self {
        Quality::new(value)
    }
}

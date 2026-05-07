use std::path::PathBuf;

pub const DEFAULT_WIDTH: u32 = 320;
pub const DEFAULT_HEIGHT: u32 = 240;

#[derive(Debug, Clone)]
pub struct CaptureConfig {
    pub width: u32,
    pub height: u32,
    pub quality: Quality,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quality(u8);

impl Quality {
    pub const HIGH: Quality = Quality(95);
    pub const MEDIUM: Quality = Quality(80);
    pub const LOW: Quality = Quality(60);

    pub fn new(value: u8) -> Self {
        Quality(value.clamp(1, 100))
    }

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

use std::io;

#[cfg(target_os = "linux")]
use crate::buffer::PixelFormat;

pub type Result<T> = std::result::Result<T, Ov5647Error>;

#[derive(Debug, thiserror::Error)]
pub enum Ov5647Error {
    #[error("failed to initialize camera manager")]
    ManagerInitFailed,

    #[error("no cameras found")]
    NoCamerasFound,

    #[error("camera not found: {0}")]
    CameraNotFound(String),

    #[error("failed to acquire camera (may be in use by another process)")]
    AcquireFailed,

    #[error("camera is busy")]
    CameraBusy,

    #[error("failed to configure camera: {0}")]
    ConfigurationFailed(String),

    #[error("invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("failed to allocate buffers")]
    BufferAllocationFailed,

    #[error("failed to start capture")]
    StartFailed,

    #[error("failed to queue request")]
    QueueRequestFailed,

    #[error("capture session closed")]
    SessionClosed,

    #[error("capture timeout after {0}ms")]
    CaptureTimeout(u64),

    #[error("failed to map buffer: {0}")]
    BufferMapFailed(String),

    #[error("invalid frame: {0}")]
    FrameInvalid(String),

    #[cfg(target_os = "linux")]
    #[error("unsupported pixel format: {0:?}")]
    UnsupportedFormat(PixelFormat),

    #[error("JPEG encoding failed: {0}")]
    EncodingFailed(String),

    #[error("NormFS error: {0}")]
    NormFs(String),

    #[error("I/O error: {0}")]
    Io(#[from] io::Error),

    #[error("not supported: {0}")]
    NotSupported(String),
}

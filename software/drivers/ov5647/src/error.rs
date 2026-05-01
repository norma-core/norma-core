//! Error types for the OV5647 camera driver.

use std::io;

use crate::buffer::PixelFormat;

/// Result type alias for camera operations.
pub type Result<T> = std::result::Result<T, Ov5647Error>;

/// Errors that can occur during camera operations.
#[derive(Debug, thiserror::Error)]
pub enum Ov5647Error {
    /// Camera manager failed to initialize.
    #[error("failed to initialize camera manager")]
    ManagerInitFailed,

    /// No cameras were found on the system.
    #[error("no cameras found")]
    NoCamerasFound,

    /// The specified camera was not found.
    #[error("camera not found: {0}")]
    CameraNotFound(String),

    /// Failed to acquire the camera (may be in use).
    #[error("failed to acquire camera (may be in use by another process)")]
    AcquireFailed,

    /// Camera is busy.
    #[error("camera is busy")]
    CameraBusy,

    /// Failed to configure the camera.
    #[error("failed to configure camera: {0}")]
    ConfigurationFailed(String),

    /// Invalid configuration parameters.
    #[error("invalid configuration: {0}")]
    InvalidConfiguration(String),

    /// Failed to allocate buffers.
    #[error("failed to allocate buffers")]
    BufferAllocationFailed,

    /// Failed to start capture.
    #[error("failed to start capture")]
    StartFailed,

    /// Failed to queue capture request.
    #[error("failed to queue request")]
    QueueRequestFailed,

    /// Capture session was closed.
    #[error("capture session closed")]
    SessionClosed,

    /// Capture timeout.
    #[error("capture timeout after {0}ms")]
    CaptureTimeout(u64),

    /// Buffer mapping failed.
    #[error("failed to map buffer: {0}")]
    BufferMapFailed(String),

    /// Frame metadata indicates an invalid frame.
    #[error("invalid frame: {0}")]
    FrameInvalid(String),

    /// Unsupported pixel format.
    #[error("unsupported pixel format: {0:?}")]
    UnsupportedFormat(PixelFormat),

    /// JPEG encoding failed.
    #[error("JPEG encoding failed: {0}")]
    EncodingFailed(String),

    /// NormFS error.
    #[error("NormFS error: {0}")]
    NormFs(String),

    /// I/O error.
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),

    /// Platform not supported.
    #[error("not supported: {0}")]
    NotSupported(String),
}

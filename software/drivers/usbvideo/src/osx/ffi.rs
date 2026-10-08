//! FFI bindings to the avcameras C API

use libc::{c_char, size_t};

/// C-compatible structure for device information
#[repr(C)]
#[derive(Debug, Clone)]
pub struct CameraDeviceInfo {
    pub unique_id: [c_char; 256],
    pub model_id: [c_char; 256],
    pub localized_name: [c_char; 256],
    pub manufacturer: [c_char; 256],
    pub position: i32, // 0=unspecified, 1=back, 2=front
    pub device_type: [c_char; 128],
    pub has_flash: bool,
    pub has_torch: bool,
    pub is_connected: bool,
    pub is_suspended: bool,
}

/// C-compatible structure for format information
#[repr(C)]
#[derive(Debug, Clone)]
pub struct CameraFormatInfo {
    pub index: u32,
    pub width: i32,
    pub height: i32,
    pub min_frame_rate: f64,
    pub max_frame_rate: f64,
    pub pixel_format: u32,
    pub pixel_format_string: [c_char; 5],
    pub is_high_photo_quality_supported: bool,
}

/// Frame data structure
#[repr(C)]
#[derive(Debug, Clone)]
pub struct CameraFrameInfo {
    pub width: i32,
    pub height: i32,
    pub pixel_format: u32,
    pub pixel_format_string: [c_char; 5],
    pub monotonic_timestamp_ns: u64,
    pub local_timestamp_ns: u64,
    pub frame_number: i64,
    pub data_size: size_t,
}

#[link(name = "avf", kind = "static")]
unsafe extern "C" {
    /// Request camera access permission asynchronously; the callback gets 1 if granted, 0 if denied
    pub fn requestCameraAccessAsync(callback: unsafe extern "C" fn(granted: i32));

    /// Get the current camera authorization status (0=not determined, 1=restricted, 2=denied, 3=authorized)
    pub fn getCameraAuthorizationStatus() -> i32;

    /// Get the number of available video devices
    pub fn getVideoDeviceCount() -> i32;

    /// Get device info by index (returns 0 on success, -1 on error)
    pub fn getVideoDeviceInfo(index: i32, device_info: *mut CameraDeviceInfo) -> i32;

    /// Get the number of formats for a specific device
    pub fn getFormatCountForDevice(device_id: *const c_char) -> i32;

    /// Get format info by index for a specific device (returns 0 on success, -1 on error)
    pub fn getFormatInfo(
        device_id: *const c_char,
        format_index: i32,
        format_info: *mut CameraFormatInfo,
    ) -> i32;

    /// Create a capture session for a device with specific format
    /// Returns session ID (>= 0) on success, -1 on error
    pub fn createCaptureSession(
        device_id: *const c_char,
        format_index: i32,
        buffer_count: i32,
    ) -> i32;

    /// Start capturing frames
    /// Returns 0 on success, -1 on error
    pub fn startCapture(session_id: i32) -> i32;

    /// Stop capturing frames
    /// Returns 0 on success, -1 on error
    pub fn stopCapture(session_id: i32) -> i32;

    /// Get the next available frame (non-blocking)
    /// Returns 0 if frame available, -1 if no frame available, -2 on error
    pub fn getNextFrame(
        session_id: i32,
        frame_info: *mut CameraFrameInfo,
        buffer: *mut u8,
        buffer_size: size_t,
        actual_size: *mut size_t,
    ) -> i32;

    /// Get the number of frames currently available in the buffer
    /// Returns frame count (>= 0) on success, -1 on error
    pub fn getAvailableFrameCount(session_id: i32) -> i32;

    /// Destroy capture session and free resources
    /// Returns 0 on success, -1 on error
    pub fn destroyCaptureSession(session_id: i32) -> i32;

    /// Process main run loop briefly to handle notifications
    /// Call this periodically (e.g. every 100ms) from your main thread
    pub fn processMainRunLoop();
}

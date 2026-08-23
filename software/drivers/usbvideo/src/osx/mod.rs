mod ffi;

use bytes::Bytes;
use log::error;
use std::ffi::{CStr, CString};
use std::mem::MaybeUninit;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

use crate::converters;
use crate::pipeline::{CaptureResult, USBCameraDriver};
use crate::state::StateTracker;
use crate::usbvideo_proto::frame::FrameStamp;
use crate::usbvideo_proto::usbvideo as framesrec_proto;
use station_iface::StationEngine;

pub struct CameraMacDriver {
    enabled: bool,
}

impl Default for CameraMacDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl CameraMacDriver {
    pub fn new() -> Self {
        let enabled = unsafe { ffi::requestCameraAccess() == 0 };
        Self { enabled }
    }
}

impl USBCameraDriver for CameraMacDriver {
    async fn get_available_cameras(&self) -> Vec<framesrec_proto::Camera> {
        if !self.enabled {
            return vec![];
        }

        let cnt = unsafe { ffi::getVideoDeviceCount() };

        if cnt < 0 {
            log::warn!("Failed to get video device count: {}", cnt);
            return vec![];
        }

        let cnt = cnt as usize;

        let mut cameras = Vec::with_capacity(cnt);
        for idx in 0..cnt {
            unsafe {
                let mut info = MaybeUninit::<ffi::CameraDeviceInfo>::uninit();
                let result = ffi::getVideoDeviceInfo(idx as i32, info.as_mut_ptr());

                if result == 0 {
                    let info = &info.assume_init();

                    let info = framesrec_proto::Camera {
                        unique_id: CStr::from_ptr(info.unique_id.as_ptr())
                            .to_string_lossy()
                            .to_string(),
                        product: CStr::from_ptr(info.model_id.as_ptr())
                            .to_string_lossy()
                            .to_string(),
                        manufacturer: CStr::from_ptr(info.manufacturer.as_ptr())
                            .to_string_lossy()
                            .to_string(),
                        ..Default::default()
                    };

                    cameras.push(info);
                } else {
                    log::warn!(
                        "Failed to get video device info for index {}: {}",
                        idx,
                        result
                    );
                    continue;
                }
            }
        }

        cameras
    }

    async fn get_camera_formats(
        &self,
        camera: &framesrec_proto::Camera,
    ) -> Vec<framesrec_proto::CameraFormat> {
        let c_device_id = CString::new(camera.unique_id.clone()).unwrap();
        let formats_cnt = unsafe { ffi::getFormatCountForDevice(c_device_id.as_ptr()) };

        if formats_cnt < 0 {
            log::warn!(
                "Failed to get format count for device {}: {}",
                camera.unique_id,
                formats_cnt
            );
            return vec![];
        }

        let formats_cnt = formats_cnt as usize;
        let mut formats = Vec::with_capacity(formats_cnt);

        for idx in 0..formats_cnt {
            unsafe {
                let mut info = MaybeUninit::<ffi::CameraFormatInfo>::uninit();
                let result =
                    ffi::getFormatInfo(c_device_id.as_ptr(), idx as i32, info.as_mut_ptr());

                if result == 0 {
                    let info = &info.assume_init();
                    let format = framesrec_proto::CameraFormat {
                        fourcc: info.pixel_format,
                        index: idx as u32,
                        width: info.width as u32,
                        height: info.height as u32,
                        frames_per_second: info.max_frame_rate as f32,
                        ..Default::default()
                    };

                    formats.push(format);
                } else {
                    log::warn!(
                        "Failed to get format info for device {} index {}: {}",
                        camera.unique_id,
                        idx,
                        result
                    );
                    continue;
                }
            }
        }

        formats
    }

    async fn run_capture<K: StationEngine + Send + Sync>(
        &self,
        tracker: Arc<StateTracker<K>>,
        camera: &framesrec_proto::Camera,
        format: &framesrec_proto::CameraFormat,
        format_revision: u64,
        queue_id: &normfs::QueueId,
    ) -> CaptureResult {
        let c_device_id = CString::new(camera.unique_id.clone()).unwrap();

        log::info!(
            "Starting capture for camera {} with format {:?}",
            camera.unique_id,
            format
        );

        let session_id =
            unsafe { ffi::createCaptureSession(c_device_id.as_ptr(), format.index as i32, 1) };

        if session_id < 0 {
            error!(
                "Failed to create capture session for camera {}: {}",
                camera.unique_id, session_id
            );
            return CaptureResult {
                has_frames: false,
                error_message: Some(format!("Failed to create capture session: {}", session_id)),
            };
        }

        let start_res = unsafe { ffi::startCapture(session_id) };
        if start_res != 0 {
            error!(
                "Failed to start capture session for camera {}: {}",
                camera.unique_id, start_res
            );
            unsafe {
                ffi::destroyCaptureSession(session_id);
            }
            return CaptureResult {
                has_frames: false,
                error_message: Some(format!("Failed to start capture session: {}", start_res)),
            };
        }

        let mut frame_index = 0;
        let mut last_frame_time = Instant::now();
        loop {
            let max_buffer_size = 1920 * 1080 * 4;
            let mut buffer = vec![0u8; max_buffer_size];

            let mut frame_info = MaybeUninit::<ffi::CameraFrameInfo>::uninit();
            let mut actual_size: usize = 0;

            let frame_cnt = unsafe { ffi::getAvailableFrameCount(session_id) };

            if last_frame_time.elapsed() > Duration::from_secs(300) {
                error!(
                    "No frames received from camera {} for 5 minutes, stopping capture.",
                    camera.unique_id
                );
                unsafe {
                    ffi::stopCapture(session_id);
                }
                unsafe {
                    ffi::destroyCaptureSession(session_id);
                }
                return CaptureResult {
                    has_frames: frame_index > 0,
                    error_message: Some("No frames received for 5 minutes".to_string()),
                };
            }

            if frame_cnt == 0 {
                if last_frame_time.elapsed() > Duration::from_secs(5) {
                    log::warn!("No new frames in 5 seconds, exiting capture loop.");
                    break;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
                continue;
            }

            if frame_cnt > 1 {
                // skip all but latest
                for _ in 0..(frame_cnt - 1) {
                    let _ = unsafe {
                        ffi::getNextFrame(
                            session_id,
                            frame_info.as_mut_ptr(),
                            buffer.as_mut_ptr(),
                            buffer.len(),
                            &mut actual_size,
                        )
                    };
                }
            }

            let result = unsafe {
                ffi::getNextFrame(
                    session_id,
                    frame_info.as_mut_ptr(),
                    buffer.as_mut_ptr(),
                    buffer.len(),
                    &mut actual_size,
                )
            };

            if result == -1 {
                // no frames available
                if last_frame_time.elapsed() > Duration::from_secs(5) {
                    log::warn!("No new frames in 5 seconds, exiting capture loop.");
                    break;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
                continue;
            } else if result == 0 {
                last_frame_time = Instant::now();
                let frame_info = unsafe { frame_info.assume_init() };
                buffer.truncate(actual_size);

                let format = converters::FourCCFormat::from_fourcc_u32(frame_info.pixel_format);
                if format.is_none() {
                    error!(
                        "Unsupported pixel format {} for camera {}",
                        frame_info.pixel_format, camera.unique_id
                    );
                    unsafe {
                        ffi::stopCapture(session_id);
                    }
                    unsafe {
                        ffi::destroyCaptureSession(session_id);
                    }
                    break;
                }
                let format = format.unwrap();

                tracker.enqueue_frame(
                    queue_id,
                    format,
                    camera,
                    FrameStamp {
                        monotonic_stamp_ns: frame_info.monotonic_timestamp_ns,
                        local_stamp_ns: frame_info.local_timestamp_ns,
                        app_start_id: systime::get_app_start_id(),
                        index: frame_index,
                    },
                    format_revision,
                    frame_info.width as u32,
                    frame_info.height as u32,
                    Bytes::from(buffer),
                );

                frame_index += 1;

                tokio::time::sleep(Duration::from_millis(1)).await;
            } else {
                // error
                error!("Error capturing frame from camera {}", camera.unique_id);
                break;
            }
        }

        unsafe {
            ffi::stopCapture(session_id);
            ffi::destroyCaptureSession(session_id);
        }

        CaptureResult {
            has_frames: frame_index > 0,
            error_message: Some("Not implemented on macOS yet".to_string()),
        }
    }

    async fn stop(&self) {}
}

/// Process main run loop briefly to handle AVFoundation notifications
/// Call this periodically (e.g. every 100ms) from your main thread
pub fn process_main_run_loop() {
    unsafe {
        ffi::processMainRunLoop();
    }
}

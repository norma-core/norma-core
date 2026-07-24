use station_iface::StationEngine;
use tokio::time::Duration;
use tokio::sync::{broadcast, Notify};
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use std::future::Future;
use std::time::Instant;
use norm_uvc_sys;
mod ffi;

use crate::{
    pipeline::{CaptureResult, USBCameraDriver},
    usbvideo_proto::{usbvideo, frame::FrameStamp},
    converters::FourCCFormat,
    state::StateTracker
};

pub struct CameraLinuxDriver {
    ctx: *mut norm_uvc_sys::uvc_context,
    stop_tx: broadcast::Sender<()>,
    active_streams: Arc<AtomicUsize>,
    all_stopped_notify: Arc<Notify>,
}

unsafe impl Send for CameraLinuxDriver {}
unsafe impl Sync for CameraLinuxDriver {}

impl CameraLinuxDriver {
    pub fn new() -> Self {
        let ctx = match ffi::new_uvc_context() {
            Ok(ctx) => ctx,
            Err(e) => {
                log::error!("Failed to create UVC context: {}", e);
                std::ptr::null_mut()
            }
        };
        let (stop_tx, _) = broadcast::channel(1);
        Self {
            ctx,
            stop_tx,
            active_streams: Arc::new(AtomicUsize::new(0)),
            all_stopped_notify: Arc::new(Notify::new()),
        }
    }
}

impl USBCameraDriver for CameraLinuxDriver {

    fn stop(&self) -> impl Future<Output = ()> + Send {
        let stop_tx = self.stop_tx.clone();
        let active_streams = self.active_streams.clone();
        let all_stopped_notify = self.all_stopped_notify.clone();
        async move {
            let _ = stop_tx.send(());
            log::info!("Stop signal sent to all active camera streams");

            // Wait for all streams to stop
            while active_streams.load(Ordering::Acquire) > 0 {
                all_stopped_notify.notified().await;
            }
            log::info!("All camera streams have stopped");
        }
    }

    async fn get_available_cameras(&self) -> Vec<usbvideo::Camera> {
        ffi::get_available_cameras(self.ctx)
    }

    async fn get_camera_formats(&self, camera: &usbvideo::Camera) -> Vec<usbvideo::CameraFormat> {
        ffi::get_camera_formats(self.ctx, camera)
    }

    async fn run_capture<K: StationEngine + Send + Sync>(
        &self,
        tracker: Arc<StateTracker<K>>,
        camera: &usbvideo::Camera,
        format: &usbvideo::CameraFormat,
        queue_id: &normfs::QueueId,
    ) -> CaptureResult {
        self.active_streams.fetch_add(1, Ordering::Acquire);
        
        let mut stop_rx = self.stop_tx.subscribe();
        let active_streams = self.active_streams.clone();
        let all_stopped_notify = self.all_stopped_notify.clone();
        
        let camera_clone = camera.clone();
        let format_clone = format.clone();
        let tracker_clone = tracker.clone();
        let queue_id_clone = queue_id.clone();
        
        let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop_flag_clone = stop_flag.clone();
        
        let stop_monitor = tokio::spawn(async move {
            let _ = stop_rx.recv().await;
            stop_flag_clone.store(true, Ordering::Release);
        });
        
        let result = tokio::task::spawn_blocking(move || {
            log::info!("Starting capture for camera {} with format {}x{}@{:.1}fps",
                      camera_clone.unique_id, format_clone.width, format_clone.height, format_clone.frames_per_second);

            let ctx = match ffi::new_uvc_context() {
                Ok(ctx) => ctx,
                Err(e) => {
                    log::error!("Failed to create UVC context for camera {}: {}", camera_clone.unique_id, e);
                    return CaptureResult {
                        has_frames: false,
                        error_message: Some(format!("Failed to create UVC context: {}", e)),
                    };
                }
            };

            let mut stream_handle = match ffi::get_stream_handle(ctx, &camera_clone, &format_clone) {
                Ok(handle) => handle,
                Err(e) => {
                    log::error!("Failed to get stream handle for camera {}: {}", camera_clone.unique_id, e);
                    ffi::drop_uvc_context(ctx);
                    return CaptureResult {
                        has_frames: false,
                        error_message: Some(format!("Failed to get stream handle: {}", e)),
                    };
                }
            };

            if let Err(e) = ffi::start_streaming(&mut stream_handle) {
                log::error!("Failed to start streaming for camera {}: {}", camera_clone.unique_id, e);
                drop(stream_handle);
                ffi::drop_uvc_context(ctx);
                return CaptureResult {
                    has_frames: false,
                    error_message: Some(format!("Failed to start streaming: {}", e)),
                };
            }

            log::info!("Successfully started streaming for camera {}", camera_clone.unique_id);

            let mut has_frames = false;
            let mut last_frame_time = Instant::now();
            let mut frame_count = 0u64;
            let mut error_message = None;

            loop {
                if stop_flag.load(Ordering::Acquire) {
                    log::info!("Stop signal received for camera {}", camera_clone.unique_id);
                    break;
                }

                let no_frame_timeout = if has_frames {
                    Duration::from_secs(300)
                } else {
                    Duration::from_secs(5)
                };

                if last_frame_time.elapsed() > no_frame_timeout {
                    if has_frames {
                        log::error!("No frames received from camera {} for 5 minutes, stopping capture", camera_clone.unique_id);
                        error_message = Some("No frames received for 5 minutes".to_string());
                    } else {
                        log::warn!("No frames received from camera {} within 5 seconds, stopping capture so another format can be tried", camera_clone.unique_id);
                        error_message = Some("No frames received within 5 seconds".to_string());
                    }
                    break;
                }

                match ffi::get_last_frame(&stream_handle, 200_000) {
                    Ok(frame_info) => {
                        last_frame_time = Instant::now();
                        has_frames = true;
                        frame_count += 1;
                        
                        // Check if we have a valid fourcc (0 means unsupported format)
                        if frame_info.fourcc == 0 {
                            log::error!("Unsupported UVC frame format {} for camera {}, stopping capture",
                                       frame_info.format, camera_clone.unique_id);
                            break;
                        }
                        
                        if let Some(format) = FourCCFormat::from_fourcc_u32(frame_info.fourcc) {
                            let frame_stamp = FrameStamp {
                                monotonic_stamp_ns: frame_info.boottime_timestamp_ns,
                                local_stamp_ns: frame_info.unix_timestamp_ns,
                                app_start_id: systime::get_app_start_id(),
                                index: frame_info.sequence as u64,
                            };

                            tracker_clone.enqueue_frame(
                                &queue_id_clone,
                                format,
                                &camera_clone,
                                frame_stamp,
                                frame_info.width,
                                frame_info.height,
                                frame_info.data,
                            );

                            log::debug!("Frame #{} (seq: {}) processed for camera {} - Size: {}x{}, Format: {:?}",
                                      frame_count, frame_info.sequence, camera_clone.unique_id, frame_info.width, frame_info.height, format);
                        } else {
                            log::error!("Unsupported FourCC format 0x{:08X} for camera {}, stopping capture",
                                       frame_info.fourcc, camera_clone.unique_id);
                            break;
                        }
                    }
                    Err(e) => {
                        if e != norm_uvc_sys::uvc_error_UVC_ERROR_TIMEOUT {
                            log::warn!("Failed to get frame for camera {}: {}", camera_clone.unique_id, e);
                            break;
                        }
                    }
                }
            }

            ffi::stop_streaming(&mut stream_handle);
            drop(stream_handle);
            ffi::drop_uvc_context(ctx);
            
            log::info!("Stopped streaming for camera {} after {} frames", camera_clone.unique_id, frame_count);

            CaptureResult {
                has_frames,
                error_message,
            }
        }).await;

        stop_monitor.abort();

        let remaining = active_streams.fetch_sub(1, Ordering::Release);
        if remaining == 1 {
            all_stopped_notify.notify_waiters();
        }

        match result {
            Ok(capture_result) => capture_result,
            Err(e) => {
                log::error!("Capture task panicked: {}", e);
                CaptureResult {
                    has_frames: false,
                    error_message: Some(format!("Capture task failed: {}", e)),
                }
            }
        }
    }
}

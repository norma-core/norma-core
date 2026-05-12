use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use normfs::NormFS;
use station_iface::StationEngine;
use tokio::task::JoinHandle;

use crate::buffer::PixelFormat;
use crate::camera::Ov5647Camera;
use crate::config::{CaptureConfig, Quality};
use crate::error::Ov5647Error;
use crate::frame2tensor;
use crate::state::StateTracker;
use usbvideo::usbvideo_proto::{
    frame::FrameStamp,
    usbvideo::{Camera, CameraFormat},
};

pub struct Ov5647Handle {
    stopped: Arc<AtomicBool>,
    task_handle: JoinHandle<()>,
}

impl Ov5647Handle {
    pub async fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

impl Drop for Ov5647Handle {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        self.task_handle.abort();
    }
}

pub(crate) struct Ov5647Manager<K: StationEngine + Send + Sync + 'static>(
    std::marker::PhantomData<K>,
);

impl<K: StationEngine + Send + Sync + 'static> Ov5647Manager<K> {
    pub async fn new(
        normfs: Arc<NormFS>,
        engine: Arc<K>,
        width: u32,
        height: u32,
        fps: u32,
        queue_id: String,
    ) -> Result<Ov5647Handle, Ov5647Error> {
        let tracker = Arc::new(StateTracker::new(engine.clone(), normfs.clone(), queue_id));
        tracker.start_queue().await;

        let stopped = Arc::new(AtomicBool::new(false));
        let worker_stopped = stopped.clone();
        let tracker_task = tracker.clone();

        let task_handle = tokio::task::spawn_blocking(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    log::error!("Failed to create runtime for OV5647 worker: {}", e);
                    return;
                }
            };

            rt.block_on(async move {
                watch_camera(tracker_task, width, height, fps, worker_stopped).await;
            });
        });

        let task_handle = tokio::spawn(async move {
            let _ = task_handle.await;
        });

        Ok(Ov5647Handle {
            stopped,
            task_handle,
        })
    }
}

async fn watch_camera<K: StationEngine + Send + Sync + 'static>(
    tracker: Arc<StateTracker<K>>,
    width: u32,
    height: u32,
    fps: u32,
    stopped: Arc<AtomicBool>,
) {
    let poll_interval = Duration::from_secs(1);

    loop {
        if stopped.load(Ordering::Acquire) {
            log::info!("OV5647 driver stopping");
            break;
        }

        match Ov5647Camera::open().await {
            Ok(camera) => {
                let camera_id = camera.id().await;
                log::info!("OV5647 camera connected (id={})", camera_id);

                let camera_info = Camera {
                    manufacturer: "Raspberry Pi".to_string(),
                    product: "OV5647".to_string(),
                    serial_number: camera_id.clone(),
                    unique_id: format!("ov5647:{}", camera_id),
                    ..Default::default()
                };

                let session_camera_info = run_capture_session(
                    &camera,
                    &tracker,
                    &camera_info,
                    width,
                    height,
                    fps,
                    &stopped,
                )
                .await;

                tracker.enqueue_device_disconnected(&session_camera_info);

                log::info!("OV5647 camera disconnected (id={})", camera_id);
            }
            Err(e) => {
                log::debug!("OV5647 not available: {}", e);
            }
        }

        tokio::time::sleep(poll_interval).await;
    }
}

async fn run_capture_session<K: StationEngine + Send + Sync + 'static>(
    camera: &Ov5647Camera,
    tracker: &Arc<StateTracker<K>>,
    camera_info: &Camera,
    width: u32,
    height: u32,
    fps: u32,
    stopped: &Arc<AtomicBool>,
) -> Camera {
    let config = CaptureConfig {
        width,
        height,
        quality: Quality::HIGH,
        raw_output_path: None,
    };

    let mut session = match camera.create_session(config).await {
        Ok(s) => s,
        Err(e) => {
            log::error!("OV5647 failed to create capture session: {}", e);
            tracker.enqueue_error(
                camera_info,
                format!("Failed to create capture session: {}", e),
            );
            return camera_info.clone();
        }
    };

    let actual_width = session.width();
    let actual_height = session.height();
    let actual_format = session.pixel_format();
    let actual_fourcc = pixel_format_to_fourcc(actual_format);
    let actual_camera_info = camera_info.clone();

    let active_format = CameraFormat {
        fourcc: fourcc_to_u32(actual_fourcc),
        index: 0,
        width: actual_width,
        height: actual_height,
        frames_per_second: fps as f32,
        ..Default::default()
    };

    let available_formats = session.available_formats();
    let mut supported_formats: Vec<CameraFormat> = available_formats
        .iter()
        .enumerate()
        .map(|(index, fmt)| CameraFormat {
            fourcc: fourcc_to_u32(&fmt.fourcc),
            index: index as u32,
            width: fmt.width,
            height: fmt.height,
            frames_per_second: fmt.estimated_fps as f32,
            ..Default::default()
        })
        .collect();

    if supported_formats.is_empty() {
        supported_formats.push(active_format.clone());
    } else if let Some(pos) = available_formats.iter().position(|fmt| {
        fmt.width == actual_width
            && fmt.height == actual_height
            && fmt.pixel_format == actual_format
    }) {
        let active = supported_formats.remove(pos);
        supported_formats.insert(0, active);
    } else {
        supported_formats.insert(0, active_format.clone());
    }

    log::info!(
        "OV5647 capture session started (id={}, width={}, height={}, fps={}, format={})",
        actual_camera_info.unique_id,
        actual_width,
        actual_height,
        fps,
        actual_fourcc
    );

    tracker.enqueue_device_connected(&actual_camera_info, supported_formats);
    tracker.enqueue_recording_start(&actual_camera_info, &active_format);

    let frame_interval = Duration::from_secs_f64(1.0 / fps as f64);
    let capture_timeout = Duration::from_secs(5);
    let mut end_reason = "stopped";
    let mut frame_index: u64 = 0;

    loop {
        let frame_start = Instant::now();

        if stopped.load(Ordering::Acquire) {
            break;
        }

        match session.capture_with_timeout(capture_timeout).await {
            Ok(image) => {
                log::trace!(
                    "OV5647 captured frame (sequence={}, timestamp_ns={}, bytes={})",
                    image.sequence,
                    image.timestamp_ns,
                    image.data.len()
                );

                let frame_data = crate::buffer::FrameData {
                    buffer: image.data.clone(),
                    format: image.format,
                    width: image.width,
                    height: image.height,
                    stride: image.stride,
                    timestamp_ns: image.timestamp_ns,
                    sequence: image.sequence,
                };

                match frame2tensor::convert_frame(&frame_data, Quality::HIGH) {
                    Ok(converted) => {
                        let stamp = FrameStamp {
                            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                            local_stamp_ns: systime::get_local_stamp_ns(),
                            app_start_id: systime::get_app_start_id(),
                            index: frame_index,
                        };

                        tracker.enqueue_frame(
                            &actual_camera_info,
                            stamp,
                            image.width,
                            image.height,
                            converted.jpeg,
                        );

                        frame_index += 1;
                    }
                    Err(e) => {
                        log::warn!("OV5647 frame conversion failed: {}", e);
                    }
                }
            }
            Err(Ov5647Error::CaptureTimeout(_)) => {
                log::warn!("OV5647 capture timeout");
                continue;
            }
            Err(e) => {
                log::error!("OV5647 capture error: {}", e);
                tracker.enqueue_error(&actual_camera_info, format!("Capture error: {}", e));
                end_reason = "capture_error";
                break;
            }
        }

        let elapsed = frame_start.elapsed();
        if elapsed < frame_interval {
            tokio::time::sleep(frame_interval - elapsed).await;
        }
    }

    if let Err(e) = session.stop().await {
        log::warn!("OV5647 error stopping session: {}", e);
        end_reason = "stop_error";
    }

    tracker.enqueue_recording_end(&actual_camera_info);

    log::info!(
        "OV5647 capture session ended (id={}, reason={}, frames={})",
        actual_camera_info.unique_id,
        end_reason,
        frame_index
    );

    actual_camera_info
}

fn fourcc_to_u32(value: &str) -> u32 {
    let bytes = value.as_bytes();
    if bytes.len() != 4 {
        return 0;
    }

    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn pixel_format_to_fourcc(format: PixelFormat) -> &'static str {
    match format {
        PixelFormat::Rgb888 => "RGB3",
        PixelFormat::Bgr888 => "BGR3",
        PixelFormat::Yuyv => "YUYV",
        PixelFormat::Yvyu => "YVYU",
        PixelFormat::Uyvy => "UYVY",
        PixelFormat::Nv12 => "NV12",
        PixelFormat::Nv21 => "NV21",
        PixelFormat::Yuv420 => "I420",
        PixelFormat::Mjpeg => "MJPG",
        PixelFormat::Unknown => "UNKNOWN",
    }
}

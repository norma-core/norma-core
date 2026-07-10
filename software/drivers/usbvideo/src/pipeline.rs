use std::{collections::HashSet, path::PathBuf, sync::{Arc, atomic::{AtomicBool, Ordering}}};

use log::{error, info, warn};
use tokio::sync::RwLock;
use station_iface::StationEngine;
use normfs::NormFS;

use crate::{converters, state::StateTracker, usbvideo_proto::{frame::FrameStamp, usbvideo::{self, RxEnvelope, RxEnvelopeType}}};

pub struct CaptureResult {
    pub has_frames: bool,
    pub error_message: Option<String>,
}

pub trait USBCameraDriver : Send + Sync + 'static {
    fn get_available_cameras(&self) -> impl Future<Output = Vec<usbvideo::Camera>> + Send;
    fn get_camera_formats(&self, camera: &usbvideo::Camera) -> impl Future<Output = Vec<usbvideo::CameraFormat>> + Send;

    fn run_capture<K: StationEngine + Send + Sync>(
        &self,
        tracker: Arc<StateTracker<K>>,
        camera: &usbvideo::Camera,
        format: &usbvideo::CameraFormat,
        queue_id: &normfs::QueueId,
    ) -> impl Future<Output = CaptureResult> + Send;

    fn stop(&self) -> impl Future<Output = ()> + Send;
}

pub struct USBVideoManager<K: USBCameraDriver> {
    driver: Arc<K>,
    stopped: Arc<AtomicBool>,
}

impl<K: USBCameraDriver> USBVideoManager<K> {
    pub async fn new<T: StationEngine + Send + Sync>(
        driver: K,
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        base_path: PathBuf,
        config: crate::USBVideoConfig,
    ) -> Self {
        let state_tracker = Arc::new(
            StateTracker::new(normfs.clone(), station_engine.clone(), config),
        );

        let state4run = state_tracker.clone();
        let driver_arc = Arc::new(driver);
        let intance_arc = driver_arc.clone();
        let stopped = Arc::new(AtomicBool::new(false));
        let worker_stopped = stopped.clone();

        if let Err(e) = Self::start_readonly_video_queues(&normfs, &base_path).await {
            error!("Failed to start readonly video queues: {}", e);
        }

        tokio::spawn(async move {
            Self::watch_cameras(
                worker_stopped,
                driver_arc,
                state4run,
            ).await;
        });

        Self {
            driver: intance_arc,
            stopped,
        }
    }

    async fn start_readonly_video_queues(normfs: &Arc<NormFS>, base_path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
        let video_queues = Self::find_video_queues(base_path).await?;

        if video_queues.is_empty() {
            info!("No video queues found in normfs");
            return Ok(());
        }

        info!("Found {} video queue(s) to start in readonly mode", video_queues.len());

        for queue_id_str in video_queues {
            let queue_id = normfs.resolve(&queue_id_str);
            info!("Starting readonly queue: {}", queue_id);
            match normfs.ensure_queue_exists_for_read(&queue_id).await {
                Ok(_) => info!("Started readonly queue: {}", queue_id),
                Err(e) => error!("Failed to start readonly queue {}: {}", queue_id, e),
            }
        }

        Ok(())
    }

    async fn find_video_queues(base_path: &PathBuf) -> Result<Vec<String>, Box<dyn std::error::Error>> {
        let video_dir = base_path.join("usbvideo");
        
        if !video_dir.exists() {
            return Ok(Vec::new());
        }

        let mut queues = Vec::new();
        let mut entries = tokio::fs::read_dir(video_dir).await?;
        
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            
            if path.is_dir() {
                let wal_path = path.join("wal");
                if wal_path.exists()
                    && let Ok(relative_path) = path.strip_prefix(base_path)
                    && let Some(queue_id) = relative_path.to_str()
                {
                    queues.push(queue_id.to_string());
                }
            }
        }
        
        Ok(queues)
    }

    fn generate_queue_id(unique_id: &str) -> String {
        let hash = format!("{:x}", md5::compute(unique_id.as_bytes()));
        format!("usbvideo/{}", hash)
    }

    fn send_device_connected<T: StationEngine>(
        queue_id: &normfs::QueueId,
        tracker: &Arc<StateTracker<T>>,
        camera: &usbvideo::Camera,
        formats: &[usbvideo::CameraFormat],
    ) {
        let _ = tracker.send_envelope(queue_id, RxEnvelope{
            r#type: RxEnvelopeType::EtDeviceConnected as i32,
            camera: Some(camera.clone()),
            formats: formats.to_vec(),
            error: "".to_string(),
            frames: None,
            last_inference_queue_ptr: tracker.get_last_inference_id_bytes(),
            stamp: Some(FrameStamp{
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
        });
    }

    fn send_device_disconnected<T: StationEngine>(
        queue_id: &normfs::QueueId,
        tracker: &Arc<StateTracker<T>>,
        camera: &usbvideo::Camera,
    ) {
        let _ = tracker.send_envelope(queue_id, RxEnvelope{
            r#type: RxEnvelopeType::EtDeviceDisconnected as i32,
            camera: Some(camera.clone()),
            formats: vec![],
            error: "".to_string(),
            frames: None,
            last_inference_queue_ptr: tracker.get_last_inference_id_bytes(),
            stamp: Some(FrameStamp{
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
        });
    }

    fn send_session_started<T: StationEngine>(
        queue_id: &normfs::QueueId,
        tracker: &Arc<StateTracker<T>>,
        camera: &usbvideo::Camera,
        format: &usbvideo::CameraFormat,
    ) {
        let _ = tracker.send_envelope(queue_id, RxEnvelope{
            r#type: RxEnvelopeType::EtDeviceRecordingStart as i32,
            camera: Some(camera.clone()),
            formats: vec![format.clone()],
            error: "".to_string(),
            frames: None,
            last_inference_queue_ptr: tracker.get_last_inference_id_bytes(),
            stamp: Some(FrameStamp{
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
        });
    }

    fn send_session_ended<T: StationEngine>(
        queue_id: &normfs::QueueId,
        tracker: &Arc<StateTracker<T>>,
        camera: &usbvideo::Camera,
        format: &usbvideo::CameraFormat,
        error: String,
    ) {
        let _ = tracker.send_envelope(queue_id, RxEnvelope{
            r#type: RxEnvelopeType::EtDeviceRecordingEnd as i32,
            camera: Some(camera.clone()),
            formats: vec![format.clone()],
            error,
            frames: None,
            last_inference_queue_ptr: tracker.get_last_inference_id_bytes(),
            stamp: Some(FrameStamp{
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
        });
    }

    async fn watch_cameras<T: StationEngine + Send + Sync>(
        stopped: Arc<AtomicBool>,
        driver: Arc<K>,
        tracker: Arc<StateTracker<T>>,
    ) {
        let known_cameras = Arc::new(RwLock::new(HashSet::<String>::new()));

        loop {
            // Check if stopped before continuing
            if stopped.load(Ordering::Acquire) {
                info!("Camera watching stopped");
                break;
            }

            let cameras = driver.get_available_cameras().await;
            for camera in cameras {
                if known_cameras.read().await.contains(&camera.unique_id) {
                    continue;
                }

                // Check if stopped before starting new camera
                if stopped.load(Ordering::Acquire) {
                    break;
                }

                info!("Discovered new camera: {}", camera.unique_id);
                known_cameras.write().await.insert(camera.unique_id.clone());

                let cam_driver = driver.clone();
                let cam_tracker = tracker.clone();
                let cam_known = known_cameras.clone();
                let cam_stopped = stopped.clone();

                tokio::spawn(async move {
                    let queue_id_str = USBVideoManager::<K>::generate_queue_id(&camera.unique_id);
                    let queue_id = cam_tracker.resolve_queue_id(&queue_id_str);
                    let mut queue_started = false;

                    loop {
                        // Check if stopped before processing camera
                        if cam_stopped.load(Ordering::Acquire) {
                            info!("Camera {} processing stopped", camera.unique_id);
                            break;
                        }

                        let src_formats = cam_driver.get_camera_formats(&camera).await;

                        for fmt in &src_formats {
                            info!(
                                "Camera {} format: {} ({}x{}, {:.2} FPS)",
                                camera.unique_id,
                                converters::fourcc_to_string(&converters::fourcc_from_u32(fmt.fourcc)),
                                fmt.width,
                                fmt.height,
                                fmt.frames_per_second,
                            );
                        }

                        let selection = converters::filter_and_sort_cameras_formats(
                            &src_formats,
                            cam_tracker.resolution(),
                        );

                        if selection.resolution_fallback
                            && let Some(requested) = cam_tracker.resolution()
                        {
                            warn!(
                                "Camera {}: requested resolution {}x{} is not available, falling back to automatic format selection",
                                camera.unique_id, requested.width, requested.height,
                            );
                        }

                        let formats = selection.formats;

                        if formats.is_empty() {
                            warn!("Camera {} has no available formats", camera.unique_id);
                            if !src_formats.is_empty() {
                                warn!("Available formats for camera {} were filtered out as unsupported, camera will be ignored", camera.unique_id);
                                return;
                            }
                            break;
                        }

                        cam_tracker.handle_queue_start(&queue_id).await;
                        queue_started = true;

                        Self::send_device_connected(
                            &queue_id,
                            &cam_tracker,
                            &camera,
                            &src_formats,
                        );

                        for format in formats.iter() {
                            // Check if stopped before starting capture
                            if cam_stopped.load(Ordering::Acquire) {
                                info!("Camera {} capture stopped before starting format", camera.unique_id);
                                break;
                            }

                            info!(
                                "Trying to capture from camera {} with format: {} ({}x{}, {:.2} FPS)",
                                camera.unique_id,
                                converters::fourcc_to_string(&converters::fourcc_from_u32(format.fourcc)),
                                format.width,
                                format.height,
                                format.frames_per_second,
                            );

                            Self::send_session_started(&queue_id, &cam_tracker, &camera, format);

                            let result = cam_driver.run_capture(
                                cam_tracker.clone(),
                                &camera,
                                format,
                                &queue_id,
                            ).await;

                            if let Some(error_message) = result.error_message {
                                error!(
                                    "Error capturing from camera {} with format {}: {}",
                                    camera.unique_id,
                                    converters::fourcc_to_string(&converters::fourcc_from_u32(format.fourcc)),
                                    error_message,
                                );

                                Self::send_session_ended(&queue_id, &cam_tracker, &camera, format, error_message);
                            }else {
                                Self::send_session_ended(&queue_id, &cam_tracker, &camera, format, "".to_string());
                            }

                            if result.has_frames {
                                break;
                            }
                        }

                        break;
                    }

                    info!("Capture session for {} ended.", camera.unique_id);

                    if queue_started {
                        Self::send_device_disconnected(&queue_id, &cam_tracker, &camera);
                    }
                    cam_known.write().await.remove(&camera.unique_id);
                });
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await; // Poll every 1 second
        }
    }

    pub async fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.driver.stop().await;
    }
}
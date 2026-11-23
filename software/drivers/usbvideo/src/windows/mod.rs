mod ffi;

use bytes::Bytes;
use station_iface::StationEngine;
use std::ffi::{CStr, CString};
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};
use tokio::sync::{Notify, broadcast};

use crate::{
    converters::FourCCFormat,
    pipeline::{CaptureResult, USBCameraDriver},
    state::StateTracker,
    usbvideo_proto::{frame::FrameStamp, usbvideo},
};

const DEVICES_MAX: usize = 32;
const FORMATS_MAX: usize = 512;

/// COM and Media Foundation for the calling thread, undone on drop.
struct MfThread;

impl MfThread {
    fn new() -> Result<Self, i32> {
        // SAFETY: paired with nc_mf_thread_done in drop, on the same thread.
        match unsafe { ffi::nc_mf_thread_init() } {
            0 => Ok(MfThread),
            hr => Err(hr),
        }
    }
}

impl Drop for MfThread {
    fn drop(&mut self) {
        // SAFETY: nc_mf_thread_init succeeded on this thread.
        unsafe { ffi::nc_mf_thread_done() };
    }
}

fn c_str(bytes: &[std::os::raw::c_char]) -> String {
    // SAFETY: the shim always NUL-terminates within the array.
    unsafe { CStr::from_ptr(bytes.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

/// USB vid and pid from a symbolic link such as `\\?\usb#vid_046d&pid_085b&mi_00#...`.
fn usb_ids(link: &str) -> (u32, u32) {
    let lower = link.to_ascii_lowercase();
    let hex = |key: &str| {
        lower
            .find(key)
            .and_then(|at| lower.get(at + key.len()..at + key.len() + 4))
            .and_then(|s| u32::from_str_radix(s, 16).ok())
            .unwrap_or(0)
    };
    (hex("vid_"), hex("pid_"))
}

fn list_cameras() -> Vec<usbvideo::Camera> {
    let _mf = match MfThread::new() {
        Ok(mf) => mf,
        Err(hr) => {
            log::warn!("Media Foundation is not available: 0x{:08X}", hr as u32);
            return vec![];
        }
    };
    let mut devices = vec![ffi::Device::default(); DEVICES_MAX];
    // SAFETY: devices holds DEVICES_MAX entries.
    let n = unsafe { ffi::nc_mf_list(devices.as_mut_ptr(), DEVICES_MAX as i32) };
    if n < 0 {
        log::warn!("Failed to list cameras: 0x{:08X}", n as u32);
        return vec![];
    }
    devices
        .iter()
        .take(n as usize)
        .map(|d| {
            let unique_id = c_str(&d.id);
            let (vendor_id, product_id) = usb_ids(&unique_id);
            usbvideo::Camera {
                vendor_id,
                product_id,
                product: c_str(&d.name),
                unique_id,
                ..Default::default()
            }
        })
        .collect()
}

fn list_formats(camera: &usbvideo::Camera) -> Vec<usbvideo::CameraFormat> {
    let Ok(id) = CString::new(camera.unique_id.clone()) else {
        return vec![];
    };
    let _mf = match MfThread::new() {
        Ok(mf) => mf,
        Err(_) => return vec![],
    };
    let mut formats = vec![ffi::Format::default(); FORMATS_MAX];
    // SAFETY: id is NUL-terminated and formats holds FORMATS_MAX entries.
    let n = unsafe { ffi::nc_mf_formats(id.as_ptr(), formats.as_mut_ptr(), FORMATS_MAX as i32) };
    if n < 0 {
        log::warn!(
            "Failed to get formats for camera {}: 0x{:08X}",
            camera.unique_id,
            n as u32
        );
        return vec![];
    }
    formats
        .iter()
        .take(n as usize)
        // Only what the converters take, and not YV12, which they would read as I420 with U
        // and V swapped; H264 and NV12 are offered by some cameras too.
        .filter(|f| {
            f.fourcc != u32::from_be_bytes(*b"YV12")
                && FourCCFormat::from_fourcc_u32(f.fourcc).is_some()
                && f.width > 0
        })
        .map(|f| usbvideo::CameraFormat {
            fourcc: f.fourcc,
            index: f.index,
            width: f.width,
            height: f.height,
            frames_per_second: if f.fps_den > 0 {
                f.fps_num as f32 / f.fps_den as f32
            } else {
                0.0
            },
            ..Default::default()
        })
        .collect()
}

/// An open capture; the pointer is taken out before it is closed so the
/// watchdog never interrupts a freed one.
struct Open(Mutex<Option<*mut ffi::Capture>>);

// SAFETY: Media Foundation sources are free-threaded, and the pointer is only
// used under the mutex or by the thread that owns the capture.
unsafe impl Send for Open {}
unsafe impl Sync for Open {}

impl Open {
    fn take(&self) -> Option<*mut ffi::Capture> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).take()
    }

    fn interrupt(&self) {
        if let Some(c) = *self.0.lock().unwrap_or_else(PoisonError::into_inner) {
            // SAFETY: c is open while it is in the mutex.
            let hr = unsafe { ffi::nc_mf_interrupt(c) };
            if hr < 0 {
                log::error!("Failed to stop a blocked camera read: 0x{:08X}", hr as u32);
            }
        }
    }
}

/// Stops the watchdog and closes the capture when the capture ends, unwinding
/// included; declared after the MfThread, so it drops first.
struct Teardown {
    open: Arc<Open>,
    done: Arc<AtomicBool>,
    watchdog: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Teardown {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Release);
        if let Some(watchdog) = self.watchdog.take() {
            let _ = watchdog.join();
        }
        if let Some(c) = self.open.take() {
            // SAFETY: the watchdog has exited, so nothing else uses c.
            unsafe { ffi::nc_mf_close(c) };
        }
    }
}

pub struct CameraWindowsDriver {
    stop_tx: broadcast::Sender<()>,
    active_streams: Arc<AtomicUsize>,
    all_stopped_notify: Arc<Notify>,
}

impl Default for CameraWindowsDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl CameraWindowsDriver {
    pub fn new() -> Self {
        let (stop_tx, _) = broadcast::channel(1);
        Self {
            stop_tx,
            active_streams: Arc::new(AtomicUsize::new(0)),
            all_stopped_notify: Arc::new(Notify::new()),
        }
    }
}

impl USBCameraDriver for CameraWindowsDriver {
    fn stop(&self) -> impl Future<Output = ()> + Send {
        let stop_tx = self.stop_tx.clone();
        let active_streams = self.active_streams.clone();
        let all_stopped_notify = self.all_stopped_notify.clone();
        async move {
            let _ = stop_tx.send(());
            // Registered before the count is read, or a notify in between is lost.
            loop {
                let stopped = all_stopped_notify.notified();
                tokio::pin!(stopped);
                stopped.as_mut().enable();
                if active_streams.load(Ordering::Acquire) == 0 {
                    break;
                }
                stopped.await;
            }
            log::info!("All camera streams have stopped");
        }
    }

    async fn get_available_cameras(&self) -> Vec<usbvideo::Camera> {
        tokio::task::spawn_blocking(list_cameras)
            .await
            .unwrap_or_default()
    }

    async fn get_camera_formats(&self, camera: &usbvideo::Camera) -> Vec<usbvideo::CameraFormat> {
        let camera = camera.clone();
        tokio::task::spawn_blocking(move || list_formats(&camera))
            .await
            .unwrap_or_default()
    }

    async fn run_capture<K: StationEngine + Send + Sync>(
        &self,
        tracker: Arc<StateTracker<K>>,
        camera: &usbvideo::Camera,
        format: &usbvideo::CameraFormat,
        format_revision: u64,
        queue_id: &normfs::QueueId,
    ) -> CaptureResult {
        // Subscribed before the stream is counted, so a stop that sees it also reaches it.
        let mut stop_rx = self.stop_tx.subscribe();
        self.active_streams.fetch_add(1, Ordering::AcqRel);
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = stop.clone();
        let stop_monitor = tokio::spawn(async move {
            let _ = stop_rx.recv().await;
            stop_flag.store(true, Ordering::Release);
        });

        let camera = camera.clone();
        let format = format.clone();
        let queue_id = queue_id.clone();
        let result = tokio::task::spawn_blocking(move || {
            capture(tracker, camera, format, format_revision, queue_id, stop)
        })
        .await;

        stop_monitor.abort();
        if self.active_streams.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.all_stopped_notify.notify_waiters();
        }
        result.unwrap_or_else(|e| CaptureResult {
            has_frames: false,
            error_message: Some(format!("Capture task failed: {e}")),
        })
    }
}

fn capture<K: StationEngine + Send + Sync>(
    tracker: Arc<StateTracker<K>>,
    camera: usbvideo::Camera,
    format: usbvideo::CameraFormat,
    format_revision: u64,
    queue_id: normfs::QueueId,
    stop: Arc<AtomicBool>,
) -> CaptureResult {
    let failed = |message: String| {
        log::error!("{message}");
        CaptureResult {
            has_frames: false,
            error_message: Some(message),
        }
    };
    log::info!(
        "Starting capture for camera {} with format {}x{}@{:.1}fps",
        camera.unique_id,
        format.width,
        format.height,
        format.frames_per_second
    );
    let _mf = match MfThread::new() {
        Ok(mf) => mf,
        Err(hr) => {
            return failed(format!(
                "Media Foundation is not available: 0x{:08X}",
                hr as u32
            ));
        }
    };
    let Ok(id) = CString::new(camera.unique_id.clone()) else {
        return failed(format!("Camera id has a NUL: {}", camera.unique_id));
    };
    let mut err = 0;
    // SAFETY: id is NUL-terminated and err is live for the call.
    let c = unsafe { ffi::nc_mf_open(id.as_ptr(), format.index, &mut err) };
    if c.is_null() {
        return failed(format!(
            "Failed to open camera {}: 0x{:08X}",
            camera.unique_id, err as u32
        ));
    }
    let open = Arc::new(Open(Mutex::new(Some(c))));

    // ReadSample blocks, so stop and a camera that sends nothing are noticed here.
    let start = Instant::now();
    let last_frame_ms = Arc::new(AtomicU64::new(0));
    let has_frames = Arc::new(AtomicBool::new(false));
    let timed_out = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    let watchdog = {
        let (open, last_frame_ms, has_frames, timed_out, done, stop) = (
            open.clone(),
            last_frame_ms.clone(),
            has_frames.clone(),
            timed_out.clone(),
            done.clone(),
            stop.clone(),
        );
        std::thread::spawn(move || {
            // The interrupt is a COM call too.
            let _mf = MfThread::new();
            while !done.load(Ordering::Acquire) {
                let idle = (start.elapsed().as_millis() as u64)
                    .saturating_sub(last_frame_ms.load(Ordering::Acquire));
                let limit = if has_frames.load(Ordering::Acquire) {
                    300_000
                } else {
                    5_000
                };
                let late = idle > limit;
                if stop.load(Ordering::Acquire) || late {
                    timed_out.store(late, Ordering::Release);
                    open.interrupt();
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        })
    };
    let _teardown = Teardown {
        open,
        done,
        watchdog: Some(watchdog),
    };

    let mut frame_index = 0u64;
    let mut error_message = None;
    loop {
        let mut frame = ffi::Frame::default();
        // SAFETY: c stays open until _teardown drops.
        let rc = unsafe { ffi::nc_mf_read(c, &mut frame) };
        if stop.load(Ordering::Acquire) {
            log::info!("Stop signal received for camera {}", camera.unique_id);
            break;
        }
        if rc == 1 {
            continue;
        }
        if rc != 0 {
            error_message = Some(if !timed_out.load(Ordering::Acquire) {
                format!("Camera read failed: 0x{:08X}", rc as u32)
            } else if frame_index > 0 {
                "No frames received for 5 minutes".to_string()
            } else {
                "No frames received within 5 seconds".to_string()
            });
            log::warn!(
                "Capture for camera {} ended: {}",
                camera.unique_id,
                error_message.as_deref().unwrap_or_default()
            );
            break;
        }
        last_frame_ms.store(start.elapsed().as_millis() as u64, Ordering::Release);
        has_frames.store(true, Ordering::Release);
        let Some(fourcc) = FourCCFormat::from_fourcc_u32(frame.fourcc) else {
            error_message = Some(format!("Unsupported FourCC 0x{:08X}", frame.fourcc));
            break;
        };
        // SAFETY: the shim holds len bytes at data until the next read.
        let data = unsafe { std::slice::from_raw_parts(frame.data, frame.len as usize) };
        tracker.enqueue_frame(
            &queue_id,
            fourcc,
            &camera,
            FrameStamp {
                monotonic_stamp_ns: normfs_time::monotonic_stamp_ns(),
                local_stamp_ns: normfs_time::local_stamp_ns(),
                app_start_id: normfs_time::app_start_id(),
                index: frame_index,
            },
            format_revision,
            frame.width,
            frame.height,
            Bytes::copy_from_slice(data),
        );
        frame_index += 1;
    }

    log::info!(
        "Stopped streaming for camera {} after {} frames",
        camera.unique_id,
        frame_index
    );
    CaptureResult {
        has_frames: frame_index > 0,
        error_message,
    }
}

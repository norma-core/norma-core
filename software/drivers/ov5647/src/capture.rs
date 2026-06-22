use crate::buffer::{FrameData, MappedBuffer, PixelFormat, PlaneInfo};
use crate::camera::CameraInnerRef as CameraInner;
use crate::config::CaptureConfig;
use crate::error::{Ov5647Error, Result};
use crate::format as format_utils;
use crate::frame2tensor::JpegEncoder;

use libcamera_sys_static as ffi;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::sync::mpsc;

const DEFAULT_TIMEOUT_MS: u64 = 5000;

const BUFFER_COUNT: usize = 4;

fn estimate_frame_size(width: u32, height: u32, stride: u32, format: PixelFormat) -> usize {
    let w = width as usize;
    let h = height as usize;
    let s = stride as usize;

    match format {
        PixelFormat::Yuv420 | PixelFormat::Nv12 | PixelFormat::Nv21 => {
            let y_size = s * h;
            let uv_size = (s / 2) * (h / 2);
            y_size + uv_size * 2
        }
        PixelFormat::Yuyv | PixelFormat::Yvyu | PixelFormat::Uyvy => s * h,
        PixelFormat::Rgb888 | PixelFormat::Bgr888 => w * h * 3,
        PixelFormat::Mjpeg => w * h * 3 / 10,
        PixelFormat::Unknown => w * h * 3,
    }
}

#[derive(Debug)]
pub struct CapturedImage {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub stride: u32,
    pub timestamp_ns: u64,
    pub sequence: u64,
}

pub struct CaptureSession {
    config: CaptureConfig,
    inner: Arc<SessionInner>,
    request_rx: mpsc::Receiver<CompletedRequest>,
    frame_buffer: Vec<u8>,
}

struct SessionInner {
    camera_inner: Arc<Mutex<CameraInner>>,
    config_ptr: NonNull<ffi::lc_camera_configuration_t>,
    stream: NonNull<ffi::lc_stream_t>,
    allocator: NonNull<ffi::lc_framebuffer_allocator_t>,
    available_formats: Vec<format_utils::CameraFormat>,
    requests: Mutex<Vec<NonNull<ffi::lc_request_t>>>,
    running: AtomicBool,
    width: u32,
    height: u32,
    stride: u32,
    pixel_format: PixelFormat,
    request_tx: mpsc::Sender<CompletedRequest>,
    callback_user_data: Mutex<Option<Arc<CallbackData>>>,
}

unsafe impl Send for SessionInner {}
unsafe impl Sync for SessionInner {}

struct CompletedRequest {
    request_ptr: *mut ffi::lc_request_t,
    timestamp_ns: u64,
    sequence: u64,
}

struct CallbackData {
    sender: mpsc::Sender<CompletedRequest>,
    inner: Weak<SessionInner>,
}

unsafe impl Send for CompletedRequest {}

impl CaptureSession {
    pub(crate) async fn new(
        camera_inner: Arc<Mutex<CameraInner>>,
        config: CaptureConfig,
    ) -> Result<Self> {
        let (request_tx, request_rx) = mpsc::channel(BUFFER_COUNT * 2);

        let inner = tokio::task::spawn_blocking({
            let camera_inner = camera_inner.clone();
            let config = config.clone();
            move || Self::setup_sync(camera_inner, config, request_tx)
        })
        .await
        .map_err(|_| Ov5647Error::ConfigurationFailed("task join failed".into()))??;

        let frame_buffer_size =
            estimate_frame_size(inner.width, inner.height, inner.stride, inner.pixel_format);
        let frame_buffer = Vec::with_capacity(frame_buffer_size);

        log::debug!(
            "OV5647 pre-allocated frame buffer: {} bytes",
            frame_buffer_size
        );

        Ok(Self {
            config,
            inner: Arc::new(inner),
            request_rx,
            frame_buffer,
        })
    }

    pub async fn capture(&mut self) -> Result<CapturedImage> {
        self.capture_with_timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
            .await
    }

    pub async fn capture_with_timeout(&mut self, timeout: Duration) -> Result<CapturedImage> {
        self.ensure_started().await?;

        let frame = loop {
            let completed = tokio::time::timeout(timeout, self.request_rx.recv())
                .await
                .map_err(|_| Ov5647Error::CaptureTimeout(timeout.as_millis() as u64))?
                .ok_or(Ov5647Error::SessionClosed)?;

            match self.map_frame(&completed) {
                Ok(frame) => {
                    self.requeue_request(completed.request_ptr).await?;
                    break frame;
                }
                Err(Ov5647Error::FrameInvalid(_)) => {
                    self.requeue_request(completed.request_ptr).await?;
                    continue;
                }
                Err(err) => {
                    self.requeue_request(completed.request_ptr).await?;
                    return Err(err);
                }
            }
        };

        let encoder = JpegEncoder::new(self.config.quality);
        let jpeg_data = encoder.encode(&frame)?;
        let reclaim_buffer = Some(frame.buffer);

        if let Some(buffer) = reclaim_buffer {
            self.reclaim_frame_buffer(buffer);
        }

        Ok(CapturedImage {
            data: jpeg_data,
            width: frame.width,
            height: frame.height,
            format: PixelFormat::Mjpeg,
            stride: frame.stride,
            timestamp_ns: frame.timestamp_ns,
            sequence: frame.sequence,
        })
    }

    #[inline]
    fn reclaim_frame_buffer(&mut self, mut buffer: Vec<u8>) {
        if buffer.capacity() >= self.frame_buffer.capacity() {
            buffer.clear();
            self.frame_buffer = buffer;
        }
    }

    pub async fn capture_burst(&mut self, count: usize) -> Result<Vec<CapturedImage>> {
        let mut images = Vec::with_capacity(count);
        for _ in 0..count {
            images.push(self.capture().await?);
        }
        Ok(images)
    }

    pub async fn stop(&mut self) -> Result<()> {
        if self.inner.running.swap(false, Ordering::SeqCst) {
            tokio::task::spawn_blocking({
                let inner = self.inner.clone();
                move || inner.stop_sync()
            })
            .await
            .map_err(|_| Ov5647Error::StartFailed)??;
            self.drain_completed_requests().await;
            Ok(())
        } else {
            Ok(())
        }
    }

    async fn drain_completed_requests(&mut self) {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(200);
        loop {
            match self.request_rx.try_recv() {
                Ok(_) => continue,
                Err(mpsc::error::TryRecvError::Empty) => {
                    if tokio::time::Instant::now() >= deadline {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                Err(mpsc::error::TryRecvError::Disconnected) => break,
            }
        }
    }

    pub fn width(&self) -> u32 {
        self.inner.width
    }

    pub fn height(&self) -> u32 {
        self.inner.height
    }

    pub fn pixel_format(&self) -> PixelFormat {
        self.inner.pixel_format
    }

    pub fn stride(&self) -> u32 {
        self.inner.stride
    }

    pub(crate) fn available_formats(&self) -> &[format_utils::CameraFormat] {
        &self.inner.available_formats
    }

    async fn ensure_started(&self) -> Result<()> {
        if !self.inner.running.load(Ordering::SeqCst) {
            tokio::task::spawn_blocking({
                let inner = self.inner.clone();
                move || inner.start_sync()
            })
            .await
            .map_err(|_| Ov5647Error::StartFailed)??;
        }
        Ok(())
    }

    fn map_frame(&mut self, completed: &CompletedRequest) -> Result<FrameData> {
        let buffer_ptr = self.request_buffer_ptr(completed)?;

        let plane_count = self.plane_count_or_error(buffer_ptr)?;
        self.validate_frame(buffer_ptr, plane_count)?;

        let mut data = std::mem::take(&mut self.frame_buffer);
        data.clear();

        for index in 0..plane_count {
            let mut plane_info = ffi::lc_plane_info_t {
                fd: 0,
                offset: 0,
                length: 0,
            };

            let status =
                unsafe { ffi::lc_framebuffer_plane_info(buffer_ptr, index, &mut plane_info) };
            if status != ffi::lc_status_t_LC_STATUS_OK {
                self.frame_buffer = data;
                return Err(Ov5647Error::BufferMapFailed(format!(
                    "failed to get plane info for index {}",
                    index
                )));
            }

            let plane = PlaneInfo {
                fd: plane_info.fd,
                offset: plane_info.offset,
                length: plane_info.length,
            };

            let mapped = match MappedBuffer::map(&plane) {
                Ok(mapped) => mapped,
                Err(err) => {
                    self.frame_buffer = data;
                    return Err(err);
                }
            };
            data.extend_from_slice(mapped.as_slice());
        }

        Ok(FrameData {
            buffer: data,
            format: self.inner.pixel_format,
            width: self.inner.width,
            height: self.inner.height,
            stride: self.inner.stride,
            timestamp_ns: completed.timestamp_ns,
            sequence: completed.sequence,
        })
    }

    fn request_buffer_ptr(
        &self,
        completed: &CompletedRequest,
    ) -> Result<*mut ffi::lc_framebuffer_t> {
        let buffer_ptr = unsafe {
            ffi::lc_request_get_buffer(completed.request_ptr, self.inner.stream.as_ptr())
        };

        if buffer_ptr.is_null() {
            return Err(Ov5647Error::BufferMapFailed("failed to get buffer".into()));
        }
        Ok(buffer_ptr)
    }

    fn plane_count_or_error(&self, buffer_ptr: *mut ffi::lc_framebuffer_t) -> Result<usize> {
        let plane_count = unsafe { ffi::lc_framebuffer_plane_count(buffer_ptr) };
        if plane_count == 0 {
            return Err(Ov5647Error::FrameInvalid("no planes in buffer".into()));
        }
        Ok(plane_count)
    }

    fn validate_frame(
        &self,
        buffer_ptr: *mut ffi::lc_framebuffer_t,
        plane_count: usize,
    ) -> Result<()> {
        let status = unsafe { ffi::lc_framebuffer_metadata_status(buffer_ptr) };
        if status != ffi::lc_frame_status_t_LC_FRAME_STATUS_SUCCESS {
            return Err(Ov5647Error::FrameInvalid(format!(
                "frame status {}",
                status as i32
            )));
        }

        let meta_planes = unsafe { ffi::lc_framebuffer_metadata_plane_count(buffer_ptr) };
        if meta_planes == 0 {
            return Err(Ov5647Error::FrameInvalid("no metadata planes".into()));
        }

        let mut bytes_used = 0u64;
        for index in 0..meta_planes.min(plane_count) {
            let used = unsafe { ffi::lc_framebuffer_metadata_plane_bytesused(buffer_ptr, index) };
            bytes_used += used as u64;
        }

        if bytes_used == 0 {
            return Err(Ov5647Error::FrameInvalid("empty frame".into()));
        }

        Ok(())
    }

    async fn requeue_request(&self, request_ptr: *mut ffi::lc_request_t) -> Result<()> {
        if !self.inner.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        let camera_inner = self
            .inner
            .camera_inner
            .lock()
            .map_err(|_| Ov5647Error::QueueRequestFailed)?;

        unsafe {
            ffi::lc_request_reuse(request_ptr);

            let status = ffi::lc_camera_queue_request(camera_inner.camera.as_ptr(), request_ptr);

            if status != ffi::lc_status_t_LC_STATUS_OK {
                return Err(Ov5647Error::QueueRequestFailed);
            }
        }

        Ok(())
    }

    fn setup_sync(
        camera_inner: Arc<Mutex<CameraInner>>,
        config: CaptureConfig,
        request_tx: mpsc::Sender<CompletedRequest>,
    ) -> Result<SessionInner> {
        let camera_guard = camera_inner
            .lock()
            .map_err(|_| Ov5647Error::ConfigurationFailed("camera mutex poisoned".into()))?;

        let role = ffi::lc_stream_role_t_LC_STREAM_ROLE_STILL_CAPTURE;
        let config_ptr = unsafe {
            ffi::lc_camera_generate_configuration(camera_guard.camera.as_ptr(), &role, 1)
        };

        let config_ptr = NonNull::new(config_ptr).ok_or(Ov5647Error::ConfigurationFailed(
            "failed to generate config".into(),
        ))?;

        let stream_cfg_ptr = unsafe { ffi::lc_camera_configuration_at(config_ptr.as_ptr(), 0) };

        if stream_cfg_ptr.is_null() {
            unsafe { ffi::lc_camera_configuration_destroy(config_ptr.as_ptr()) };
            return Err(Ov5647Error::ConfigurationFailed("no stream config".into()));
        }

        let available_formats = format_utils::enumerate_formats(stream_cfg_ptr);
        if available_formats.is_empty() {
            unsafe { ffi::lc_camera_configuration_destroy(config_ptr.as_ptr()) };
            return Err(Ov5647Error::ConfigurationFailed(
                "no supported formats found".into(),
            ));
        }
        log::info!(
            "OV5647 supported formats ({} total):",
            available_formats.len()
        );
        for fmt in &available_formats {
            log::info!(
                "  - {}x{} @ ~{}fps [{}]",
                fmt.width,
                fmt.height,
                fmt.estimated_fps,
                fmt.fourcc
            );
        }

        let mut candidate_formats: Vec<&format_utils::CameraFormat> = available_formats
            .iter()
            .filter(|fmt| fmt.pixel_format == PixelFormat::Yuv420)
            .collect();
        if candidate_formats.is_empty() {
            log::warn!("OV5647 I420 format not available, falling back to any format");
            candidate_formats = available_formats.iter().collect();
        }

        let compare_formats = |a: &format_utils::CameraFormat, b: &format_utils::CameraFormat| {
            a.estimated_fps.cmp(&b.estimated_fps).then_with(|| {
                let a_pixels = a.width.saturating_mul(a.height);
                let b_pixels = b.width.saturating_mul(b.height);
                a_pixels.cmp(&b_pixels)
            })
        };

        let mut selected = None;
        let mut used_preferred = false;
        if config.width > 0 && config.height > 0 {
            selected = candidate_formats
                .iter()
                .filter(|fmt| fmt.width == config.width && fmt.height == config.height)
                .max_by(|a, b| compare_formats(*a, *b))
                .copied();
            if selected.is_none() {
                log::warn!(
                    "OV5647 preferred resolution {}x{} not available, falling back to auto selection",
                    config.width,
                    config.height
                );
            } else {
                used_preferred = true;
            }
        }

        let selected = match selected.or_else(|| {
            candidate_formats
                .iter()
                .min_by(|a, b| {
                    let a_pixels = a.width.saturating_mul(a.height);
                    let b_pixels = b.width.saturating_mul(b.height);
                    a_pixels
                        .cmp(&b_pixels)
                        .then_with(|| a.width.cmp(&b.width))
                        .then_with(|| a.height.cmp(&b.height))
                })
                .copied()
        }) {
            Some(format) => format,
            None => {
                unsafe { ffi::lc_camera_configuration_destroy(config_ptr.as_ptr()) };
                return Err(Ov5647Error::ConfigurationFailed(
                    "no supported formats found".into(),
                ));
            }
        };

        let selection_reason = if used_preferred {
            "preferred resolution"
        } else {
            "lowest resolution"
        };
        log::info!(
            "OV5647 selected format: {}x{} @ ~{}fps [{}] ({})",
            selected.width,
            selected.height,
            selected.estimated_fps,
            selected.fourcc,
            selection_reason
        );

        unsafe {
            ffi::lc_stream_configuration_set_size(stream_cfg_ptr, selected.width, selected.height);
            ffi::lc_stream_configuration_set_pixel_format(
                stream_cfg_ptr,
                selected.pixel_format.to_ffi() as ffi::lc_pixel_format_t,
            );
        }

        let status = unsafe { ffi::lc_camera_configuration_validate(config_ptr.as_ptr()) };
        if status != ffi::lc_status_t_LC_STATUS_OK {
            unsafe { ffi::lc_camera_configuration_destroy(config_ptr.as_ptr()) };
            return Err(Ov5647Error::InvalidConfiguration(
                "validation failed".into(),
            ));
        }

        let width = unsafe { ffi::lc_stream_configuration_width(stream_cfg_ptr) };
        let height = unsafe { ffi::lc_stream_configuration_height(stream_cfg_ptr) };
        let stride = unsafe { ffi::lc_stream_configuration_stride(stream_cfg_ptr) };
        let pixel_format = PixelFormat::from_ffi(unsafe {
            ffi::lc_stream_configuration_pixel_format(stream_cfg_ptr) as i32
        });

        log::debug!(
            "OV5647 stream configured (width={}, height={}, stride={}, format={:?})",
            width,
            height,
            stride,
            pixel_format
        );

        let status =
            unsafe { ffi::lc_camera_configure(camera_guard.camera.as_ptr(), config_ptr.as_ptr()) };

        if status != ffi::lc_status_t_LC_STATUS_OK {
            unsafe { ffi::lc_camera_configuration_destroy(config_ptr.as_ptr()) };
            return Err(Ov5647Error::ConfigurationFailed("configure failed".into()));
        }

        let stream_ptr = unsafe { ffi::lc_stream_configuration_stream(stream_cfg_ptr) };
        let stream =
            NonNull::new(stream_ptr).ok_or(Ov5647Error::ConfigurationFailed("no stream".into()))?;

        let allocator_ptr =
            unsafe { ffi::lc_framebuffer_allocator_new(camera_guard.camera.as_ptr()) };
        let allocator = NonNull::new(allocator_ptr).ok_or(Ov5647Error::BufferAllocationFailed)?;

        let status =
            unsafe { ffi::lc_framebuffer_allocator_allocate(allocator.as_ptr(), stream.as_ptr()) };

        if status != ffi::lc_status_t_LC_STATUS_OK {
            unsafe { ffi::lc_framebuffer_allocator_destroy(allocator.as_ptr()) };
            return Err(Ov5647Error::BufferAllocationFailed);
        }

        let buffer_count = unsafe {
            ffi::lc_framebuffer_allocator_buffer_count(allocator.as_ptr(), stream.as_ptr())
        };

        let mut buffers = Vec::with_capacity(buffer_count);
        for i in 0..buffer_count {
            let buffer_ptr = unsafe {
                ffi::lc_framebuffer_allocator_get_buffer(allocator.as_ptr(), stream.as_ptr(), i)
            };
            if let Some(buffer) = NonNull::new(buffer_ptr) {
                buffers.push(buffer);
            }
        }

        log::debug!("OV5647 buffers allocated (count={})", buffers.len());

        let mut requests: Vec<NonNull<ffi::lc_request_t>> = Vec::with_capacity(buffers.len());
        for (i, buffer) in buffers.iter().enumerate() {
            let request_ptr =
                unsafe { ffi::lc_camera_create_request(camera_guard.camera.as_ptr(), i as u64) };

            let request = NonNull::new(request_ptr).ok_or(Ov5647Error::BufferAllocationFailed)?;

            let status = unsafe {
                ffi::lc_request_add_buffer(request.as_ptr(), stream.as_ptr(), buffer.as_ptr())
            };

            if status != ffi::lc_status_t_LC_STATUS_OK {
                for req in &requests {
                    unsafe { ffi::lc_request_destroy(req.as_ptr()) };
                }
                unsafe {
                    ffi::lc_framebuffer_allocator_free(allocator.as_ptr(), stream.as_ptr());
                    ffi::lc_framebuffer_allocator_destroy(allocator.as_ptr());
                }
                return Err(Ov5647Error::BufferAllocationFailed);
            }

            requests.push(request);
        }

        drop(camera_guard);

        Ok(SessionInner {
            camera_inner,
            config_ptr,
            stream,
            allocator,
            available_formats,
            requests: Mutex::new(requests),
            running: AtomicBool::new(false),
            width,
            height,
            stride,
            pixel_format,
            request_tx,
            callback_user_data: Mutex::new(None),
        })
    }
}

impl SessionInner {
    fn start_sync(self: &Arc<Self>) -> Result<()> {
        let camera_guard = self
            .camera_inner
            .lock()
            .map_err(|_| Ov5647Error::StartFailed)?;

        let callback_data = Arc::new(CallbackData {
            sender: self.request_tx.clone(),
            inner: Arc::downgrade(self),
        });

        let cb_ptr = Arc::as_ptr(&callback_data);

        match self.callback_user_data.lock() {
            Ok(mut guard) => {
                *guard = Some(callback_data);
            }
            Err(_) => return Err(Ov5647Error::StartFailed),
        }

        unsafe {
            ffi::lc_camera_set_request_completed_callback(
                camera_guard.camera.as_ptr(),
                Some(request_completed_callback),
                cb_ptr.cast_mut().cast(),
            );
        }

        let status = unsafe { ffi::lc_camera_start(camera_guard.camera.as_ptr()) };
        if status != ffi::lc_status_t_LC_STATUS_OK {
            return Err(Ov5647Error::StartFailed);
        }

        self.running.store(true, Ordering::SeqCst);

        let requests = self.requests.lock().map_err(|_| Ov5647Error::StartFailed)?;
        for request in requests.iter() {
            let status = unsafe {
                ffi::lc_camera_queue_request(camera_guard.camera.as_ptr(), request.as_ptr())
            };

            if status != ffi::lc_status_t_LC_STATUS_OK {
                log::warn!("OV5647 failed to queue initial request");
            }
        }

        Ok(())
    }

    fn stop_sync(&self) -> Result<()> {
        let camera_guard = match self.camera_inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                log::warn!("OV5647 camera mutex poisoned during stop, attempting recovery");
                poisoned.into_inner()
            }
        };

        unsafe {
            ffi::lc_camera_stop(camera_guard.camera.as_ptr());
            ffi::lc_camera_set_request_completed_callback(
                camera_guard.camera.as_ptr(),
                None,
                std::ptr::null_mut(),
            );
        }

        log::info!("OV5647 capture stopped");
        Ok(())
    }

    fn requeue_request_sync(&self, request_ptr: *mut ffi::lc_request_t) {
        if request_ptr.is_null() || !self.running.load(Ordering::SeqCst) {
            return;
        }

        let camera_guard = match self.camera_inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        unsafe {
            ffi::lc_request_reuse(request_ptr);
            let _ = ffi::lc_camera_queue_request(camera_guard.camera.as_ptr(), request_ptr);
        }
    }
}

impl Drop for SessionInner {
    fn drop(&mut self) {
        if self.running.load(Ordering::SeqCst) {
            let _ = self.stop_sync();
        }

        let camera_guard = match self.camera_inner.lock() {
            Ok(guard) => Some(guard),
            Err(poisoned) => {
                log::warn!("OV5647 camera mutex poisoned in Drop, attempting recovery");
                Some(poisoned.into_inner())
            }
        };

        if let Some(guard) = camera_guard {
            unsafe {
                ffi::lc_camera_set_request_completed_callback(
                    guard.camera.as_ptr(),
                    None,
                    std::ptr::null_mut(),
                );
            }
            drop(guard);
        }

        std::thread::sleep(std::time::Duration::from_millis(10));

        if let Ok(mut guard) = self.callback_user_data.lock() {
            let _ = guard.take();
        }

        match self.requests.lock() {
            Ok(requests) => {
                for request in requests.iter() {
                    unsafe { ffi::lc_request_destroy(request.as_ptr()) };
                }
            }
            Err(poisoned) => {
                log::warn!("OV5647 requests mutex poisoned in Drop, attempting cleanup");
                let requests = poisoned.into_inner();
                for request in requests.iter() {
                    unsafe { ffi::lc_request_destroy(request.as_ptr()) };
                }
            }
        }

        unsafe {
            ffi::lc_framebuffer_allocator_free(self.allocator.as_ptr(), self.stream.as_ptr());
            ffi::lc_framebuffer_allocator_destroy(self.allocator.as_ptr());
            ffi::lc_camera_configuration_destroy(self.config_ptr.as_ptr());
        }

        log::debug!("OV5647 session cleaned up");
    }
}

extern "C" fn request_completed_callback(
    request: *mut ffi::lc_request_t,
    user_data: *mut std::ffi::c_void,
) {
    if request.is_null() || user_data.is_null() {
        return;
    }

    let callback = unsafe { &*(user_data as *const CallbackData) };

    let timestamp_ns = unsafe { ffi::lc_request_metadata_timestamp(request) };
    let sequence = unsafe { ffi::lc_request_sequence(request) };

    let completed = CompletedRequest {
        request_ptr: request,
        timestamp_ns,
        sequence,
    };

    if callback.sender.try_send(completed).is_err() {
        if let Some(inner) = callback.inner.upgrade() {
            inner.requeue_request_sync(request);
        }
    }
}

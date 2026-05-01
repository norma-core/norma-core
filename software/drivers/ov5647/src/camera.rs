//! Camera abstraction for OV5647 sensor.

use crate::capture::CaptureSession;
use crate::config::CaptureConfig;
use crate::error::{Ov5647Error, Result};

use libcamera_sys_static as ffi;
use std::ffi::CStr;
use std::ptr::NonNull;
use std::sync::{Arc, Mutex};

/// Main camera interface for OV5647 sensor.
///
/// This struct represents an acquired camera device. Use [`Ov5647Camera::open`]
/// to find and acquire the camera, then [`Ov5647Camera::create_session`] to
/// start capturing images.
pub struct Ov5647Camera {
    inner: Arc<Mutex<CameraInner>>,
}

pub(crate) struct CameraInner {
    pub(crate) manager: NonNull<ffi::lc_camera_manager_t>,
    pub(crate) camera: NonNull<ffi::lc_camera_t>,
    pub(crate) camera_id: String,
}

// SAFETY: Camera operations are synchronized via Mutex.
// The underlying libcamera objects are thread-safe when properly synchronized.
unsafe impl Send for CameraInner {}

impl Ov5647Camera {
    /// Open the first available camera.
    ///
    /// This initializes the camera manager, finds available cameras,
    /// and acquires the first one.
    pub async fn open() -> Result<Self> {
        // Run blocking initialization in a blocking task
        tokio::task::spawn_blocking(Self::open_sync)
            .await
            .map_err(|_| Ov5647Error::ManagerInitFailed)?
    }

    /// Open a specific camera by ID.
    ///
    /// Use [`list_cameras`](Self::list_cameras) to get available camera IDs.
    pub async fn open_by_id(camera_id: &str) -> Result<Self> {
        let id = camera_id.to_string();
        tokio::task::spawn_blocking(move || Self::open_by_id_sync(&id))
            .await
            .map_err(|_| Ov5647Error::ManagerInitFailed)?
    }

    /// List all available cameras.
    ///
    /// Returns a list of camera IDs that can be passed to [`open_by_id`](Self::open_by_id).
    #[allow(dead_code)]
    pub async fn list_cameras() -> Result<Vec<String>> {
        tokio::task::spawn_blocking(Self::list_cameras_sync)
            .await
            .map_err(|_| Ov5647Error::ManagerInitFailed)?
    }

    /// Get the camera ID.
    pub async fn id(&self) -> String {
        self.inner
            .lock()
            .expect("ov5647 camera mutex poisoned")
            .camera_id
            .clone()
    }

    /// Create a capture session with the given configuration.
    ///
    /// The session can be used to capture one or more images.
    pub async fn create_session(&self, config: CaptureConfig) -> Result<CaptureSession> {
        CaptureSession::new(self.inner.clone(), config).await
    }

    // Synchronous implementation details

    fn open_sync() -> Result<Self> {
        let manager = Self::create_manager()?;

        let count = unsafe { ffi::lc_camera_manager_camera_count(manager.as_ptr()) };
        if count == 0 {
            unsafe {
                ffi::lc_camera_manager_stop(manager.as_ptr());
                ffi::lc_camera_manager_destroy(manager.as_ptr());
            }
            return Err(Ov5647Error::NoCamerasFound);
        }

        // Get first camera
        let camera_ptr = unsafe { ffi::lc_camera_manager_get_camera(manager.as_ptr(), 0) };
        let camera = NonNull::new(camera_ptr)
            .ok_or(Ov5647Error::NoCamerasFound)?;

        // Get camera ID
        let camera_id = unsafe {
            let id_ptr = ffi::lc_camera_id(camera.as_ptr());
            if id_ptr.is_null() {
                "unknown".to_string()
            } else {
                CStr::from_ptr(id_ptr).to_string_lossy().into_owned()
            }
        };

        // Acquire camera
        let status = unsafe { ffi::lc_camera_acquire(camera.as_ptr()) };
        if status != ffi::lc_status_t_LC_STATUS_OK {
            unsafe {
                ffi::lc_camera_manager_stop(manager.as_ptr());
                ffi::lc_camera_manager_destroy(manager.as_ptr());
            }
            if status == ffi::lc_status_t_LC_STATUS_BUSY {
                return Err(Ov5647Error::CameraBusy);
            }
            return Err(Ov5647Error::AcquireFailed);
        }

        log::info!("OV5647 camera acquired (id={})", camera_id);

        Ok(Self {
            inner: Arc::new(Mutex::new(CameraInner {
                manager,
                camera,
                camera_id,
            })),
        })
    }

    fn open_by_id_sync(camera_id: &str) -> Result<Self> {
        let manager = Self::create_manager()?;

        // Get camera by ID
        let id_cstr = std::ffi::CString::new(camera_id)
            .map_err(|_| Ov5647Error::CameraNotFound(camera_id.to_string()))?;

        let camera_ptr = unsafe {
            ffi::lc_camera_manager_get_camera_by_id(manager.as_ptr(), id_cstr.as_ptr())
        };

        let camera = NonNull::new(camera_ptr).ok_or_else(|| {
            unsafe {
                ffi::lc_camera_manager_stop(manager.as_ptr());
                ffi::lc_camera_manager_destroy(manager.as_ptr());
            }
            Ov5647Error::CameraNotFound(camera_id.to_string())
        })?;

        // Acquire camera
        let status = unsafe { ffi::lc_camera_acquire(camera.as_ptr()) };
        if status != ffi::lc_status_t_LC_STATUS_OK {
            unsafe {
                ffi::lc_camera_manager_stop(manager.as_ptr());
                ffi::lc_camera_manager_destroy(manager.as_ptr());
            }
            if status == ffi::lc_status_t_LC_STATUS_BUSY {
                return Err(Ov5647Error::CameraBusy);
            }
            return Err(Ov5647Error::AcquireFailed);
        }

        Ok(Self {
            inner: Arc::new(Mutex::new(CameraInner {
                manager,
                camera,
                camera_id: camera_id.to_string(),
            })),
        })
    }

    fn list_cameras_sync() -> Result<Vec<String>> {
        let manager = Self::create_manager()?;

        let count = unsafe { ffi::lc_camera_manager_camera_count(manager.as_ptr()) };
        let mut cameras = Vec::with_capacity(count);

        for i in 0..count {
            let camera_ptr = unsafe { ffi::lc_camera_manager_get_camera(manager.as_ptr(), i) };
            if let Some(camera) = NonNull::new(camera_ptr) {
                let id = unsafe {
                    let id_ptr = ffi::lc_camera_id(camera.as_ptr());
                    if !id_ptr.is_null() {
                        CStr::from_ptr(id_ptr).to_string_lossy().into_owned()
                    } else {
                        format!("camera_{}", i)
                    }
                };
                cameras.push(id);
            }
        }

        if cameras.is_empty() {
            log::info!("OV5647 list_cameras found zero cameras");
        } else {
            log::info!("OV5647 list_cameras found {} camera(s): {:?}", cameras.len(), cameras);
        }

        unsafe {
            ffi::lc_camera_manager_stop(manager.as_ptr());
            ffi::lc_camera_manager_destroy(manager.as_ptr());
        }

        Ok(cameras)
    }

    fn create_manager() -> Result<NonNull<ffi::lc_camera_manager_t>> {
        let manager_ptr = unsafe { ffi::lc_camera_manager_new() };
        let manager = NonNull::new(manager_ptr)
            .ok_or(Ov5647Error::ManagerInitFailed)?;

        let status = unsafe { ffi::lc_camera_manager_start(manager.as_ptr()) };
        if status != ffi::lc_status_t_LC_STATUS_OK {
            unsafe { ffi::lc_camera_manager_destroy(manager.as_ptr()) };
            return Err(Ov5647Error::ManagerInitFailed);
        }

        Ok(manager)
    }

}

impl Drop for CameraInner {
    fn drop(&mut self) {
        unsafe {
            // Release camera
            ffi::lc_camera_release(self.camera.as_ptr());
        }

        // Allow libcamera internal threads to finish cleanup before stopping the manager.
        std::thread::sleep(std::time::Duration::from_millis(100));

        unsafe {
            // Stop and destroy manager
            ffi::lc_camera_manager_stop(self.manager.as_ptr());
            ffi::lc_camera_manager_destroy(self.manager.as_ptr());
        }
        log::debug!("OV5647 camera released (id={})", self.camera_id);
    }
}

// Re-export for capture module
pub(crate) type CameraInnerRef = CameraInner;

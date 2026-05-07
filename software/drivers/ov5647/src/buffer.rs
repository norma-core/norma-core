use crate::error::{Ov5647Error, Result};
use std::os::unix::io::RawFd;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Unknown,
    Rgb888,
    Bgr888,
    Yuyv,
    Yvyu,
    Uyvy,
    Nv12,
    Nv21,
    Yuv420,
    Mjpeg,
}

impl PixelFormat {
    pub(crate) fn from_ffi(value: i32) -> Self {
        match value {
            1 => PixelFormat::Rgb888,
            2 => PixelFormat::Bgr888,
            3 => PixelFormat::Yuyv,
            4 => PixelFormat::Yvyu,
            5 => PixelFormat::Uyvy,
            6 => PixelFormat::Nv12,
            7 => PixelFormat::Nv21,
            8 => PixelFormat::Yuv420,
            9 => PixelFormat::Mjpeg,
            _ => PixelFormat::Unknown,
        }
    }

    pub(crate) fn to_ffi(self) -> i32 {
        match self {
            PixelFormat::Unknown => 0,
            PixelFormat::Rgb888 => 1,
            PixelFormat::Bgr888 => 2,
            PixelFormat::Yuyv => 3,
            PixelFormat::Yvyu => 4,
            PixelFormat::Uyvy => 5,
            PixelFormat::Nv12 => 6,
            PixelFormat::Nv21 => 7,
            PixelFormat::Yuv420 => 8,
            PixelFormat::Mjpeg => 9,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PlaneInfo {
    pub fd: RawFd,
    pub offset: u32,
    pub length: u32,
}

pub struct MappedBuffer {
    base_ptr: *mut u8,
    ptr: *mut u8,
    len: usize,
    map_len: usize,
}

impl MappedBuffer {
    pub(crate) fn map(plane: &PlaneInfo) -> Result<Self> {
        let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if page_size <= 0 {
            return Err(Ov5647Error::BufferMapFailed(
                "failed to query page size".into(),
            ));
        }

        let page_size = page_size as usize;
        let offset = plane.offset as usize;
        let aligned_offset = offset & !(page_size - 1);
        let delta = offset - aligned_offset;
        let map_len = delta + plane.length as usize;

        let ptr = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                map_len,
                libc::PROT_READ,
                libc::MAP_SHARED,
                plane.fd,
                aligned_offset as i64,
            )
        };

        if ptr == libc::MAP_FAILED {
            return Err(Ov5647Error::BufferMapFailed(
                std::io::Error::last_os_error().to_string(),
            ));
        }

        Ok(Self {
            base_ptr: ptr as *mut u8,
            ptr: unsafe { (ptr as *mut u8).add(delta) },
            len: plane.length as usize,
            map_len,
        })
    }

    pub fn as_slice(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
    }
}

impl Drop for MappedBuffer {
    fn drop(&mut self) {
        if !self.base_ptr.is_null() {
            unsafe {
                libc::munmap(self.base_ptr as *mut libc::c_void, self.map_len);
            }
        }
    }
}

unsafe impl Send for MappedBuffer {}
unsafe impl Sync for MappedBuffer {}

pub struct FrameData {
    pub buffer: Vec<u8>,
    pub format: PixelFormat,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub timestamp_ns: u64,
    pub sequence: u64,
}

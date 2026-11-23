//! Bindings to mf_shim.c.

use std::os::raw::{c_char, c_int};

#[repr(C)]
#[derive(Clone)]
pub struct Device {
    pub id: [c_char; 512],
    pub name: [c_char; 256],
}

impl Default for Device {
    fn default() -> Self {
        Self {
            id: [0; 512],
            name: [0; 256],
        }
    }
}

#[repr(C)]
#[derive(Clone, Default)]
pub struct Format {
    pub index: u32,
    pub fourcc: u32,
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
}

#[repr(C)]
pub struct Frame {
    pub data: *const u8,
    pub len: u32,
    pub width: u32,
    pub height: u32,
    pub fourcc: u32,
}

impl Default for Frame {
    fn default() -> Self {
        Self {
            data: std::ptr::null(),
            len: 0,
            width: 0,
            height: 0,
            fourcc: 0,
        }
    }
}

#[repr(C)]
pub struct Capture {
    _private: [u8; 0],
}

unsafe extern "C" {
    pub fn nc_mf_thread_init() -> c_int;
    pub fn nc_mf_thread_done();
    pub fn nc_mf_list(out: *mut Device, cap: c_int) -> c_int;
    pub fn nc_mf_formats(id: *const c_char, out: *mut Format, cap: c_int) -> c_int;
    pub fn nc_mf_open(id: *const c_char, index: u32, err: *mut c_int) -> *mut Capture;
    pub fn nc_mf_interrupt(c: *mut Capture) -> c_int;
    pub fn nc_mf_read(c: *mut Capture, frame: *mut Frame) -> c_int;
    pub fn nc_mf_close(c: *mut Capture);
}

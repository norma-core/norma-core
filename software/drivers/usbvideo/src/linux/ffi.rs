use crate::usbvideo_proto::usbvideo;
use bytes::Bytes;
use norm_uvc_sys::*;
use std::ffi::CStr;

const HIKMICRO_VENDOR_ID: u16 = 0x2bdf;

fn is_reserved_uvc_vendor(vendor_id: u16) -> bool {
    vendor_id == HIKMICRO_VENDOR_ID
}

#[derive(Debug, Clone)]
pub struct FrameInfo {
    pub width: u32,
    pub height: u32,
    pub sequence: u32,
    pub unix_timestamp_ns: u64,
    pub boottime_timestamp_ns: u64,
    pub format: u32,
    pub fourcc: u32,
    pub data: Bytes,
}

unsafe impl Send for FrameInfo {}
unsafe impl Sync for FrameInfo {}

/// Convert UVC frame format to FourCC
#[allow(non_upper_case_globals)]
fn uvc_format_to_fourcc(uvc_format: u32) -> u32 {
    match uvc_format {
        uvc_frame_format_UVC_FRAME_FORMAT_YUYV => u32::from_be_bytes(*b"YUY2"),
        uvc_frame_format_UVC_FRAME_FORMAT_UYVY => u32::from_be_bytes(*b"UYVY"),
        uvc_frame_format_UVC_FRAME_FORMAT_RGB => u32::from_be_bytes(*b"RGB3"),
        uvc_frame_format_UVC_FRAME_FORMAT_BGR => u32::from_be_bytes(*b"BGR3"),
        uvc_frame_format_UVC_FRAME_FORMAT_MJPEG => u32::from_be_bytes(*b"MJPG"),
        uvc_frame_format_UVC_FRAME_FORMAT_GRAY8 => u32::from_be_bytes(*b"GREY"),
        uvc_frame_format_UVC_FRAME_FORMAT_GRAY16 => u32::from_be_bytes(*b"Y16 "),
        uvc_frame_format_UVC_FRAME_FORMAT_BY8 => u32::from_be_bytes(*b"BY8 "),
        uvc_frame_format_UVC_FRAME_FORMAT_BA81 => u32::from_be_bytes(*b"BA81"),
        uvc_frame_format_UVC_FRAME_FORMAT_SGRBG8 => u32::from_be_bytes(*b"GRBG"),
        uvc_frame_format_UVC_FRAME_FORMAT_SGBRG8 => u32::from_be_bytes(*b"GBRG"),
        uvc_frame_format_UVC_FRAME_FORMAT_SRGGB8 => u32::from_be_bytes(*b"RGGB"),
        uvc_frame_format_UVC_FRAME_FORMAT_SBGGR8 => u32::from_be_bytes(*b"BGGR"),
        _ => {
            let fourcc_bytes = uvc_format.to_be_bytes();
            let fourcc_str = String::from_utf8_lossy(&fourcc_bytes);
            log::warn!(
                "Unknown UVC frame format: {} (0x{:08X}, '{}')",
                uvc_format,
                uvc_format,
                fourcc_str
            );
            0
        }
    }
}

pub fn new_uvc_context() -> Result<*mut uvc_context, uvc_error> {
    unsafe {
        let mut ctx = std::mem::MaybeUninit::<*mut uvc_context>::uninit();
        let err = uvc_init(ctx.as_mut_ptr(), std::ptr::null_mut());
        if err == uvc_error_UVC_SUCCESS {
            Ok(ctx.assume_init())
        } else {
            Err(err)
        }
    }
}

pub fn drop_uvc_context(context: *mut uvc_context) {
    if !context.is_null() {
        unsafe {
            uvc_exit(context);
        }
    }
}

pub fn get_available_cameras(context: *mut uvc_context) -> Vec<usbvideo::Camera> {
    let mut cameras = Vec::new();

    if context.is_null() {
        log::warn!("UVC context is null");
        return cameras;
    }

    unsafe {
        let mut device_list = std::mem::MaybeUninit::<*mut *mut uvc_device>::uninit();
        let err = uvc_get_device_list(context, device_list.as_mut_ptr());

        if err != uvc_error_UVC_SUCCESS {
            log::warn!("Failed to get device list: {}", err);
            return cameras;
        }

        let device_list = device_list.assume_init();
        if device_list.is_null() {
            return cameras;
        }

        let mut i = 0;
        loop {
            let device_ptr = *device_list.offset(i);
            if device_ptr.is_null() {
                break;
            }

            let mut desc = std::mem::MaybeUninit::<*mut uvc_device_descriptor>::uninit();
            let desc_err = uvc_get_device_descriptor(device_ptr, desc.as_mut_ptr());

            if desc_err != uvc_error_UVC_SUCCESS {
                log::warn!("Failed to get device descriptor: {}", desc_err);
                i += 1;
                continue;
            }

            let desc = desc.assume_init();
            if desc.is_null() {
                i += 1;
                continue;
            }

            let desc_ref = &*desc;
            let bus_number = uvc_get_bus_number(device_ptr) as u32;
            let device_number = uvc_get_device_address(device_ptr) as u32;

            if is_reserved_uvc_vendor(desc_ref.idVendor) {
                log::debug!(
                    "Skipping reserved UVC vendor {:04x} on bus {} device {}",
                    desc_ref.idVendor,
                    bus_number,
                    device_number
                );
                uvc_free_device_descriptor(desc);
                i += 1;
                continue;
            }

            let serial_number = if desc_ref.serialNumber.is_null() {
                "".to_string()
            } else {
                CStr::from_ptr(desc_ref.serialNumber)
                    .to_string_lossy()
                    .into_owned()
            };

            let manufacturer = if desc_ref.manufacturer.is_null() {
                "Unknown".to_string()
            } else {
                CStr::from_ptr(desc_ref.manufacturer)
                    .to_string_lossy()
                    .into_owned()
            };

            let product = if desc_ref.product.is_null() {
                "Unknown".to_string()
            } else {
                CStr::from_ptr(desc_ref.product)
                    .to_string_lossy()
                    .into_owned()
            };

            let unique_id = format!(
                "{}:{}:{}:{}",
                desc_ref.idVendor, desc_ref.idProduct, bus_number, device_number
            );

            let camera = usbvideo::Camera {
                vendor_id: desc_ref.idVendor as u32,
                product_id: desc_ref.idProduct as u32,
                serial_number,
                manufacturer,
                product,
                bus_number,
                device_number,
                unique_id,
            };

            cameras.push(camera);
            uvc_free_device_descriptor(desc);
            i += 1;
        }

        uvc_free_device_list(device_list, 1);
    }

    cameras
}

pub fn find_device_by_camera(
    context: *mut uvc_context,
    camera: &usbvideo::Camera,
) -> *mut uvc_device {
    if context.is_null() {
        return std::ptr::null_mut();
    }

    unsafe {
        let mut device_list = std::mem::MaybeUninit::<*mut *mut uvc_device>::uninit();
        let err = uvc_get_device_list(context, device_list.as_mut_ptr());

        if err != uvc_error_UVC_SUCCESS {
            return std::ptr::null_mut();
        }

        let device_list = device_list.assume_init();
        if device_list.is_null() {
            return std::ptr::null_mut();
        }

        let mut found_device = std::ptr::null_mut();
        let mut i = 0;
        loop {
            let device_ptr = *device_list.offset(i);
            if device_ptr.is_null() {
                break;
            }

            let mut desc = std::mem::MaybeUninit::<*mut uvc_device_descriptor>::uninit();
            let desc_err = uvc_get_device_descriptor(device_ptr, desc.as_mut_ptr());

            if desc_err == uvc_error_UVC_SUCCESS {
                let desc = desc.assume_init();
                if !desc.is_null() {
                    let desc_ref = &*desc;
                    let bus_number = uvc_get_bus_number(device_ptr) as u32;
                    let device_number = uvc_get_device_address(device_ptr) as u32;

                    if desc_ref.idVendor as u32 == camera.vendor_id
                        && desc_ref.idProduct as u32 == camera.product_id
                        && bus_number == camera.bus_number
                        && device_number == camera.device_number
                    {
                        uvc_ref_device(device_ptr);
                        found_device = device_ptr;
                        uvc_free_device_descriptor(desc);
                        break;
                    }

                    uvc_free_device_descriptor(desc);
                }
            }
            i += 1;
        }

        uvc_free_device_list(device_list, 1);
        found_device
    }
}

#[allow(non_upper_case_globals)]
unsafe fn get_format_fourcc(format_desc: *const uvc_format_desc) -> u32 {
    let format_desc_ref = unsafe { &*format_desc };

    unsafe {
        match format_desc_ref.bDescriptorSubtype {
            uvc_vs_desc_subtype_UVC_VS_FORMAT_MJPEG => {
                u32::from_be_bytes(format_desc_ref.__bindgen_anon_1.fourccFormat)
            }
            uvc_vs_desc_subtype_UVC_VS_FORMAT_UNCOMPRESSED => {
                let guid = format_desc_ref.__bindgen_anon_1.guidFormat;
                u32::from_be_bytes([guid[0], guid[1], guid[2], guid[3]])
            }
            _ => u32::from_be_bytes(format_desc_ref.__bindgen_anon_1.fourccFormat),
        }
    }
}

unsafe fn get_frame_fps_values(frame_desc: *const uvc_frame_desc) -> Vec<f32> {
    let frame_desc_ref = unsafe { &*frame_desc };
    let mut fps_values = Vec::new();

    if !frame_desc_ref.intervals.is_null() {
        let mut interval_idx = 0;
        loop {
            let interval = unsafe { *frame_desc_ref.intervals.offset(interval_idx) };
            if interval == 0 {
                break;
            }

            let fps = 10_000_000.0 / interval as f32;
            fps_values.push(fps);
            interval_idx += 1;
        }
    } else if frame_desc_ref.dwDefaultFrameInterval > 0 {
        let fps = 10_000_000.0 / frame_desc_ref.dwDefaultFrameInterval as f32;
        fps_values.push(fps);
    }

    fps_values
}

pub fn get_camera_formats(
    context: *mut uvc_context,
    camera: &usbvideo::Camera,
) -> Vec<usbvideo::CameraFormat> {
    let mut formats = Vec::new();

    if context.is_null() {
        log::warn!("UVC context is null");
        return formats;
    }

    unsafe {
        let device_ptr = find_device_by_camera(context, camera);
        if device_ptr.is_null() {
            log::warn!("Failed to find device for camera {}", camera.unique_id);
            return formats;
        }

        let mut device_handle = std::ptr::null_mut();
        let open_err = uvc_open(device_ptr, &mut device_handle);

        if open_err != uvc_error_UVC_SUCCESS || device_handle.is_null() {
            log::warn!(
                "Failed to open device for camera {}: {}",
                camera.unique_id,
                open_err
            );
            uvc_unref_device(device_ptr);
            return formats;
        }

        let format_descs = uvc_get_format_descs(device_handle);
        let mut current_format = format_descs;
        while !current_format.is_null() {
            let format_desc_ref = &*current_format;
            let fourcc = get_format_fourcc(current_format);

            if fourcc != 0 {
                let format_index = format_desc_ref.bFormatIndex as u32;
                let guid = if format_desc_ref.bDescriptorSubtype
                    == uvc_vs_desc_subtype_UVC_VS_FORMAT_UNCOMPRESSED
                {
                    format_desc_ref.__bindgen_anon_1.guidFormat.to_vec()
                } else {
                    vec![]
                };
                let guid = Bytes::from(guid);

                let mut current_frame = format_desc_ref.frame_descs;
                while !current_frame.is_null() {
                    let frame_desc_ref = &*current_frame;

                    let width = frame_desc_ref.wWidth as u32;
                    let height = frame_desc_ref.wHeight as u32;
                    let frame_index = frame_desc_ref.bFrameIndex as u32;
                    let fps_values = get_frame_fps_values(current_frame);
                    for fps in fps_values {
                        let camera_format = usbvideo::CameraFormat {
                            fourcc,
                            index: format_index,
                            frame_index,
                            width,
                            height,
                            frames_per_second: fps,
                            guid: guid.clone(),
                        };

                        formats.push(camera_format);
                    }

                    current_frame = frame_desc_ref.next;
                }
            }

            current_format = format_desc_ref.next;
        }

        uvc_close(device_handle);
        uvc_unref_device(device_ptr);
    }

    formats
}

pub struct StreamHandle {
    pub device_handle: *mut uvc_device_handle,
    pub device_ptr: *mut uvc_device,
    pub stream_ctrl: uvc_stream_ctrl_t,
    pub stream_handle: *mut uvc_stream_handle,
}

impl Drop for StreamHandle {
    fn drop(&mut self) {
        unsafe {
            if !self.stream_handle.is_null() {
                uvc_stream_stop(self.stream_handle);
                uvc_stream_close(self.stream_handle);
                self.stream_handle = std::ptr::null_mut();
            }

            if !self.device_handle.is_null() {
                uvc_close(self.device_handle);
                self.device_handle = std::ptr::null_mut();
            }

            if !self.device_ptr.is_null() {
                uvc_unref_device(self.device_ptr);
                self.device_ptr = std::ptr::null_mut();
            }
        }
    }
}

pub fn get_stream_handle(
    context: *mut uvc_context,
    camera: &usbvideo::Camera,
    format: &usbvideo::CameraFormat,
) -> Result<StreamHandle, uvc_error> {
    if context.is_null() {
        return Err(uvc_error_UVC_ERROR_INVALID_PARAM);
    }

    unsafe {
        let device_ptr = find_device_by_camera(context, camera);
        if device_ptr.is_null() {
            return Err(uvc_error_UVC_ERROR_NO_DEVICE);
        }

        let mut device_handle = std::ptr::null_mut();
        let open_err = uvc_open(device_ptr, &mut device_handle);

        if open_err != uvc_error_UVC_SUCCESS || device_handle.is_null() {
            log::warn!(
                "Failed to open device for camera {}: {}",
                camera.unique_id,
                open_err
            );
            uvc_unref_device(device_ptr);
            return Err(open_err);
        }

        let uvc_format = match format.fourcc {
            0x4D4A5047 => uvc_frame_format_UVC_FRAME_FORMAT_MJPEG, // 'MJPG' (big-endian)
            0x4A504547 => uvc_frame_format_UVC_FRAME_FORMAT_MJPEG, // 'JPEG' (big-endian)
            0x55595659 => uvc_frame_format_UVC_FRAME_FORMAT_UYVY,  // 'UYVY' (big-endian)
            0x59555932 => uvc_frame_format_UVC_FRAME_FORMAT_YUYV,  // 'YUY2' (big-endian)
            0x59555956 => uvc_frame_format_UVC_FRAME_FORMAT_YUYV,  // 'YUYV' (big-endian)
            _ => {
                let fourcc_bytes = format.fourcc.to_be_bytes();
                let fourcc_str = String::from_utf8_lossy(&fourcc_bytes);
                log::warn!(
                    "Unknown fourcc format 0x{:08X} ('{}'), trying MJPEG as fallback",
                    format.fourcc,
                    fourcc_str
                );
                uvc_frame_format_UVC_FRAME_FORMAT_MJPEG
            }
        };

        let mut stream_ctrl = std::mem::zeroed::<uvc_stream_ctrl_t>();

        let ctrl_err = uvc_get_stream_ctrl_format_size(
            device_handle,
            &mut stream_ctrl,
            uvc_format,
            format.width as i32,
            format.height as i32,
            format.frames_per_second as i32,
        );

        if ctrl_err != uvc_error_UVC_SUCCESS {
            uvc_close(device_handle);
            uvc_unref_device(device_ptr);
            return Err(ctrl_err);
        }

        Ok(StreamHandle {
            device_handle,
            device_ptr,
            stream_ctrl,
            stream_handle: std::ptr::null_mut(),
        })
    }
}

pub fn start_streaming(stream_handle: &mut StreamHandle) -> Result<(), uvc_error> {
    unsafe {
        if !stream_handle.stream_handle.is_null() {
            uvc_stream_stop(stream_handle.stream_handle);
            uvc_stream_close(stream_handle.stream_handle);
            stream_handle.stream_handle = std::ptr::null_mut();
        }

        let mut stream_hdl: *mut uvc_stream_handle = std::ptr::null_mut();
        let err = uvc_stream_open_ctrl(
            stream_handle.device_handle,
            &mut stream_hdl,
            &mut stream_handle.stream_ctrl,
        );

        if err != uvc_error_UVC_SUCCESS {
            return Err(err);
        }

        let start_err = uvc_stream_start(stream_hdl, None, std::ptr::null_mut(), 0);

        if start_err != uvc_error_UVC_SUCCESS {
            uvc_stream_close(stream_hdl);
            return Err(start_err);
        }

        stream_handle.stream_handle = stream_hdl;

        Ok(())
    }
}

pub fn stop_streaming(stream_handle: &mut StreamHandle) {
    unsafe {
        if !stream_handle.stream_handle.is_null() {
            uvc_stream_stop(stream_handle.stream_handle);
            uvc_stream_close(stream_handle.stream_handle);
            stream_handle.stream_handle = std::ptr::null_mut();
        }
    }
}

/// Get raw UVC frame pointer without copying data
pub fn get_uvc_frame(
    stream_handle: &StreamHandle,
    timeout_us: u32,
) -> Result<*mut uvc_frame, uvc_error> {
    if stream_handle.stream_handle.is_null() {
        return Err(uvc_error_UVC_ERROR_INVALID_PARAM);
    }

    unsafe {
        let mut frame: *mut uvc_frame = std::ptr::null_mut();
        let err = uvc_stream_get_frame(stream_handle.stream_handle, &mut frame, timeout_us as i32);

        if err != uvc_error_UVC_SUCCESS {
            Err(err)
        } else if frame.is_null() {
            Err(uvc_error_UVC_ERROR_NO_MEM)
        } else {
            Ok(frame)
        }
    }
}

pub fn get_last_frame(
    stream_handle: &StreamHandle,
    timeout_us: u32,
) -> Result<FrameInfo, uvc_error> {
    // Get the first frame pointer without copying data
    let mut latest_frame_ptr = get_uvc_frame(stream_handle, timeout_us)?;

    // Drain remaining frames without copying data, just count them
    let mut drained_count = 0;
    loop {
        match get_uvc_frame(stream_handle, 500) {
            Ok(frame_ptr) => {
                drained_count += 1;
                // Update the latest frame pointer (no copying yet)
                latest_frame_ptr = frame_ptr;
            }
            Err(e) => {
                if e == norm_uvc_sys::uvc_error_UVC_ERROR_TIMEOUT {
                    // Finished draining frames
                    break;
                } else {
                    return Err(e);
                }
            }
        }
    }

    // Now copy data only once from the final latest frame
    let latest_frame_info = unsafe {
        let frame_ref = &*latest_frame_ptr;

        // Copy frame data into owned Bytes for the latest frame
        let frame_data =
            std::slice::from_raw_parts(frame_ref.data as *const u8, frame_ref.data_bytes);
        let data = Bytes::copy_from_slice(frame_data);
        let fourcc = uvc_format_to_fourcc(frame_ref.frame_format);

        FrameInfo {
            width: frame_ref.width,
            height: frame_ref.height,
            sequence: frame_ref.sequence,
            unix_timestamp_ns: frame_ref.capture_realtime_finished,
            boottime_timestamp_ns: frame_ref.capture_boottime_finished,
            format: frame_ref.frame_format,
            fourcc,
            data,
        }
    };

    // Log info about skipped frames if any were drained
    if drained_count > 0 {
        log::info!(
            "Drained {} frames to get latest frame (sequence: {})",
            drained_count,
            latest_frame_info.sequence
        );
    }

    Ok(latest_frame_info)
}

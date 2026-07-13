use std::{
    ffi::CStr,
    mem::MaybeUninit,
    ptr,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use bytes::Bytes;
use libc::{c_char, c_int, c_uchar};
use libusb1_sys as usb;
use norm_uvc_sys::*;
use normfs::NormFS;

use crate::{
    COMPACT_FPS, COMPACT_PAYLOAD_LEN, COMPACT_UVC_HEIGHT, COMPACT_UVC_WIDTH, CameraIdentity,
    FOURCC_YUY2, RUNTIME_BLOCK_LEN, THERMAL_Y16_LEN, compact_layout, enqueue_envelope,
    hikmicro_proto::hikmicro, parse_runtime_block,
};

const HIK_VENDOR_ID: u16 = 0x2bdf;
const HIK_PRODUCT_ID: u16 = 0x0102;
const XU_UNIT_ID: u8 = 10;
const XU_INTERFACE: u8 = 0;
const XU_W_INDEX: u16 = (XU_UNIT_ID as u16) << 8;
const USB_TIMEOUT_MS: u32 = 1_000;
const FRAMES_PER_RX_ENVELOPE: usize = 25;

/// `frame_skip` is the number of frames dropped after each kept frame,
/// so we keep 1 of every `frame_skip + 1`. `0` keeps every frame.
fn should_keep(count: u64, frame_skip: u32) -> bool {
    count.is_multiple_of(frame_skip as u64 + 1)
}

pub fn discover_cameras() -> Result<Vec<CameraIdentity>, String> {
    let ctx = UvcContext::new()?;
    let mut cameras = Vec::new();

    unsafe {
        let mut device_list = MaybeUninit::<*mut *mut uvc_device>::uninit();
        let err = uvc_get_device_list(ctx.ptr, device_list.as_mut_ptr());
        if err != uvc_error_UVC_SUCCESS {
            return Err(format!("uvc_get_device_list failed: {}", err));
        }

        let list = UvcDeviceList(device_list.assume_init());
        if list.0.is_null() {
            return Ok(cameras);
        }

        let mut i = 0;
        loop {
            let dev = *list.0.offset(i);
            if dev.is_null() {
                break;
            }

            let mut desc = MaybeUninit::<*mut uvc_device_descriptor>::uninit();
            let desc_err = uvc_get_device_descriptor(dev, desc.as_mut_ptr());
            if desc_err == uvc_error_UVC_SUCCESS {
                let desc = UvcDeviceDescriptor(desc.assume_init());
                if !desc.0.is_null() {
                    let d = &*desc.0;
                    if d.idVendor == HIK_VENDOR_ID && d.idProduct == HIK_PRODUCT_ID {
                        let bus_number = uvc_get_bus_number(dev) as u32;
                        let device_number = uvc_get_device_address(dev) as u32;
                        let serial_number = cstr_or_empty(d.serialNumber);
                        let unique_id = if serial_number.is_empty() {
                            format!(
                                "{:04x}:{:04x}:{}:{}",
                                d.idVendor, d.idProduct, bus_number, device_number
                            )
                        } else {
                            format!("{:04x}:{:04x}:{}", d.idVendor, d.idProduct, serial_number)
                        };

                        cameras.push(CameraIdentity {
                            vendor_id: d.idVendor as u32,
                            product_id: d.idProduct as u32,
                            bus_number,
                            device_number,
                            serial_number,
                            manufacturer: cstr_or_empty(d.manufacturer),
                            product: cstr_or_empty(d.product),
                            unique_id,
                        });
                    }
                }
            }

            i += 1;
        }
    }

    Ok(cameras)
}

pub fn enqueue_device_info(
    camera: &CameraIdentity,
    normfs: &NormFS,
    queue_id: &normfs::QueueId,
) -> Result<hikmicro::DeviceInfo, String> {
    let calibration = read_calibration_for_camera(camera);
    let device_info = hikmicro::DeviceInfo {
        driver: "hikmicro-thermal/linux/libuvc+libusb".to_string(),
        usb: Some(usb_device_info(camera).unwrap_or_else(|e| {
            log::warn!("Failed to read HIKMICRO USB descriptors: {}", e);
            fallback_usb_info(camera)
        })),
        stream_format: Some(compact_stream_format()),
        layout: Some(compact_layout()),
        calibration: Some(calibration),
    };
    enqueue_envelope(
        normfs,
        queue_id,
        hikmicro::RxEnvelope {
            device_info: Some(device_info.clone()),
            frames: None,
        },
    )?;

    Ok(device_info)
}

pub fn capture_continuous(
    camera: &CameraIdentity,
    device_info: hikmicro::DeviceInfo,
    normfs: &NormFS,
    queue_id: &normfs::QueueId,
    stop: &AtomicBool,
    frame_timeout: Duration,
    frame_skip: u32,
) -> Result<(), String> {
    let ctx = UvcContext::new()?;
    let mut stream = open_compact_stream(&ctx, camera)?;
    stream.start()?;

    let mut block_sequence = 0u32;
    let mut last_frame = Instant::now();
    let mut valid_frame_count = 0u64;
    let mut frames = Vec::with_capacity(FRAMES_PER_RX_ENVELOPE);
    while !stop.load(Ordering::Acquire) {
        if last_frame.elapsed() > frame_timeout {
            return Err(format!(
                "no HIKMICRO frames for {:.1}s",
                frame_timeout.as_secs_f32()
            ));
        }

        match stream.read_frame(200_000) {
            Ok(frame) => {
                last_frame = Instant::now();
                if frame.data.len() < COMPACT_PAYLOAD_LEN {
                    log::warn!("Skipping short HIKMICRO frame: {} bytes", frame.data.len());
                    continue;
                }

                let count = valid_frame_count;
                valid_frame_count = valid_frame_count.wrapping_add(1);
                if !should_keep(count, frame_skip) {
                    continue;
                }

                frames.push(thermal_frame_from_capture(frame));
                if frames.len() >= FRAMES_PER_RX_ENVELOPE {
                    enqueue_frames_block(
                        normfs,
                        queue_id,
                        &device_info,
                        block_sequence,
                        std::mem::take(&mut frames),
                    )?;
                    block_sequence = block_sequence.wrapping_add(1);
                    frames.reserve(FRAMES_PER_RX_ENVELOPE);
                }
            }
            Err(e) if e == uvc_error_UVC_ERROR_TIMEOUT => {}
            Err(e) => return Err(format!("uvc_stream_get_frame failed: {}", e)),
        }
    }

    if !frames.is_empty() {
        enqueue_frames_block(normfs, queue_id, &device_info, block_sequence, frames)?;
    }

    Ok(())
}

fn enqueue_frames_block(
    normfs: &NormFS,
    queue_id: &normfs::QueueId,
    device_info: &hikmicro::DeviceInfo,
    block_sequence: u32,
    frames: Vec<hikmicro::ThermalFrame>,
) -> Result<(), String> {
    let first = frames.first().expect("non-empty frames block");
    let last = frames.last().expect("non-empty frames block");
    let block = hikmicro::ThermalFramesBlock {
        sequence: block_sequence,
        frame_count: frames.len() as u32,
        monotonic_start_ns: first.monotonic_stamp_ns,
        monotonic_end_ns: last.monotonic_stamp_ns,
        local_start_ns: first.local_stamp_ns,
        local_end_ns: last.local_stamp_ns,
        stream_format: Some(compact_stream_format()),
        layout: Some(compact_layout()),
        frames,
    };

    enqueue_envelope(
        normfs,
        queue_id,
        hikmicro::RxEnvelope {
            device_info: Some(device_info.clone()),
            frames: Some(block),
        },
    )
}

fn thermal_frame_from_capture(frame: CapturedFrame) -> hikmicro::ThermalFrame {
    let runtime = frame
        .data
        .get(THERMAL_Y16_LEN..THERMAL_Y16_LEN + RUNTIME_BLOCK_LEN)
        .map(parse_runtime_block)
        .unwrap_or_default();

    hikmicro::ThermalFrame {
        sequence: frame.sequence,
        monotonic_stamp_ns: frame.monotonic_stamp_ns,
        local_stamp_ns: frame.local_stamp_ns,
        runtime: Some(runtime),
        payload: frame.data,
    }
}

fn compact_stream_format() -> hikmicro::CompactStreamFormat {
    hikmicro::CompactStreamFormat {
        fourcc: FOURCC_YUY2,
        format_index: 1,
        frame_index: 2,
        uvc_width: COMPACT_UVC_WIDTH,
        uvc_height: COMPACT_UVC_HEIGHT,
        frames_per_second: COMPACT_FPS,
        guid: Bytes::copy_from_slice(b"YUY2\0\0\x10\0\x80\0\0\xaa\0\x38\x9b\x71"),
        source_format: uvc_frame_format_UVC_FRAME_FORMAT_YUYV,
    }
}

fn open_compact_stream(ctx: &UvcContext, camera: &CameraIdentity) -> Result<StreamHandle, String> {
    unsafe {
        let dev = find_uvc_device(ctx.ptr, camera)?;
        let mut handle = ptr::null_mut();
        let open_err = uvc_open(dev, &mut handle);
        if open_err != uvc_error_UVC_SUCCESS || handle.is_null() {
            uvc_unref_device(dev);
            return Err(format!("uvc_open failed: {}", open_err));
        }

        let mut ctrl = std::mem::zeroed::<uvc_stream_ctrl_t>();
        let ctrl_err = uvc_get_stream_ctrl_format_size(
            handle,
            &mut ctrl,
            uvc_frame_format_UVC_FRAME_FORMAT_YUYV,
            COMPACT_UVC_WIDTH as i32,
            COMPACT_UVC_HEIGHT as i32,
            COMPACT_FPS as i32,
        );
        if ctrl_err != uvc_error_UVC_SUCCESS {
            uvc_close(handle);
            uvc_unref_device(dev);
            return Err(format!(
                "uvc_get_stream_ctrl_format_size failed: {}",
                ctrl_err
            ));
        }

        Ok(StreamHandle {
            device: dev,
            handle,
            ctrl,
            stream: ptr::null_mut(),
        })
    }
}

unsafe fn find_uvc_device(
    ctx: *mut uvc_context,
    camera: &CameraIdentity,
) -> Result<*mut uvc_device, String> {
    let mut device_list = MaybeUninit::<*mut *mut uvc_device>::uninit();
    let err = unsafe { uvc_get_device_list(ctx, device_list.as_mut_ptr()) };
    if err != uvc_error_UVC_SUCCESS {
        return Err(format!("uvc_get_device_list failed: {}", err));
    }
    let list = UvcDeviceList(unsafe { device_list.assume_init() });

    let mut i = 0;
    loop {
        let dev = unsafe { *list.0.offset(i) };
        if dev.is_null() {
            break;
        }

        let mut desc = MaybeUninit::<*mut uvc_device_descriptor>::uninit();
        let desc_err = unsafe { uvc_get_device_descriptor(dev, desc.as_mut_ptr()) };
        if desc_err == uvc_error_UVC_SUCCESS {
            let desc = UvcDeviceDescriptor(unsafe { desc.assume_init() });
            if !desc.0.is_null() {
                let d = unsafe { &*desc.0 };
                let bus = unsafe { uvc_get_bus_number(dev) as u32 };
                let addr = unsafe { uvc_get_device_address(dev) as u32 };
                if d.idVendor as u32 == camera.vendor_id
                    && d.idProduct as u32 == camera.product_id
                    && bus == camera.bus_number
                    && addr == camera.device_number
                {
                    unsafe { uvc_ref_device(dev) };
                    return Ok(dev);
                }
            }
        }
        i += 1;
    }

    Err(format!("camera not found: {}", camera.unique_id))
}

fn read_calibration_for_camera(camera: &CameraIdentity) -> hikmicro::CalibrationData {
    let mut calibration = hikmicro::CalibrationData {
        attempted: true,
        ..Default::default()
    };

    match UsbDeviceHandle::open(camera).and_then(|mut dev| read_calibration(&mut dev)) {
        Ok(ok) => ok,
        Err(e) => {
            calibration.error = e;
            calibration
        }
    }
}

fn read_calibration(dev: &mut UsbDeviceHandle) -> Result<hikmicro::CalibrationData, String> {
    dev.claim_interface(XU_INTERFACE as c_int)?;
    let result = read_calibration_claimed(dev);
    let release = dev.release_interface(XU_INTERFACE as c_int);
    dev.reattach_if_needed(XU_INTERFACE as c_int);
    if let Err(e) = release {
        log::warn!("Failed to release HIKMICRO interface: {}", e);
    }
    result
}

fn read_calibration_claimed(dev: &UsbDeviceHandle) -> Result<hikmicro::CalibrationData, String> {
    prime_xu(dev);
    xu_set_cur(dev, 5, &[0x03, 0x0e])?;

    let first_len = xu_get_len(dev, 3)?;
    let length_header = xu_get_cur(dev, 3, first_len.max(5).min(512) as u16)?;
    if length_header.len() < 5 || length_header[0] != 0x01 {
        return Err(format!(
            "unexpected calibration length header: {}",
            hex_prefix(&length_header, 16)
        ));
    }

    let declared = u32::from_le_bytes([
        length_header[1],
        length_header[2],
        length_header[3],
        length_header[4],
    ]) as usize;
    if declared == 0 || declared > 1024 * 1024 {
        return Err(format!("invalid calibration length: {}", declared));
    }

    let mut container = Vec::with_capacity(declared);
    let mut chunks = Vec::new();
    while container.len() < declared {
        let len = xu_get_len(dev, 3)? as usize;
        let chunk = xu_get_cur(dev, 3, len as u16)?;
        if chunk.len() < 5 {
            return Err(format!("short calibration chunk: {}", chunk.len()));
        }

        let index = u32::from_le_bytes([chunk[1], chunk[2], chunk[3], chunk[4]]);
        let payload_len = (declared - container.len()).min(chunk.len() - 5);
        let payload = chunk[5..5 + payload_len].to_vec();
        container.extend_from_slice(&payload);
        chunks.push(hikmicro::CalibrationChunk {
            index,
            header: Bytes::copy_from_slice(&chunk[..5]),
            payload: Bytes::from(payload),
        });
    }

    let (blob_offset, blob_len) = parse_factory_blob_range(&container);
    Ok(hikmicro::CalibrationData {
        attempted: true,
        ok: true,
        error: String::new(),
        length_header: Bytes::from(length_header),
        declared_length: declared as u32,
        container: Bytes::from(container),
        factory_blob_offset: blob_offset as u32,
        factory_blob_length: blob_len as u32,
        chunks,
    })
}

fn parse_factory_blob_range(container: &[u8]) -> (usize, usize) {
    if container.len() >= 0x44 {
        let len = u32::from_le_bytes([
            container[0x40],
            container[0x41],
            container[0x42],
            container[0x43],
        ]) as usize;
        if len > 0 && 0x44 + len <= container.len() {
            return (0x44, len);
        }
    }
    (0, 0)
}

fn prime_xu(dev: &UsbDeviceHandle) {
    for selector in 1..=6 {
        if let Ok(len) = xu_get_len(dev, selector) {
            let len = len.clamp(1, 512);
            let _ = xu_get_cur(dev, selector, len);
        }
    }
}

fn xu_get_len(dev: &UsbDeviceHandle, selector: u8) -> Result<u16, String> {
    let data = dev.control_in(0xa1, 0x85, (selector as u16) << 8, XU_W_INDEX, 2)?;
    if data.len() != 2 {
        return Err(format!(
            "GET_LEN selector {} returned {} bytes",
            selector,
            data.len()
        ));
    }
    Ok(u16::from_le_bytes([data[0], data[1]]))
}

fn xu_get_cur(dev: &UsbDeviceHandle, selector: u8, len: u16) -> Result<Vec<u8>, String> {
    dev.control_in(0xa1, 0x81, (selector as u16) << 8, XU_W_INDEX, len)
}

fn xu_set_cur(dev: &UsbDeviceHandle, selector: u8, payload: &[u8]) -> Result<(), String> {
    let status = dev.control_out(0x21, 0x01, (selector as u16) << 8, XU_W_INDEX, payload)?;
    if status != payload.len() as i32 {
        return Err(format!(
            "SET_CUR selector {} wrote {} of {} bytes",
            selector,
            status,
            payload.len()
        ));
    }
    Ok(())
}

fn usb_device_info(camera: &CameraIdentity) -> Result<hikmicro::UsbDeviceInfo, String> {
    let handle = UsbDeviceHandle::open(camera)?;
    let device_descriptor = handle.device_descriptor_bytes()?;
    let config_descriptors = handle.config_descriptor_bytes()?;
    let port_numbers = handle.port_numbers();

    let usb_bcd = u16::from_le_bytes([device_descriptor[2], device_descriptor[3]]) as u32;
    let device_bcd = u16::from_le_bytes([device_descriptor[12], device_descriptor[13]]) as u32;

    Ok(hikmicro::UsbDeviceInfo {
        vendor_id: camera.vendor_id,
        product_id: camera.product_id,
        bus_number: camera.bus_number,
        device_number: camera.device_number,
        port_numbers,
        unique_id: camera.unique_id.clone(),
        manufacturer: camera.manufacturer.clone(),
        product: camera.product.clone(),
        serial_number: camera.serial_number.clone(),
        usb_bcd,
        device_bcd,
        device_class: device_descriptor[4] as u32,
        device_subclass: device_descriptor[5] as u32,
        device_protocol: device_descriptor[6] as u32,
        max_packet_size0: device_descriptor[7] as u32,
        num_configurations: device_descriptor[17] as u32,
        device_descriptor: Bytes::from(device_descriptor),
        config_descriptors: config_descriptors.into_iter().map(Bytes::from).collect(),
    })
}

fn fallback_usb_info(camera: &CameraIdentity) -> hikmicro::UsbDeviceInfo {
    hikmicro::UsbDeviceInfo {
        vendor_id: camera.vendor_id,
        product_id: camera.product_id,
        bus_number: camera.bus_number,
        device_number: camera.device_number,
        unique_id: camera.unique_id.clone(),
        manufacturer: camera.manufacturer.clone(),
        product: camera.product.clone(),
        serial_number: camera.serial_number.clone(),
        ..Default::default()
    }
}

struct CapturedFrame {
    sequence: u32,
    monotonic_stamp_ns: u64,
    local_stamp_ns: u64,
    data: Bytes,
}

struct UvcContext {
    ptr: *mut uvc_context,
}

impl UvcContext {
    fn new() -> Result<Self, String> {
        unsafe {
            let mut ptr = MaybeUninit::<*mut uvc_context>::uninit();
            let err = uvc_init(ptr.as_mut_ptr(), ptr::null_mut());
            if err == uvc_error_UVC_SUCCESS {
                Ok(Self {
                    ptr: ptr.assume_init(),
                })
            } else {
                Err(format!("uvc_init failed: {}", err))
            }
        }
    }
}

impl Drop for UvcContext {
    fn drop(&mut self) {
        unsafe {
            if !self.ptr.is_null() {
                uvc_exit(self.ptr);
            }
        }
    }
}

struct UvcDeviceList(*mut *mut uvc_device);

impl Drop for UvcDeviceList {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                uvc_free_device_list(self.0, 1);
            }
        }
    }
}

struct UvcDeviceDescriptor(*mut uvc_device_descriptor);

impl Drop for UvcDeviceDescriptor {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                uvc_free_device_descriptor(self.0);
            }
        }
    }
}

struct StreamHandle {
    device: *mut uvc_device,
    handle: *mut uvc_device_handle,
    ctrl: uvc_stream_ctrl_t,
    stream: *mut uvc_stream_handle,
}

impl StreamHandle {
    fn start(&mut self) -> Result<(), String> {
        unsafe {
            let mut stream = ptr::null_mut();
            let open_err = uvc_stream_open_ctrl(self.handle, &mut stream, &mut self.ctrl);
            if open_err != uvc_error_UVC_SUCCESS {
                return Err(format!("uvc_stream_open_ctrl failed: {}", open_err));
            }

            let start_err = uvc_stream_start(stream, None, ptr::null_mut(), 0);
            if start_err != uvc_error_UVC_SUCCESS {
                uvc_stream_close(stream);
                return Err(format!("uvc_stream_start failed: {}", start_err));
            }

            self.stream = stream;
            Ok(())
        }
    }

    fn read_frame(&self, timeout_us: u32) -> Result<CapturedFrame, uvc_error> {
        unsafe {
            let frame = self.next_frame(timeout_us)?;
            let f = &*frame;
            let bytes = std::slice::from_raw_parts(f.data as *const u8, f.data_bytes);
            Ok(CapturedFrame {
                sequence: f.sequence,
                monotonic_stamp_ns: f.capture_boottime_finished,
                local_stamp_ns: f.capture_realtime_finished,
                data: Bytes::copy_from_slice(bytes),
            })
        }
    }

    unsafe fn next_frame(&self, timeout_us: u32) -> Result<*mut uvc_frame, uvc_error> {
        if self.stream.is_null() {
            return Err(uvc_error_UVC_ERROR_INVALID_PARAM);
        }
        let mut frame = ptr::null_mut();
        let err = unsafe { uvc_stream_get_frame(self.stream, &mut frame, timeout_us as i32) };
        if err != uvc_error_UVC_SUCCESS {
            Err(err)
        } else if frame.is_null() {
            Err(uvc_error_UVC_ERROR_NO_MEM)
        } else {
            Ok(frame)
        }
    }
}

impl Drop for StreamHandle {
    fn drop(&mut self) {
        unsafe {
            if !self.stream.is_null() {
                uvc_stream_stop(self.stream);
                uvc_stream_close(self.stream);
            }
            if !self.handle.is_null() {
                uvc_close(self.handle);
            }
            if !self.device.is_null() {
                uvc_unref_device(self.device);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::should_keep;

    #[test]
    fn should_keep_zero_skip_keeps_every_frame() {
        assert!(should_keep(0, 0));
        assert!(should_keep(1, 0));
        assert!(should_keep(2, 0));
    }

    #[test]
    fn should_keep_skip_one_keeps_every_other_frame() {
        assert!(should_keep(0, 1));
        assert!(!should_keep(1, 1));
        assert!(should_keep(2, 1));
        assert!(!should_keep(3, 1));
    }

    #[test]
    fn should_keep_skip_two_keeps_one_of_every_three() {
        assert!(should_keep(0, 2));
        assert!(!should_keep(1, 2));
        assert!(!should_keep(2, 2));
        assert!(should_keep(3, 2));
    }
}

struct UsbContext {
    ptr: *mut usb::libusb_context,
}

impl UsbContext {
    fn new() -> Result<Self, String> {
        unsafe {
            let mut ptr = ptr::null_mut();
            let err = usb::libusb_init(&mut ptr);
            if err == 0 {
                Ok(Self { ptr })
            } else {
                Err(format!("libusb_init failed: {}", usb_error(err)))
            }
        }
    }
}

impl Drop for UsbContext {
    fn drop(&mut self) {
        unsafe {
            if !self.ptr.is_null() {
                usb::libusb_exit(self.ptr);
            }
        }
    }
}

struct UsbDeviceHandle {
    _ctx: UsbContext,
    handle: *mut usb::libusb_device_handle,
    detached: bool,
}

impl UsbDeviceHandle {
    fn open(camera: &CameraIdentity) -> Result<Self, String> {
        let ctx = UsbContext::new()?;
        unsafe {
            let mut devices: *const *mut usb::libusb_device = ptr::null();
            let count = usb::libusb_get_device_list(ctx.ptr, &mut devices);
            if count < 0 {
                return Err(format!(
                    "libusb_get_device_list failed: {}",
                    usb_error(count as i32)
                ));
            }
            if devices.is_null() {
                return Err("libusb_get_device_list returned null".to_string());
            }

            let mut open_err = 0;
            let mut handle = ptr::null_mut();
            for idx in 0..count {
                let dev = *devices.offset(idx as isize);
                if dev.is_null() {
                    continue;
                }

                let mut desc = std::mem::zeroed::<usb::libusb_device_descriptor>();
                let desc_err = usb::libusb_get_device_descriptor(dev, &mut desc);
                if desc_err != 0 {
                    continue;
                }

                if desc.idVendor as u32 == camera.vendor_id
                    && desc.idProduct as u32 == camera.product_id
                    && usb::libusb_get_bus_number(dev) as u32 == camera.bus_number
                    && usb::libusb_get_device_address(dev) as u32 == camera.device_number
                {
                    open_err = usb::libusb_open(dev, &mut handle);
                    break;
                }
            }
            usb::libusb_free_device_list(devices, 1);

            if open_err != 0 {
                return Err(format!("libusb_open failed: {}", usb_error(open_err)));
            }
            if handle.is_null() {
                return Err(format!("HIKMICRO device not found: {}", camera.unique_id));
            }

            Ok(Self {
                _ctx: ctx,
                handle,
                detached: false,
            })
        }
    }

    fn claim_interface(&mut self, iface: c_int) -> Result<(), String> {
        unsafe {
            let active = usb::libusb_kernel_driver_active(self.handle, iface);
            if active == 1 {
                let detach = usb::libusb_detach_kernel_driver(self.handle, iface);
                if detach != 0 {
                    return Err(format!(
                        "libusb_detach_kernel_driver failed: {}",
                        usb_error(detach)
                    ));
                }
                self.detached = true;
            }
            let claim = usb::libusb_claim_interface(self.handle, iface);
            if claim != 0 {
                return Err(format!(
                    "libusb_claim_interface failed: {}",
                    usb_error(claim)
                ));
            }
            Ok(())
        }
    }

    fn release_interface(&self, iface: c_int) -> Result<(), String> {
        unsafe {
            let err = usb::libusb_release_interface(self.handle, iface);
            if err == 0 {
                Ok(())
            } else {
                Err(usb_error(err))
            }
        }
    }

    fn reattach_if_needed(&mut self, iface: c_int) {
        if self.detached {
            unsafe {
                let err = usb::libusb_attach_kernel_driver(self.handle, iface);
                if err != 0 && err != usb::constants::LIBUSB_ERROR_NOT_FOUND {
                    log::warn!("libusb_attach_kernel_driver failed: {}", usb_error(err));
                }
            }
            self.detached = false;
        }
    }

    fn control_in(
        &self,
        request_type: u8,
        request: u8,
        value: u16,
        index: u16,
        len: u16,
    ) -> Result<Vec<u8>, String> {
        let mut data = vec![0u8; len as usize];
        unsafe {
            let got = usb::libusb_control_transfer(
                self.handle,
                request_type,
                request,
                value,
                index,
                data.as_mut_ptr() as *mut c_uchar,
                len,
                USB_TIMEOUT_MS,
            );
            if got < 0 {
                Err(usb_error(got))
            } else {
                data.truncate(got as usize);
                Ok(data)
            }
        }
    }

    fn control_out(
        &self,
        request_type: u8,
        request: u8,
        value: u16,
        index: u16,
        payload: &[u8],
    ) -> Result<i32, String> {
        let mut data = payload.to_vec();
        unsafe {
            let wrote = usb::libusb_control_transfer(
                self.handle,
                request_type,
                request,
                value,
                index,
                data.as_mut_ptr() as *mut c_uchar,
                data.len() as u16,
                USB_TIMEOUT_MS,
            );
            if wrote < 0 {
                Err(usb_error(wrote))
            } else {
                Ok(wrote)
            }
        }
    }

    fn device_descriptor_bytes(&self) -> Result<Vec<u8>, String> {
        unsafe {
            let dev = usb::libusb_get_device(self.handle);
            let mut desc = std::mem::zeroed::<usb::libusb_device_descriptor>();
            let err = usb::libusb_get_device_descriptor(dev, &mut desc);
            if err != 0 {
                return Err(usb_error(err));
            }
            Ok(vec![
                desc.bLength,
                desc.bDescriptorType,
                (desc.bcdUSB & 0xff) as u8,
                (desc.bcdUSB >> 8) as u8,
                desc.bDeviceClass,
                desc.bDeviceSubClass,
                desc.bDeviceProtocol,
                desc.bMaxPacketSize0,
                (desc.idVendor & 0xff) as u8,
                (desc.idVendor >> 8) as u8,
                (desc.idProduct & 0xff) as u8,
                (desc.idProduct >> 8) as u8,
                (desc.bcdDevice & 0xff) as u8,
                (desc.bcdDevice >> 8) as u8,
                desc.iManufacturer,
                desc.iProduct,
                desc.iSerialNumber,
                desc.bNumConfigurations,
            ])
        }
    }

    fn config_descriptor_bytes(&self) -> Result<Vec<Vec<u8>>, String> {
        let device_descriptor = self.device_descriptor_bytes()?;
        let num_configurations = device_descriptor
            .get(17)
            .copied()
            .ok_or_else(|| "short USB device descriptor".to_string())?;

        let mut out = Vec::new();
        for idx in 0..num_configurations {
            let header = self.control_in(0x80, 0x06, (2 << 8) | idx as u16, 0, 9)?;
            if header.len() < 9 {
                continue;
            }

            let total = u16::from_le_bytes([header[2], header[3]]);
            if total < 9 {
                continue;
            }

            let full = self.control_in(0x80, 0x06, (2 << 8) | idx as u16, 0, total)?;
            out.push(full);
        }
        Ok(out)
    }

    fn port_numbers(&self) -> Vec<u32> {
        unsafe {
            let dev = usb::libusb_get_device(self.handle);
            let mut ports = [0u8; 16];
            let got = usb::libusb_get_port_numbers(dev, ports.as_mut_ptr(), ports.len() as c_int);
            if got <= 0 {
                Vec::new()
            } else {
                ports[..got as usize].iter().map(|v| *v as u32).collect()
            }
        }
    }
}

impl Drop for UsbDeviceHandle {
    fn drop(&mut self) {
        unsafe {
            if !self.handle.is_null() {
                usb::libusb_close(self.handle);
            }
        }
    }
}

fn cstr_or_empty(ptr: *const c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() }
    }
}

fn usb_error(err: i32) -> String {
    unsafe {
        let name = usb::libusb_error_name(err);
        if name.is_null() {
            format!("LIBUSB_ERROR({})", err)
        } else {
            format!("{} ({})", CStr::from_ptr(name).to_string_lossy(), err)
        }
    }
}

fn hex_prefix(data: &[u8], max: usize) -> String {
    data.iter()
        .take(max)
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

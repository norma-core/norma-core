use crate::buffer::PixelFormat;
use libcamera_sys_static as ffi;

#[derive(Debug, Clone)]
pub struct CameraFormat {
    pub pixel_format: PixelFormat,
    pub width: u32,
    pub height: u32,
    pub estimated_fps: u32,
    pub fourcc: String,
}

impl CameraFormat {
    fn estimate_fps(width: u32, height: u32) -> u32 {
        let pixels = width.saturating_mul(height);
        match pixels {
            p if p >= 5_000_000 => 15,
            p if p >= 2_000_000 => 30,
            p if p >= 1_000_000 => 42,
            _ => 90,
        }
    }
}

pub fn enumerate_formats(stream_cfg: *mut ffi::lc_stream_configuration_t) -> Vec<CameraFormat> {
    let mut formats = Vec::new();
    if stream_cfg.is_null() {
        return formats;
    }

    unsafe {
        let stream_formats = ffi::lc_stream_configuration_formats(stream_cfg);
        if stream_formats.is_null() {
            return formats;
        }

        let format_count = ffi::lc_stream_formats_pixel_format_count(stream_formats);
        for fmt_idx in 0..format_count {
            let pixel_format = ffi::lc_stream_formats_pixel_format_at(stream_formats, fmt_idx);
            if pixel_format == ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_UNKNOWN {
                continue;
            }

            let size_count = ffi::lc_stream_formats_sizes_count(stream_formats, pixel_format);
            for size_idx in 0..size_count {
                let mut size = ffi::lc_size_t {
                    width: 0,
                    height: 0,
                };
                if ffi::lc_stream_formats_size_at(stream_formats, pixel_format, size_idx, &mut size)
                    == ffi::lc_status_t_LC_STATUS_OK
                {
                    let estimated_fps = CameraFormat::estimate_fps(size.width, size.height);
                    formats.push(CameraFormat {
                        pixel_format: PixelFormat::from_ffi(pixel_format as i32),
                        width: size.width,
                        height: size.height,
                        estimated_fps,
                        fourcc: pixel_format_to_fourcc(pixel_format).to_string(),
                    });
                }
            }

            if size_count == 0 {
                let mut range = ffi::lc_size_range_info_t {
                    min: ffi::lc_size_t {
                        width: 0,
                        height: 0,
                    },
                    max: ffi::lc_size_t {
                        width: 0,
                        height: 0,
                    },
                    hstep: 0,
                    vstep: 0,
                };
                if ffi::lc_stream_formats_range(stream_formats, pixel_format, &mut range)
                    == ffi::lc_status_t_LC_STATUS_OK
                {
                    let candidates = [range.min, range.max];
                    for size in candidates {
                        if size.width == 0 || size.height == 0 {
                            continue;
                        }
                        let estimated_fps = CameraFormat::estimate_fps(size.width, size.height);
                        formats.push(CameraFormat {
                            pixel_format: PixelFormat::from_ffi(pixel_format as i32),
                            width: size.width,
                            height: size.height,
                            estimated_fps,
                            fourcc: pixel_format_to_fourcc(pixel_format).to_string(),
                        });
                    }
                }
            }
        }

        ffi::lc_stream_formats_destroy(stream_formats);
    }

    formats
}

pub fn pixel_format_to_fourcc(fmt: ffi::lc_pixel_format_t) -> &'static str {
    match fmt {
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_RGB888 => "RGB3",
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_BGR888 => "BGR3",
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_YUYV => "YUYV",
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_YVYU => "YVYU",
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_UYVY => "UYVY",
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_NV12 => "NV12",
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_NV21 => "NV21",
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_YUV420 => "I420",
        ffi::lc_pixel_format_t_LC_PIXEL_FORMAT_MJPEG => "MJPG",
        _ => "????",
    }
}

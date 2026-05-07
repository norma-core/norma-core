use std::cell::RefCell;
use turbojpeg::{Compressor, Subsamp, YuvImage};

use crate::buffer::{FrameData, PixelFormat as OvPixelFormat};
use crate::config::Quality;
use crate::error::{Ov5647Error, Result};

pub struct JpegEncoder {
    quality: Quality,
    compressor: RefCell<Option<Compressor>>,
}

impl JpegEncoder {
    pub fn new(quality: Quality) -> Self {
        Self {
            quality,
            compressor: RefCell::new(None),
        }
    }

    pub fn encode(&self, frame: &FrameData) -> Result<Vec<u8>> {
        if frame.format == OvPixelFormat::Mjpeg {
            return Ok(frame.buffer.clone());
        }

        match frame.format {
            OvPixelFormat::Yuv420 => {
                self.encode_i420_direct(&frame.buffer, frame.width, frame.height, frame.stride)
            }
            OvPixelFormat::Nv12 => {
                self.encode_nv12_direct(&frame.buffer, frame.width, frame.height, frame.stride)
            }
            OvPixelFormat::Nv21 => {
                self.encode_nv21_direct(&frame.buffer, frame.width, frame.height, frame.stride)
            }
            _ => Err(Ov5647Error::UnsupportedFormat(frame.format)),
        }
    }

    pub fn encode_i420_direct(
        &self,
        data: &[u8],
        width: u32,
        height: u32,
        stride: u32,
    ) -> Result<Vec<u8>> {
        let width = width as usize;
        let height = height as usize;
        let stride = stride as usize;
        let y_plane_size = stride * height;
        let uv_stride = stride.div_ceil(2);
        let uv_height = height.div_ceil(2);
        let uv_plane_size = uv_stride * uv_height;
        let total_size = y_plane_size + uv_plane_size * 2;

        if data.len() < total_size {
            return Err(Ov5647Error::BufferMapFailed(format!(
                "I420 buffer too small: {} < {}",
                data.len(),
                total_size
            )));
        }

        let yuv_data: std::borrow::Cow<'_, [u8]> = if stride == width {
            std::borrow::Cow::Borrowed(&data[..total_size])
        } else {
            let packed_uv_width = width.div_ceil(2);
            let mut packed = Vec::with_capacity(width * height + packed_uv_width * uv_height * 2);

            for row in 0..height {
                let src_start = row * stride;
                packed.extend_from_slice(&data[src_start..src_start + width]);
            }

            let u_offset = y_plane_size;
            for row in 0..uv_height {
                let src_start = u_offset + row * uv_stride;
                packed.extend_from_slice(&data[src_start..src_start + packed_uv_width]);
            }

            let v_offset = y_plane_size + uv_plane_size;
            for row in 0..uv_height {
                let src_start = v_offset + row * uv_stride;
                packed.extend_from_slice(&data[src_start..src_start + packed_uv_width]);
            }

            std::borrow::Cow::Owned(packed)
        };

        self.compress_yuv(YuvImage {
            pixels: yuv_data.as_ref(),
            width,
            height,
            align: 1,
            subsamp: Subsamp::Sub2x2,
        })
        .map_err(|e| Ov5647Error::EncodingFailed(format!("Failed to encode I420 to JPEG: {e:?}")))
    }

    pub fn encode_nv12_direct(
        &self,
        data: &[u8],
        width: u32,
        height: u32,
        stride: u32,
    ) -> Result<Vec<u8>> {
        self.encode_interleaved_uv(data, width, height, stride, false, "NV12")
    }

    pub fn encode_nv21_direct(
        &self,
        data: &[u8],
        width: u32,
        height: u32,
        stride: u32,
    ) -> Result<Vec<u8>> {
        self.encode_interleaved_uv(data, width, height, stride, true, "NV21")
    }

    fn encode_interleaved_uv(
        &self,
        data: &[u8],
        width: u32,
        height: u32,
        stride: u32,
        vu_order: bool,
        format_name: &str,
    ) -> Result<Vec<u8>> {
        let width = width as usize;
        let height = height as usize;
        let stride = stride as usize;
        let y_plane_size = stride * height;
        let uv_height = height.div_ceil(2);
        let uv_plane_size = stride * uv_height;

        if data.len() < y_plane_size + uv_plane_size {
            return Err(Ov5647Error::BufferMapFailed(format!(
                "{} buffer too small: {} < {}",
                format_name,
                data.len(),
                y_plane_size + uv_plane_size
            )));
        }

        let uv_width = width.div_ceil(2);
        let y_size = width * height;
        let uv_size = uv_width * uv_height;
        let mut i420 = vec![0u8; y_size + uv_size * 2];

        for row in 0..height {
            let src_start = row * stride;
            let dst_start = row * width;
            i420[dst_start..dst_start + width].copy_from_slice(&data[src_start..src_start + width]);
        }

        let uv_src = &data[y_plane_size..];
        let u_dst_offset = y_size;
        let v_dst_offset = y_size + uv_size;

        for row in 0..uv_height {
            for col in 0..uv_width {
                let src_idx = row * stride + col * 2;
                let dst_idx = row * uv_width + col;

                if src_idx + 1 >= uv_src.len() {
                    continue;
                }

                if vu_order {
                    i420[v_dst_offset + dst_idx] = uv_src[src_idx];
                    i420[u_dst_offset + dst_idx] = uv_src[src_idx + 1];
                } else {
                    i420[u_dst_offset + dst_idx] = uv_src[src_idx];
                    i420[v_dst_offset + dst_idx] = uv_src[src_idx + 1];
                }
            }
        }

        self.compress_yuv(YuvImage {
            pixels: i420.as_slice(),
            width,
            height,
            align: 1,
            subsamp: Subsamp::Sub2x2,
        })
        .map_err(|e| {
            Ov5647Error::EncodingFailed(format!("Failed to encode {format_name} to JPEG: {e:?}"))
        })
    }

    fn compress_yuv(&self, yuv_image: YuvImage<&[u8]>) -> Result<Vec<u8>> {
        let mut compressor_guard = self.compressor.borrow_mut();

        if compressor_guard.is_none() {
            let mut compressor = Compressor::new().map_err(|e| {
                Ov5647Error::EncodingFailed(format!("Failed to create JPEG compressor: {e:?}"))
            })?;
            compressor
                .set_quality(self.quality.value() as i32)
                .map_err(|e| {
                    Ov5647Error::EncodingFailed(format!("Failed to set JPEG quality: {e:?}"))
                })?;
            *compressor_guard = Some(compressor);
        }

        compressor_guard
            .as_mut()
            .ok_or_else(|| Ov5647Error::EncodingFailed("Compressor not initialized".into()))?
            .compress_yuv_to_vec(yuv_image)
            .map_err(|e| Ov5647Error::EncodingFailed(format!("Failed to encode JPEG: {e:?}")))
    }
}

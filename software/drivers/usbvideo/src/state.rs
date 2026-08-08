use std::collections::HashMap;
use std::sync::Arc;

use bytes::{Bytes, BytesMut};
use log::{error, warn};
use parking_lot::Mutex;
use prost::Message;
use station_iface::{
    StationEngine, iface_proto::drivers::QueueDataType
};
use normfs::NormFS;

use crate::{
    converters::{self, FourCCFormat},
    usbvideo_proto::{
        frame::{self, FrameFormatKind, FrameStamp, FramesPack},
        usbvideo::{
            Camera, RxEnvelope, RxEnvelopeType
        },
    },
};

/// `frame_skip` is the number of frames dropped after each kept frame,
/// so we keep 1 of every `frame_skip + 1`. `0` keeps every frame.
fn should_keep(count: u64, frame_skip: u32) -> bool {
    count.is_multiple_of(frame_skip as u64 + 1)
}

pub struct StateTracker<T: StationEngine> {
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: crate::USBVideoConfig,
    inference_states_queue_id: normfs::QueueId,
    /// Per-camera frame counters, keyed by `Camera::unique_id`.
    /// One `StateTracker` is shared by every camera task, so a single
    /// global counter would let cameras thin each other unevenly.
    frame_counters: Mutex<HashMap<String, u64>>,
}

impl<T: StationEngine> StateTracker<T> {
    pub fn new(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        config: crate::USBVideoConfig,
    ) -> Self {
        let inference_states_queue_id = normfs.resolve("inference-states");
        Self {
            normfs,
            station_engine,
            config,
            inference_states_queue_id,
            frame_counters: Mutex::new(HashMap::new()),
        }
    }

    pub fn resolve_queue_id(&self, queue_id: &str) -> normfs::QueueId {
        self.normfs.resolve(queue_id)
    }

    pub fn formats(&self) -> &[crate::CameraFormatPreference] {
        &self.config.formats
    }

    pub async fn handle_queue_start(&self, queue_id: &normfs::QueueId) {
        let _ = self.normfs.ensure_queue_exists_for_write(queue_id).await;
        self.station_engine.register_queue(
            queue_id,
            QueueDataType::QdtUsbVideoFrames,
            vec![],
        )
    }

    pub fn send_envelope(&self, queue_id: &normfs::QueueId, envelope: RxEnvelope) -> Result<(), normfs::Error> {
        let mut buf = BytesMut::new();
        envelope.encode(&mut buf).unwrap();
        self.normfs.enqueue(queue_id, buf.freeze())?;
        Ok(())
    }

    pub fn get_last_inference_id_bytes(&self) -> Bytes {
        match self.normfs.get_last_id(&self.inference_states_queue_id) {
            Ok(id) => {
                id.value_to_bytes()
            },
            Err(e) => {
                warn!("Failed to get last inference ID: {}", e);
                Bytes::new()
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn enqueue_frame(&self,
        queue_id: &normfs::QueueId,
        format: FourCCFormat,
        camera: &Camera,
        stamp: FrameStamp,
        width: u32, height: u32,
        frame_data: Bytes,
    ) {
        let count = {
            let mut counters = self.frame_counters.lock();
            match counters.get_mut(&camera.unique_id) {
                Some(counter) => {
                    let current = *counter;
                    *counter = counter.wrapping_add(1);
                    current
                }
                None => {
                    counters.insert(camera.unique_id.clone(), 1);
                    0
                }
            }
        };

        if !should_keep(count, self.config.frame_skip) {
            return;
        }

        let converted = converters::convert_frame(
            width as u16,
            height as u16,
            format,
            frame_data,
            self.config.resize_target,
        );

        let converted = match converted {
            Ok(c) => c,
            Err(e) => {
                warn!("Failed to convert frame for camera {}: {}", camera.unique_id, e);
                return;
            }
        };

        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtFrames as i32,
            camera: Some(camera.clone()),
            frames: Some(FramesPack {
                format: Some(frame::FrameFormat {
                    width: converted.width,
                    height: converted.height,
                    kind: FrameFormatKind::FfJpeg as i32,
                }),
                linear_data: Bytes::new(),
                frames_data: vec![converted.jpeg.clone()],
                stamps: vec![stamp.clone()],
            }),
            stamp: Some(stamp.clone()),
            formats: vec![],
            last_inference_queue_ptr: self.get_last_inference_id_bytes(),
            error: String::new(),
        };

        let mut buf = BytesMut::new();
        envelope.encode(&mut buf).unwrap();
        if let Err(e) = self.normfs.enqueue(queue_id, buf.freeze()) {
            error!("Failed to enqueue envelope for camera {}: {}", camera.unique_id, e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::should_keep;

    #[test]
    fn test_should_keep_zero_skip_keeps_every_frame() {
        for count in 0..10 {
            assert!(should_keep(count, 0), "frame {} should be kept", count);
        }
    }

    #[test]
    fn test_should_keep_skip_one_keeps_every_other_frame() {
        let kept: Vec<u64> = (0..7).filter(|c| should_keep(*c, 1)).collect();
        assert_eq!(kept, vec![0, 2, 4, 6]);
    }

    #[test]
    fn test_should_keep_skip_two_keeps_one_of_every_three() {
        let kept: Vec<u64> = (0..10).filter(|c| should_keep(*c, 2)).collect();
        assert_eq!(kept, vec![0, 3, 6, 9]);
    }
}

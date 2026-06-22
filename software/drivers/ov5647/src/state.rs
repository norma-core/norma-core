use bytes::{Bytes, BytesMut};
use prost::Message;
use std::sync::Arc;

use normfs::{NormFS, UintN};
use station_iface::{StationEngine, iface_proto::drivers::QueueDataType};
use usbvideo::usbvideo_proto::{
    frame::{FrameFormat, FrameFormatKind, FrameStamp, FramesPack},
    usbvideo::{Camera, CameraFormat, RxEnvelope, RxEnvelopeType},
};

pub(crate) struct StateTracker<K: StationEngine> {
    engine: Arc<K>,
    normfs: Arc<NormFS>,
    queue_id: normfs::QueueId,
    inference_states_queue_id: normfs::QueueId,
    camera: arc_swap::ArcSwap<Option<Camera>>,
    format: arc_swap::ArcSwap<Option<CameraFormat>>,
    recording: std::sync::atomic::AtomicBool,
    frames_captured: std::sync::atomic::AtomicU64,
    frames_dropped: std::sync::atomic::AtomicU64,
}

impl<K: StationEngine> StateTracker<K> {
    pub(crate) fn new(engine: Arc<K>, normfs: Arc<NormFS>, queue_id: String) -> Self {
        let resolved_queue_id = normfs.resolve(&queue_id);
        let inference_states_queue_id = normfs.resolve("inference-states");
        Self {
            engine,
            normfs,
            queue_id: resolved_queue_id,
            inference_states_queue_id,
            camera: arc_swap::ArcSwap::new(Arc::new(None)),
            format: arc_swap::ArcSwap::new(Arc::new(None)),
            recording: std::sync::atomic::AtomicBool::new(false),
            frames_captured: std::sync::atomic::AtomicU64::new(0),
            frames_dropped: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub(crate) async fn start_queue(&self) {
        let _ = self
            .normfs
            .ensure_queue_exists_for_write(&self.queue_id)
            .await;
        self.engine
            .register_queue(&self.queue_id, QueueDataType::QdtUsbVideoFrames, vec![]);
    }

    pub(crate) fn enqueue_frame(
        &self,
        camera: &Camera,
        stamp: FrameStamp,
        width: u32,
        height: u32,
        jpeg_data: Bytes,
    ) -> bool {
        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtFrames as i32,
            camera: Some(camera.clone()),
            frames: Some(FramesPack {
                format: Some(FrameFormat {
                    width,
                    height,
                    kind: FrameFormatKind::FfJpeg as i32,
                }),
                linear_data: Bytes::new(),
                frames_data: vec![jpeg_data],
                stamps: vec![stamp.clone()],
            }),
            stamp: Some(stamp),
            formats: vec![],
            last_inference_queue_ptr: self.get_last_inference_id_bytes(),
            error: String::new(),
        };

        let mut buf = BytesMut::new();
        if envelope.encode(&mut buf).is_err() {
            log::error!("OV5647 failed to encode frame envelope");
            self.frames_dropped
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            return false;
        }

        match self.normfs.enqueue(&self.queue_id, buf.freeze()) {
            Ok(_) => {
                self.frames_captured
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                true
            }
            Err(e) => {
                log::error!("OV5647 failed to enqueue frame: {}", e);
                self.frames_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                false
            }
        }
    }

    pub(crate) fn enqueue_device_connected(&self, camera: &Camera, formats: Vec<CameraFormat>) {
        self.camera.store(Arc::new(Some(camera.clone())));
        if let Some(format) = formats.first() {
            self.format.store(Arc::new(Some(format.clone())));
        }

        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtDeviceConnected as i32,
            camera: Some(camera.clone()),
            formats,
            stamp: Some(FrameStamp {
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
            ..Default::default()
        };

        let _ = self.send_envelope(&envelope);
    }

    pub(crate) fn enqueue_device_disconnected(&self, camera: &Camera) {
        self.camera.store(Arc::new(None));
        self.format.store(Arc::new(None));
        self.recording
            .store(false, std::sync::atomic::Ordering::Relaxed);

        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtDeviceDisconnected as i32,
            camera: Some(camera.clone()),
            stamp: Some(FrameStamp {
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
            ..Default::default()
        };

        let _ = self.send_envelope(&envelope);
    }

    pub(crate) fn enqueue_recording_start(&self, camera: &Camera, format: &CameraFormat) {
        self.recording
            .store(true, std::sync::atomic::Ordering::Relaxed);
        self.format.store(Arc::new(Some(format.clone())));

        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtDeviceRecordingStart as i32,
            camera: Some(camera.clone()),
            formats: vec![format.clone()],
            stamp: Some(FrameStamp {
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
            ..Default::default()
        };

        let _ = self.send_envelope(&envelope);
    }

    pub(crate) fn enqueue_recording_end(&self, camera: &Camera) {
        self.recording
            .store(false, std::sync::atomic::Ordering::Relaxed);

        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtDeviceRecordingEnd as i32,
            camera: Some(camera.clone()),
            stamp: Some(FrameStamp {
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
            ..Default::default()
        };

        let _ = self.send_envelope(&envelope);
    }

    pub(crate) fn enqueue_error(&self, camera: &Camera, error: String) {
        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtError as i32,
            camera: Some(camera.clone()),
            error,
            stamp: Some(FrameStamp {
                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                local_stamp_ns: systime::get_local_stamp_ns(),
                app_start_id: systime::get_app_start_id(),
                index: 0,
            }),
            ..Default::default()
        };

        let _ = self.send_envelope(&envelope);
    }

    fn send_envelope(&self, envelope: &RxEnvelope) -> Result<UintN, String> {
        let mut buf = BytesMut::new();
        envelope.encode(&mut buf).map_err(|e| e.to_string())?;

        self.normfs
            .enqueue(&self.queue_id, buf.freeze())
            .map_err(|e| e.to_string())
    }

    fn get_last_inference_id_bytes(&self) -> Bytes {
        match self.normfs.get_last_id(&self.inference_states_queue_id) {
            Ok(id) => id.value_to_bytes(),
            Err(_) => Bytes::new(),
        }
    }
}

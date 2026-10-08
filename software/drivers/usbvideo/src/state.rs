use std::collections::HashMap;
use std::sync::Arc;

use bytes::{Bytes, BytesMut};
use log::{error, warn};
use normfs::NormFS;
use parking_lot::Mutex;
use prost::Message;
use station_iface::{Backpressure, enqueue_with};
use station_iface::{StationEngine, iface_proto::drivers::QueueDataType};

use crate::{
    codec::{KeyframePolicy, VideoCodec, VideoEncoder, Vp8Encoder},
    converters::{self, FourCCFormat},
    usbvideo_proto::{
        frame::{self, FrameFormatKind, FrameStamp, FramesPack},
        usbvideo::{Camera, CameraFormat, RxEnvelope, RxEnvelopeType},
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
    format_control: Mutex<FormatControlState>,
    camera_formats: Mutex<HashMap<String, Vec<CameraFormat>>>,
    /// Per camera, so cameras encode in parallel; the inner lock also keeps
    /// each camera's encode and enqueue order the same.
    encoders: Mutex<HashMap<String, Arc<Mutex<Option<CameraEncoder>>>>>,
}

struct CameraEncoder {
    encoder: Box<dyn VideoEncoder>,
    format_revision: u64,
    policy: KeyframePolicy,
}

#[derive(Default)]
struct FormatControlState {
    modes: HashMap<String, FormatControlMode>,
    revisions: HashMap<String, u64>,
}

#[derive(Clone)]
pub enum FormatControlMode {
    Auto,
    Manual(CameraFormat),
    None,
}

impl<T: StationEngine> StateTracker<T> {
    pub fn new(normfs: Arc<NormFS>, station_engine: Arc<T>, config: crate::USBVideoConfig) -> Self {
        let inference_states_queue_id = normfs.resolve("inference-states");
        Self {
            normfs,
            station_engine,
            config,
            inference_states_queue_id,
            frame_counters: Mutex::new(HashMap::new()),
            format_control: Mutex::new(FormatControlState::default()),
            camera_formats: Mutex::new(HashMap::new()),
            encoders: Mutex::new(HashMap::new()),
        }
    }

    pub fn resolve_queue_id(&self, queue_id: &str) -> normfs::QueueId {
        self.normfs.resolve(queue_id)
    }

    pub fn formats(&self) -> &[crate::CameraFormatPreference] {
        &self.config.formats
    }

    pub fn format_control_snapshot(&self, camera_unique_id: &str) -> (FormatControlMode, u64) {
        let state = self.format_control.lock();
        (
            state
                .modes
                .get(camera_unique_id)
                .cloned()
                .unwrap_or(FormatControlMode::Auto),
            *state.revisions.get(camera_unique_id).unwrap_or(&0),
        )
    }

    pub fn format_revision(&self, camera_unique_id: &str) -> u64 {
        *self
            .format_control
            .lock()
            .revisions
            .get(camera_unique_id)
            .unwrap_or(&0)
    }

    pub fn set_manual_format(&self, camera_unique_id: String, format: CameraFormat) -> u64 {
        let mut state = self.format_control.lock();
        state
            .modes
            .insert(camera_unique_id.clone(), FormatControlMode::Manual(format));
        bump_format_revision(&mut state, &camera_unique_id)
    }

    pub fn set_auto_format(&self, camera_unique_id: &str) -> u64 {
        let mut state = self.format_control.lock();
        state.modes.remove(camera_unique_id);
        bump_format_revision(&mut state, camera_unique_id)
    }

    pub fn set_none_format(&self, camera_unique_id: String) -> u64 {
        let mut state = self.format_control.lock();
        state
            .modes
            .insert(camera_unique_id.clone(), FormatControlMode::None);
        bump_format_revision(&mut state, &camera_unique_id)
    }

    pub fn set_camera_formats(&self, camera_unique_id: String, formats: Vec<CameraFormat>) {
        self.camera_formats.lock().insert(camera_unique_id, formats);
    }

    pub fn camera_formats(&self, camera_unique_id: &str) -> Vec<CameraFormat> {
        self.camera_formats
            .lock()
            .get(camera_unique_id)
            .cloned()
            .unwrap_or_default()
    }

    pub async fn handle_queue_start(&self, queue_id: &normfs::QueueId) {
        if let Err(e) = self.normfs.ensure_queue_exists_for_write(queue_id).await {
            error!("Failed to start USB video queue {}: {}", queue_id, e);
            return;
        }
        self.station_engine
            .register_queue(queue_id, QueueDataType::QdtUsbVideoFrames, vec![])
    }

    pub async fn handle_queue_end(&self, queue_id: &normfs::QueueId) {
        if let Err(e) = self.normfs.close_queue(queue_id).await {
            error!("Failed to close USB video queue {}: {}", queue_id, e);
        }
    }

    pub async fn send_envelope(
        &self,
        queue_id: &normfs::QueueId,
        envelope: RxEnvelope,
    ) -> Result<(), normfs::Error> {
        let mut buf = BytesMut::new();
        envelope.encode(&mut buf).unwrap();
        enqueue_with(&self.normfs, queue_id, buf.freeze(), Backpressure::Keep).await
    }

    pub fn get_last_inference_id_bytes(&self) -> Bytes {
        match self.normfs.get_last_id(&self.inference_states_queue_id) {
            Ok(id) => id.value_to_bytes(),
            Err(e) => {
                warn!("Failed to get last inference ID: {}", e);
                Bytes::new()
            }
        }
    }

    /// A new capture session starts a new chain with its first frame.
    pub fn reset_encoder(&self, camera_unique_id: &str) {
        if let Some(state) = self.encoders.lock().get(camera_unique_id) {
            *state.lock() = None;
        }
    }

    fn encoder_for(&self, camera_unique_id: &str) -> Arc<Mutex<Option<CameraEncoder>>> {
        self.encoders
            .lock()
            .entry(camera_unique_id.to_string())
            .or_default()
            .clone()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn enqueue_frame(
        &self,
        queue_id: &normfs::QueueId,
        format: FourCCFormat,
        camera: &Camera,
        stamp: FrameStamp,
        format_revision: u64,
        width: u32,
        height: u32,
        frame_data: Bytes,
    ) {
        if self.format_revision(&camera.unique_id) != format_revision {
            return;
        }

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

        if self.config.codec == VideoCodec::Vp8 {
            self.enqueue_vp8_frame(
                queue_id,
                format,
                camera,
                stamp,
                format_revision,
                width,
                height,
                frame_data,
            );
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
                warn!(
                    "Failed to convert frame for camera {}: {}",
                    camera.unique_id, e
                );
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
                ..Default::default()
            }),
            stamp: Some(stamp.clone()),
            formats: self.camera_formats(&camera.unique_id),
            last_inference_queue_ptr: self.get_last_inference_id_bytes(),
            error: String::new(),
            command: None,
        };

        let mut buf = BytesMut::new();
        envelope.encode(&mut buf).unwrap();
        // Runs on the capture thread; must not block.
        if let Err(e) = self.normfs.try_enqueue(queue_id, buf.freeze())
            && !matches!(e, normfs::Error::WouldBlock)
        {
            error!(
                "Failed to enqueue envelope for camera {}: {}",
                camera.unique_id, e
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn enqueue_vp8_frame(
        &self,
        queue_id: &normfs::QueueId,
        format: FourCCFormat,
        camera: &Camera,
        stamp: FrameStamp,
        format_revision: u64,
        width: u32,
        height: u32,
        frame_data: Bytes,
    ) {
        let frame = match converters::convert_frame_to_rgb(
            width as u16,
            height as u16,
            format,
            frame_data,
            self.config.resize_target,
        ) {
            Ok(frame) => frame,
            Err(e) => {
                // Nothing reached the encoder, so its chain is intact.
                warn!(
                    "Failed to convert frame for camera {}: {}",
                    camera.unique_id, e
                );
                return;
            }
        };
        let (width, height, rgb) = even_crop(frame.width, frame.height, &frame.rgb);

        let state = self.encoder_for(&camera.unique_id);
        let mut state = state.lock();
        let stale = state.as_ref().is_none_or(|s| {
            s.format_revision != format_revision
                || s.encoder.width() != width
                || s.encoder.height() != height
        });
        if stale {
            *state = match Vp8Encoder::new(width, height) {
                Ok(encoder) => Some(CameraEncoder {
                    encoder: Box::new(encoder),
                    format_revision,
                    policy: KeyframePolicy::default(),
                }),
                Err(e) => {
                    error!("VP8 encoder for camera {}: {}", camera.unique_id, e);
                    return;
                }
            };
        }
        let Some(cam) = state.as_mut() else {
            return;
        };

        let now_ns = stamp.monotonic_stamp_ns;
        let mut force = cam.policy.wants_keyframe(now_ns);
        let (keyframe, data, room) = loop {
            let packet = match cam.encoder.encode(&rgb, force) {
                Ok(p) if p.keyframe || cam.policy.keyframe().is_some() => p,
                Ok(_) => {
                    error!(
                        "VP8 encoder for camera {} ignored a forced keyframe",
                        camera.unique_id
                    );
                    *state = None;
                    return;
                }
                Err(e) => {
                    error!("VP8 encode for camera {}: {}", camera.unique_id, e);
                    *state = None;
                    return;
                }
            };
            let keyframe = packet.keyframe;
            let data = self.vp8_envelope(
                camera,
                &stamp,
                width,
                height,
                Bytes::from(packet.data),
                cam.policy.keyframe().filter(|_| !keyframe),
            );
            if keyframe || force {
                break (keyframe, data, None);
            }
            // A delta that would open a NormFS file is encoded again as a
            // keyframe, so every file decodes on its own.
            match self.normfs.file_room(queue_id) {
                Ok(room) if room.starts_file(data.len()) => force = true,
                room => break (keyframe, data, room.ok()),
            }
        };

        // Runs on the capture thread; must not block.
        match self.normfs.try_enqueue(queue_id, data) {
            Ok(id) => match id.to_u64() {
                Ok(id) => {
                    cam.policy.landed(id, keyframe, now_ns);
                    // A flush between the look and the write opened a file
                    // with this delta; the next frame starts the chain over.
                    if let Some(room) = room
                        && self
                            .normfs
                            .file_room(queue_id)
                            .is_ok_and(|after| !room.same_file(&after))
                    {
                        cam.policy.lost();
                    }
                }
                Err(_) => cam.policy.lost(),
            },
            Err(e) => {
                cam.policy.lost();
                if !matches!(e, normfs::Error::WouldBlock) {
                    log::error!("Failed to enqueue frame on {queue_id}: {e}");
                }
            }
        }
    }

    fn vp8_envelope(
        &self,
        camera: &Camera,
        stamp: &FrameStamp,
        width: u32,
        height: u32,
        frame: Bytes,
        chain: Option<u64>,
    ) -> Bytes {
        // A delta names its chain's keyframe; a keyframe names none.
        let keyframe = chain.is_none();
        let keyframe_ptr = chain
            .map(|k| normfs::UintN::from(k).value_to_bytes())
            .unwrap_or_default();
        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtFrames as i32,
            camera: Some(camera.clone()),
            frames: Some(FramesPack {
                format: Some(frame::FrameFormat {
                    width,
                    height,
                    kind: FrameFormatKind::FfVp8 as i32,
                }),
                linear_data: Bytes::new(),
                frames_data: vec![frame],
                stamps: vec![stamp.clone()],
                keyframe,
                keyframe_ptr,
            }),
            stamp: Some(stamp.clone()),
            formats: self.camera_formats(&camera.unique_id),
            last_inference_queue_ptr: self.get_last_inference_id_bytes(),
            error: String::new(),
            command: None,
        };
        let mut buf = BytesMut::new();
        envelope.encode(&mut buf).unwrap();
        buf.freeze()
    }
}

/// VP8 halves chroma both ways, so an odd edge loses its last row or column.
fn even_crop(width: u32, height: u32, rgb: &Bytes) -> (u32, u32, Bytes) {
    let (w, h) = (width & !1, height & !1);
    if (w, h) == (width, height) {
        return (width, height, rgb.clone());
    }
    let mut out = Vec::with_capacity((w * h * 3) as usize);
    for row in 0..h as usize {
        let start = row * width as usize * 3;
        out.extend_from_slice(&rgb[start..start + w as usize * 3]);
    }
    (w, h, Bytes::from(out))
}

fn bump_format_revision(state: &mut FormatControlState, camera_unique_id: &str) -> u64 {
    let revision = state
        .revisions
        .entry(camera_unique_id.to_string())
        .or_insert(0);
    *revision = revision.wrapping_add(1);
    *revision
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::test_frames::{camera_like, psnr};
    use crate::codec::{FrameReader, VideoDecoder, Vp8Decoder, keyframe_of};
    use normfs::{NormFsSettings, Persist, QueueSettings, ReadPosition, UintN};

    struct NoopEngine;

    impl StationEngine for NoopEngine {
        fn register_queue(
            &self,
            _: &normfs::QueueId,
            _: QueueDataType,
            _: Vec<station_iface::iface_proto::envelope::QueueOpt>,
        ) {
        }
    }

    const W: u32 = 96;
    const H: u32 = 64;

    fn test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("usbvideo-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Frames as station keeps them: store files, no WAL. Small pages make a
    /// chain span several files.
    fn store_settings() -> NormFsSettings {
        NormFsSettings {
            queue_settings: QueueSettings::default().with_default_persist(Persist::STORE),
            mem_page_size: 4 * 1024,
            mem_passive_page_size: 4 * 1024,
            ..Default::default()
        }
    }

    async fn vp8_tracker(name: &str) -> (Arc<NormFS>, StateTracker<NoopEngine>, normfs::QueueId) {
        let settings = NormFsSettings {
            queue_settings: QueueSettings::default().with_default_persist(Persist::MEMORY),
            ..Default::default()
        };
        vp8_tracker_in(test_dir(name), settings).await
    }

    async fn vp8_tracker_in(
        dir: std::path::PathBuf,
        settings: NormFsSettings,
    ) -> (Arc<NormFS>, StateTracker<NoopEngine>, normfs::QueueId) {
        let normfs = Arc::new(NormFS::new(dir, settings).await.unwrap());
        let queue = normfs.resolve("usbvideo/test");
        normfs.ensure_queue_exists_for_write(&queue).await.unwrap();
        let tracker = StateTracker::new(
            normfs.clone(),
            Arc::new(NoopEngine),
            crate::USBVideoConfig {
                resize_target: 0,
                frame_skip: 2,
                codec: VideoCodec::Vp8,
                ..Default::default()
            },
        );
        (normfs, tracker, queue)
    }

    fn camera() -> Camera {
        Camera {
            unique_id: "cam".into(),
            ..Default::default()
        }
    }

    /// Frame `t` of a 30 fps camera.
    fn feed(tracker: &StateTracker<NoopEngine>, queue: &normfs::QueueId, t: u64, revision: u64) {
        tracker.enqueue_frame(
            queue,
            FourCCFormat::Rgb,
            &camera(),
            FrameStamp {
                monotonic_stamp_ns: 1_000_000_000 + t * 33_333_333,
                index: t,
                ..Default::default()
            },
            revision,
            W,
            H,
            Bytes::from(camera_like(W as usize, H as usize, t as usize)),
        );
    }

    async fn read_all(normfs: &NormFS, queue: &normfs::QueueId) -> Vec<(u64, RxEnvelope)> {
        let last = normfs.get_last_id(queue).unwrap().to_u64().unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel(last as usize + 2);
        normfs
            .read(
                queue,
                ReadPosition::Absolute(UintN::from(0u64)),
                last + 1,
                1,
                tx,
            )
            .await
            .unwrap();
        let mut out = Vec::new();
        while let Some(e) = rx.recv().await {
            out.push((e.id.to_u64().unwrap(), RxEnvelope::decode(e.data).unwrap()));
        }
        out
    }

    fn is_vp8(envelope: &RxEnvelope) -> bool {
        envelope
            .frames
            .as_ref()
            .and_then(|p| p.format.as_ref())
            .map(|f| f.kind())
            == Some(FrameFormatKind::FfVp8)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn every_frame_by_its_entry_id_is_that_frame() {
        let (normfs, tracker, queue) = vp8_tracker("random-access").await;
        let mut revision = tracker.format_revision("cam");
        for t in 0..240u64 {
            // Session events land between frames of one chain.
            if t % 50 == 7 {
                tracker
                    .send_envelope(
                        &queue,
                        RxEnvelope {
                            r#type: RxEnvelopeType::EtDeviceRecordingStart as i32,
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
            }
            // A format change mid-stream starts a new chain.
            if t == 120 {
                revision = tracker.set_auto_format("cam");
            }
            feed(&tracker, &queue, t, revision);
        }
        let entries = read_all(&normfs, &queue).await;
        let frames: Vec<&(u64, RxEnvelope)> = entries.iter().filter(|(_, e)| is_vp8(e)).collect();
        assert_eq!(frames.len(), 80, "frame_skip 2 keeps 1 of 3");

        // Sequential decode of the whole queue, as a player would.
        let mut sequential = HashMap::new();
        let mut decoder = Vp8Decoder::new().unwrap();
        for (id, envelope) in &frames {
            let pack = envelope.frames.as_ref().unwrap();
            let out = decoder.decode(&pack.frames_data[0]).unwrap();
            sequential.insert(*id, out);
        }
        // Kept frames are 100 ms apart, so a chain is 11 of them; the format
        // change at frame 120 starts one early.
        let keyframes: Vec<u64> = frames
            .iter()
            .filter(|(_, e)| e.frames.as_ref().unwrap().keyframe)
            .map(|(_, e)| e.stamp.as_ref().unwrap().index)
            .collect();
        assert_eq!(keyframes, [0, 33, 66, 99, 120, 153, 186, 219]);

        let reader = FrameReader::new(normfs.clone());
        let mut order: Vec<_> = frames.iter().map(|(id, _)| *id).collect();
        // A fixed shuffle: jumps back, forward and across chains.
        order.sort_by_key(|id| (id * 7919) % 101);
        for id in order {
            let (_, envelope) = frames.iter().find(|(i, _)| *i == id).unwrap();
            let fresh = FrameReader::new(normfs.clone())
                .frame_at(&queue, id, envelope)
                .await
                .unwrap();
            let cached = reader.frame_at(&queue, id, envelope).await.unwrap();
            assert_eq!(fresh, sequential[&id], "entry {id} by pointer");
            assert_eq!(cached, sequential[&id], "entry {id} through the cache");

            // And it is the frame whose stamp the entry carries, not a neighbour.
            let t = envelope.stamp.as_ref().unwrap().index as usize;
            let own = psnr(&camera_like(W as usize, H as usize, t), &fresh.rgb);
            let next = psnr(&camera_like(W as usize, H as usize, t + 3), &fresh.rgb);
            assert!(
                own > 25.0 && own > next + 1.0,
                "entry {id}: {own} vs {next}"
            );
            assert!(keyframe_of(id, envelope).is_ok());
        }
    }

    fn store_files(dir: &std::path::Path, queue: &normfs::QueueId) -> usize {
        std::fs::read_dir(queue.to_store_dir(dir))
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "store"))
            .count()
    }

    /// Every stored frame by its id, read back from store files after a
    /// restart, against a sequential decode; returns the keyframes' stamps.
    async fn check_by_id_from_store(dir: std::path::PathBuf) -> Vec<u64> {
        let normfs = Arc::new(NormFS::new(dir, store_settings()).await.unwrap());
        let queue = normfs.resolve("usbvideo/test");
        normfs.ensure_queue_exists_for_read(&queue).await.unwrap();
        let entries = read_all(&normfs, &queue).await;
        let frames: Vec<&(u64, RxEnvelope)> = entries.iter().filter(|(_, e)| is_vp8(e)).collect();
        let mut decoder = Vp8Decoder::new().unwrap();
        let mut keyframes = Vec::new();
        for (id, envelope) in &frames {
            let pack = envelope.frames.as_ref().unwrap();
            if pack.keyframe {
                decoder = Vp8Decoder::new().unwrap();
                keyframes.push(envelope.stamp.as_ref().unwrap().index);
            }
            let sequential = decoder.decode(&pack.frames_data[0]).unwrap();
            let by_id = FrameReader::new(normfs.clone())
                .frame_at(&queue, *id, envelope)
                .await
                .unwrap();
            assert_eq!(by_id, sequential, "entry {id}");
        }
        normfs.close().await.unwrap();
        keyframes
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn frames_in_store_files_decode_by_id_after_a_restart() {
        let dir = test_dir("store");
        let (normfs, tracker, queue) = vp8_tracker_in(dir.clone(), store_settings()).await;
        let revision = tracker.format_revision("cam");
        let mut opened = Vec::new();
        for t in 0..120 {
            let (before, last) = (
                normfs.file_room(&queue).unwrap(),
                normfs.get_last_id(&queue).ok(),
            );
            feed(&tracker, &queue, t, revision);
            let id = normfs.get_last_id(&queue).ok();
            let after = normfs.file_room(&queue).unwrap();
            if id != last && (before.room().is_none() || !before.same_file(&after)) {
                opened.push(t);
            }
        }
        normfs.close().await.unwrap();
        drop(tracker);
        let keyframes = check_by_id_from_store(dir.clone()).await;
        assert!(store_files(&dir, &queue) > 1);
        assert_eq!(opened.len(), store_files(&dir, &queue));
        for t in opened {
            assert!(keyframes.contains(&t), "frame {t} opens a file as a delta");
        }
        // frame_skip 2 keeps every third frame, 100 ms apart: a keyframe per 10
        // at most, sooner where a file starts.
        assert_eq!(keyframes[0], 0);
        assert!(
            keyframes.windows(2).all(|k| k[1] - k[0] <= 33),
            "{keyframes:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_refused_frame_starts_a_new_chain() {
        let dir = test_dir("refused");
        let (normfs, tracker, queue) = vp8_tracker_in(dir.clone(), store_settings()).await;
        let revision = tracker.format_revision("cam");
        for t in 0..15 {
            feed(&tracker, &queue, t, revision);
        }
        // A closed queue refuses the next frame, as a full one skips it.
        normfs.close_queue(&queue).await.unwrap();
        feed(&tracker, &queue, 15, revision);
        normfs.ensure_queue_exists_for_write(&queue).await.unwrap();
        for t in 16..30 {
            feed(&tracker, &queue, t, revision);
        }
        normfs.close().await.unwrap();
        drop(tracker);
        // Frame 15 is lost; the next kept one, 18, has to be a keyframe.
        assert_eq!(check_by_id_from_store(dir).await, [0, 18]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_new_session_starts_a_new_chain() {
        let (normfs, tracker, queue) = vp8_tracker("session").await;
        let revision = tracker.format_revision("cam");
        for t in 0..9 {
            feed(&tracker, &queue, t, revision);
        }
        tracker.reset_encoder("cam");
        for t in 9..12 {
            feed(&tracker, &queue, t, revision);
        }
        let keyframes: Vec<bool> = read_all(&normfs, &queue)
            .await
            .iter()
            .filter(|(_, e)| is_vp8(e))
            .map(|(_, e)| e.frames.as_ref().unwrap().keyframe)
            .collect();
        assert_eq!(keyframes, [true, false, false, true]);
    }

    #[test]
    fn odd_sizes_are_cropped_to_even() {
        let rgb = Bytes::from((0..5 * 3 * 3).map(|v| v as u8).collect::<Vec<_>>());
        let (w, h, out) = even_crop(5, 3, &rgb);
        assert_eq!((w, h), (4, 2));
        assert_eq!(&out[..12], &rgb[..12]);
        assert_eq!(&out[12..], &rgb[15..27]);
    }

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

use std::{
    collections::HashSet,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use bytes::BytesMut;
use log::{info, warn};
use normfs::NormFS;
use prost::Message;
use station_iface::{
    StationEngine, WRITE_TIMEOUT, enqueue_waiting, iface_proto::drivers::QueueDataType,
};
use tokio::task::{JoinHandle, JoinSet};

pub mod hikmicro_proto {
    pub mod hikmicro {
        include!("proto/hikmicro.rs");
    }
}

#[cfg(target_os = "linux")]
mod linux;

pub const DEFAULT_QUEUE_PREFIX: &str = "hikmicro-thermal";
pub const SENSOR_WIDTH: u32 = 256;
pub const SENSOR_HEIGHT: u32 = 192;
pub const COMPACT_UVC_WIDTH: u32 = 256;
pub const COMPACT_UVC_HEIGHT: u32 = 196;
pub const COMPACT_FPS: f32 = 25.0;
pub const FOURCC_YUY2: u32 = u32::from_be_bytes(*b"YUY2");
pub const THERMAL_Y16_LEN: usize = SENSOR_WIDTH as usize * SENSOR_HEIGHT as usize * 2;
pub const RUNTIME_BLOCK_LEN: usize = 2048;
pub const COMPACT_PAYLOAD_LEN: usize = THERMAL_Y16_LEN + RUNTIME_BLOCK_LEN;
const DISCOVERY_POLL_INTERVAL: Duration = Duration::from_secs(1);
const CAPTURE_STOP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct HikmicroThermalConfig {
    pub frame_timeout: Duration,
    /// Drop this many frames after each frame that is kept. `0` keeps every frame.
    pub frame_skip: u32,
}

impl Default for HikmicroThermalConfig {
    fn default() -> Self {
        Self {
            frame_timeout: Duration::from_secs(5),
            frame_skip: 0,
        }
    }
}

pub struct HikmicroThermalHandle {
    stop: Arc<AtomicBool>,
    worker: JoinHandle<()>,
}

impl HikmicroThermalHandle {
    pub async fn stop(self) {
        self.stop.store(true, Ordering::Release);
        if let Err(e) = self.worker.await {
            warn!(
                "HIKMICRO thermal manager task failed during shutdown: {}",
                e
            );
        }
    }
}

pub async fn start_hikmicro_thermal<T: StationEngine + Send + Sync + 'static>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: HikmicroThermalConfig,
) -> Result<HikmicroThermalHandle, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();

    let worker = tokio::spawn(async move {
        run_manager(normfs, station_engine, worker_stop, config).await;
    });

    Ok(HikmicroThermalHandle { stop, worker })
}

async fn run_manager<T: StationEngine + Send + Sync + 'static>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    stop: Arc<AtomicBool>,
    config: HikmicroThermalConfig,
) {
    let running = Arc::new(Mutex::new(HashSet::<String>::new()));
    let mut captures = JoinSet::new();

    loop {
        while let Some(result) = captures.try_join_next() {
            if let Err(e) = result {
                warn!("HIKMICRO capture task failed to join: {}", e);
            }
        }

        if stop.load(Ordering::Acquire) {
            break;
        }

        #[cfg(target_os = "linux")]
        match linux::discover_cameras() {
            Ok(cameras) => {
                for camera in cameras {
                    {
                        let mut running = running.lock().unwrap();
                        if !running.insert(camera.unique_id.clone()) {
                            continue;
                        }
                    }

                    let queue_id_str = queue_id_for_camera(DEFAULT_QUEUE_PREFIX, &camera);
                    let queue_id = normfs.resolve(&queue_id_str);
                    if let Err(e) = normfs.ensure_queue_exists_for_write(&queue_id).await {
                        warn!("Failed to create HIKMICRO queue {}: {}", queue_id, e);
                        running.lock().unwrap().remove(&camera.unique_id);
                        continue;
                    }
                    let sink = Sink {
                        normfs: normfs.clone(),
                        queue_id: queue_id.clone(),
                        runtime: tokio::runtime::Handle::current(),
                    };
                    station_engine.register_queue(
                        &queue_id,
                        QueueDataType::QdtHikmicroThermal,
                        vec![],
                    );

                    let sink_capture = sink;
                    let stop_capture = stop.clone();
                    let running_capture = running.clone();
                    let close_normfs = normfs.clone();
                    let close_queue_id = queue_id.clone();
                    let unique_id = camera.unique_id.clone();
                    let timeout = config.frame_timeout;
                    let frame_skip = config.frame_skip;

                    captures.spawn(async move {
                        let result = run_camera_capture(
                            camera,
                            sink_capture,
                            stop_capture,
                            timeout,
                            frame_skip,
                        )
                        .await;
                        if let Err(e) = result {
                            warn!(
                                "HIKMICRO capture {} ended with error: {}; reconnect will be attempted",
                                unique_id, e
                            );
                        } else {
                            info!("HIKMICRO capture {} stopped", unique_id);
                        }
                        if let Err(e) = close_normfs.close_queue(&close_queue_id).await {
                            warn!("Failed to close HIKMICRO queue {}: {}", close_queue_id, e);
                        }
                        running_capture.lock().unwrap().remove(&unique_id);
                    });
                }
            }
            Err(e) => warn!("HIKMICRO discovery failed: {}", e),
        }

        #[cfg(not(target_os = "linux"))]
        {
            warn!("hikmicro-thermal capture is Linux-only");
            break;
        }

        tokio::time::sleep(DISCOVERY_POLL_INTERVAL).await;
    }

    let drained = tokio::time::timeout(CAPTURE_STOP_TIMEOUT, async {
        while let Some(result) = captures.join_next().await {
            if let Err(e) = result {
                warn!(
                    "HIKMICRO capture task failed to join during shutdown: {}",
                    e
                );
            }
        }
    })
    .await;
    if drained.is_err() {
        warn!(
            "HIKMICRO capture tasks did not finish within {:?}",
            CAPTURE_STOP_TIMEOUT
        );
    }
}

#[cfg(target_os = "linux")]
async fn run_camera_capture(
    camera: CameraIdentity,
    sink: Sink,
    stop: Arc<AtomicBool>,
    frame_timeout: Duration,
    frame_skip: u32,
) -> Result<(), String> {
    let device_info_camera = camera.clone();
    let device_info_sink = sink.clone();
    let device_info = tokio::task::spawn_blocking(move || {
        linux::enqueue_device_info(&device_info_camera, &device_info_sink)
    })
    .await
    .map_err(|e| format!("HIKMICRO device-info task failed: {}", e))??;

    let capture_camera = camera.clone();
    let capture_stop = stop.clone();
    tokio::task::spawn_blocking(move || {
        linux::capture_continuous(
            &capture_camera,
            device_info,
            &sink,
            capture_stop.as_ref(),
            frame_timeout,
            frame_skip,
        )
    })
    .await
    .map_err(|e| format!("HIKMICRO continuous-capture task failed: {}", e))?
}

fn queue_id_for_camera(prefix: &str, camera: &CameraIdentity) -> String {
    let leaf = if !camera.serial_number.trim().is_empty() {
        sanitize_queue_component(&camera.serial_number)
    } else {
        format!(
            "{:04x}-{:04x}-bus{}-dev{}",
            camera.vendor_id, camera.product_id, camera.bus_number, camera.device_number
        )
    };
    format!("{}/{}", prefix.trim_matches('/'), leaf)
}

fn sanitize_queue_component(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-');
    if out.is_empty() {
        format!("{:x}", md5::compute(value.as_bytes()))
    } else {
        out.to_string()
    }
}

#[derive(Debug, Clone)]
pub struct CameraIdentity {
    pub vendor_id: u32,
    pub product_id: u32,
    pub bus_number: u32,
    pub device_number: u32,
    pub serial_number: String,
    pub manufacturer: String,
    pub product: String,
    pub unique_id: String,
}

/// Write target for the capture thread, which runs on `spawn_blocking`.
#[derive(Clone)]
pub(crate) struct Sink {
    pub(crate) normfs: Arc<NormFS>,
    pub(crate) queue_id: normfs::QueueId,
    pub(crate) runtime: tokio::runtime::Handle,
}

fn enqueue_envelope(
    sink: &Sink,
    envelope: hikmicro_proto::hikmicro::RxEnvelope,
) -> Result<(), String> {
    let frames = envelope.frames.is_some();
    let mut buf = BytesMut::new();
    envelope.encode(&mut buf).map_err(|e| e.to_string())?;
    let data = buf.freeze();

    if frames {
        match sink.normfs.try_enqueue(&sink.queue_id, data) {
            Ok(_) | Err(normfs::Error::WouldBlock) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        // Bounded so shutdown can join this thread.
        sink.runtime
            .block_on(enqueue_waiting(
                &sink.normfs,
                &sink.queue_id,
                data,
                WRITE_TIMEOUT,
            ))
            .map_err(|e| e.to_string())
    }
}

fn compact_layout() -> hikmicro_proto::hikmicro::CompactPayloadLayout {
    hikmicro_proto::hikmicro::CompactPayloadLayout {
        sensor_width: SENSOR_WIDTH,
        sensor_height: SENSOR_HEIGHT,
        payload_length: COMPACT_PAYLOAD_LEN as u32,
        thermal_y16_offset: 0,
        thermal_y16_length: THERMAL_Y16_LEN as u32,
        runtime_block_offset: THERMAL_Y16_LEN as u32,
        runtime_block_length: RUNTIME_BLOCK_LEN as u32,
    }
}

fn parse_runtime_block(runtime: &[u8]) -> hikmicro_proto::hikmicro::RuntimeBlockInfo {
    let le16 = |offset: usize| -> u32 {
        runtime
            .get(offset..offset + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]) as u32)
            .unwrap_or(0)
    };
    let le32 = |offset: usize| -> u32 {
        runtime
            .get(offset..offset + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .unwrap_or(0)
    };

    let side_offset = SENSOR_WIDTH as usize * 2;
    let marker = le32(side_offset);
    let raw_sensor = le32(side_offset + 4);

    hikmicro_proto::hikmicro::RuntimeBlockInfo {
        marker_ok: marker == 0xaabbccdd,
        marker,
        raw_sensor,
        mtlib_sensor: microta_sensor_type(raw_sensor),
        inter_param_0: le32(side_offset + 0x38),
        inter_param_1: le32(side_offset + 0x3c),
        inter_param_2: le32(side_offset + 0x40),
        frame_height: le16(8 * 2),
        frame_width: le16(9 * 2),
        raw_sensor_header: le16(10 * 2),
        mode: le16(5 * 2) & 0x3fff,
        range: le16(13 * 2) & 0x3fff,
    }
}

fn microta_sensor_type(raw: u32) -> u32 {
    const MAP: [u32; 35] = [
        0xa0, 0xb1, 0xb2, 0xb0, 0x10, 0x20, 0x21, 0x30, 0x21, 0x40, 0x21, 0x21, 0x51, 0x50, 0x52,
        0x21, 0x53, 0x50, 0x54, 0x21, 0x21, 0x21, 0x55, 0x21, 0x21, 0x21, 0x21, 0x21, 0x21, 0x21,
        0x21, 0x21, 0x21, 0x21, 0x57,
    ];

    let idx = raw.wrapping_sub(0xb0);
    if idx < MAP.len() as u32 && ((0x4004772ff_u64 >> idx) & 1) != 0 {
        MAP[idx as usize]
    } else {
        raw
    }
}

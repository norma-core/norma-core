use crate::airgradient_open_air_o_1pst_proto::{
    AirGradientDevice, AirGradientSignalType, RxEnvelope,
};
use crate::driver::device_rx_queue_path;
use crate::parse;
use bytes::Bytes;
use log::{debug, error, info};
use normfs::{NormFS, QueueId};
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::timeout;
use tokio_serial::{SerialPortBuilderExt, SerialStream};

const OPEN_TIMEOUT_MS: u64 = 100;
const MAX_LINE_BYTES: usize = 4096;
const MALFORMED_LOG_INTERVAL: Duration = Duration::from_secs(30);

enum Line {
    Ready,
    Oversized,
    Eof,
}

pub struct AirGradientPort<T: StationEngine> {
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    device: AirGradientDevice,
    read_timeout: Duration,
}

impl<T: StationEngine> AirGradientPort<T> {
    pub fn new(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        device: AirGradientDevice,
        read_timeout: Duration,
    ) -> Self {
        Self {
            normfs,
            station_engine,
            device,
            read_timeout,
        }
    }

    pub async fn open(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let port_name = self.device.port_name.clone();
        let port = tokio_serial::new(&port_name, self.device.port_baud_rate)
            .timeout(Duration::from_millis(OPEN_TIMEOUT_MS))
            .open_native_async()?;
        info!("Successfully opened AirGradient Open Air O-1PST port: {}", port_name);

        let mut reader = BufReader::new(port);
        let mut buf: Vec<u8> = Vec::with_capacity(256);
        let mut session: Option<(QueueId, Arc<AirGradientDevice>)> = None;
        let mut malformed_count: u64 = 0;
        let mut last_malformed_log: Option<Instant> = None;

        let reason = loop {
            match read_line(&mut reader, &mut buf, self.read_timeout).await {
                Err(reason) => break reason,
                Ok(Line::Eof) => break "device closed the connection (EOF)".to_string(),
                Ok(Line::Oversized) => {
                    note_malformed(&mut malformed_count, &mut last_malformed_log, b"<oversized line>");
                }
                Ok(Line::Ready) => {
                    let line = String::from_utf8_lossy(&buf);
                    if parse::has_json_object(&line) {
                        let payload = Bytes::copy_from_slice(trim_line_end(&buf));

                        if session.is_none() {
                            let mut device = self.device.clone();
                            device.device_id = parse::json_string_field(&line, "device_id")
                                .unwrap_or_default()
                                .to_string();

                            let rx_queue_id = match self.ensure_device_queue(&device).await {
                                Ok(rx_queue_id) => rx_queue_id,
                                Err(err) => break format!("failed to create device queue: {err}"),
                            };
                            info!(
                                "AirGradient Open Air O-1PST receiving measurements from {} (device_id={:?})",
                                port_name, device.device_id
                            );
                            let device = Arc::new(device);
                            self.publish(
                                &rx_queue_id,
                                &device,
                                AirGradientSignalType::AirgradientConnected,
                                Some(payload.clone()),
                                String::new(),
                            );
                            session = Some((rx_queue_id, device));
                        }

                        if let Some((rx_queue_id, device)) = &session {
                            self.publish(
                                rx_queue_id,
                                device,
                                AirGradientSignalType::AirgradientMeasurement,
                                Some(payload),
                                String::new(),
                            );
                        }
                    } else {
                        note_malformed(
                            &mut malformed_count,
                            &mut last_malformed_log,
                            line.as_bytes(),
                        );
                    }
                }
            }
        };

        info!("AirGradient Open Air O-1PST port {} closed: {}", port_name, reason);
        if let Some((rx_queue_id, device)) = &session {
            self.publish(
                rx_queue_id,
                device,
                AirGradientSignalType::AirgradientDisconnected,
                None,
                reason,
            );
        }
        Ok(())
    }

    async fn ensure_device_queue(
        &self,
        device: &AirGradientDevice,
    ) -> Result<QueueId, Box<dyn std::error::Error + Send + Sync>> {
        let rx_queue_id = self.normfs.resolve(&device_rx_queue_path(device));
        self.normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        self.station_engine.register_queue(
            &rx_queue_id,
            QueueDataType::QdtAirgradientOpenAirO1pstRx,
            vec![],
        );
        info!(
            "AirGradient Open Air O-1PST on {} publishing to queue {}",
            device.port_name, rx_queue_id
        );
        Ok(rx_queue_id)
    }

    fn publish(
        &self,
        rx_queue_id: &QueueId,
        device: &AirGradientDevice,
        signal_type: AirGradientSignalType,
        data: Option<Bytes>,
        error: String,
    ) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: signal_type as i32,
            device: Some(device.clone()),
            data: data.unwrap_or_default(),
            error,
        };

        let mut buffer = Vec::new();
        if let Err(err) = envelope.encode(&mut buffer) {
            error!("Failed to encode AirGradient Open Air O-1PST envelope: {}", err);
            return;
        }
        if let Err(err) = self.normfs.enqueue(rx_queue_id, Bytes::from(buffer)) {
            error!("Failed to enqueue AirGradient Open Air O-1PST envelope: {}", err);
        }
    }
}

async fn read_line(
    reader: &mut BufReader<SerialStream>,
    buf: &mut Vec<u8>,
    read_timeout: Duration,
) -> Result<Line, String> {
    buf.clear();
    let mut oversized = false;

    loop {
        let chunk = match timeout(read_timeout, reader.fill_buf()).await {
            Err(_elapsed) => return Err(format!("no data received within {:?}", read_timeout)),
            Ok(Err(err)) => return Err(format!("serial read error: {}", err)),
            Ok(Ok(chunk)) => chunk,
        };

        if chunk.is_empty() {
            if buf.is_empty() && !oversized {
                return Ok(Line::Eof);
            }
            return Ok(if oversized { Line::Oversized } else { Line::Ready });
        }

        match chunk.iter().position(|&byte| byte == b'\n') {
            Some(pos) => {
                if !oversized && buf.len() + pos < MAX_LINE_BYTES {
                    buf.extend_from_slice(&chunk[..=pos]);
                } else {
                    oversized = true;
                }
                reader.consume(pos + 1);
                return Ok(if oversized { Line::Oversized } else { Line::Ready });
            }
            None => {
                let len = chunk.len();
                if !oversized && buf.len() + len <= MAX_LINE_BYTES {
                    buf.extend_from_slice(chunk);
                } else {
                    oversized = true;
                }
                reader.consume(len);
            }
        }
    }
}

fn trim_line_end(buf: &[u8]) -> &[u8] {
    let mut end = buf.len();
    while end > 0 && (buf[end - 1] == b'\n' || buf[end - 1] == b'\r') {
        end -= 1;
    }
    &buf[..end]
}

fn note_malformed(count: &mut u64, last_log: &mut Option<Instant>, sample: &[u8]) {
    *count += 1;
    let now = Instant::now();
    let should_log = match last_log {
        None => true,
        Some(previous) => now.duration_since(*previous) >= MALFORMED_LOG_INTERVAL,
    };
    if should_log {
        let end = sample.len().min(120);
        let preview = String::from_utf8_lossy(&sample[..end]);
        debug!(
            "AirGradient Open Air O-1PST skipped {} malformed line(s); latest: {:?}",
            count,
            preview.trim_end()
        );
        *last_log = Some(now);
    }
}

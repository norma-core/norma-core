use crate::driver::{HEX_POLL_INTERVAL, PortParams, device_rx_queue_path};
use crate::hex;
use crate::parse::{self, DemuxEvent, VeDirectDemux, parse_hex_u16};
use crate::registers;
use crate::victron_smartsolar_mppt_proto::{RxEnvelope, VictronDevice, VictronSignalType};
use bytes::Bytes;
use log::{debug, error, info};
use normfs::{NormFS, QueueId};
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::{MissedTickBehavior, interval, sleep, timeout};
use tokio_serial::{SerialPortBuilderExt, SerialStream};

const OPEN_TIMEOUT_MS: u64 = 100;
const MALFORMED_LOG_INTERVAL: Duration = Duration::from_secs(30);
const HEX_PACING: Duration = Duration::from_millis(150);
const FAULT_REPORT_AFTER: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeErrorKind {
    Silent,
    WrongModel,
}

#[derive(Debug)]
pub struct VictronProbeError {
    pub kind: ProbeErrorKind,
    pub message: String,
}

impl std::fmt::Display for VictronProbeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for VictronProbeError {}

fn probe_err(
    kind: ProbeErrorKind,
    msg: impl Into<String>,
) -> Box<dyn std::error::Error + Send + Sync> {
    Box::new(VictronProbeError {
        kind,
        message: msg.into(),
    })
}

type Reader = BufReader<ReadHalf<SerialStream>>;
type Writer = WriteHalf<SerialStream>;

pub struct VictronPort<T: StationEngine> {
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    device: VictronDevice,
    params: PortParams,
    shutdown: watch::Receiver<bool>,
}

impl<T: StationEngine> VictronPort<T> {
    pub fn new(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        device: VictronDevice,
        params: PortParams,
        shutdown: watch::Receiver<bool>,
    ) -> Self {
        Self {
            normfs,
            station_engine,
            device,
            params,
            shutdown,
        }
    }

    pub async fn open(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let port_name = self.device.port_name.clone();
        let port = tokio_serial::new(&port_name, self.device.port_baud_rate)
            .timeout(Duration::from_millis(OPEN_TIMEOUT_MS))
            .open_native_async()?;
        info!(
            "Successfully opened Victron SmartSolar MPPT port: {}",
            port_name
        );

        let (read_half, write_half) = tokio::io::split(port);
        let mut reader = BufReader::new(read_half);
        let mut demux = VeDirectDemux::new();
        let mut device = self.device.clone();

        let (probe_block, leftover) = self.probe(&mut reader, &mut demux, &mut device).await?;
        let device = Arc::new(device);
        info!(
            "Victron SmartSolar MPPT identified on {} (product_id={:#06x}, model={:?}, fw={:?})",
            port_name, device.product_id, device.model_name, device.firmware_version
        );

        let rx_queue_id = self.ensure_device_queue(&device).await?;

        self.publish(
            &rx_queue_id,
            &device,
            VictronSignalType::VictronConnected,
            Some(&probe_block),
            None,
            Vec::new(),
            String::new(),
        );
        self.publish(
            &rx_queue_id,
            &device,
            VictronSignalType::VictronTextBlock,
            Some(&probe_block),
            None,
            Vec::new(),
            String::new(),
        );

        let poller: JoinHandle<()> =
            tokio::spawn(run_hex_poller(write_half, self.shutdown.clone()));

        let reason = self
            .read_loop(
                &mut reader,
                &mut demux,
                &rx_queue_id,
                &device,
                leftover,
                probe_block,
            )
            .await;

        poller.abort();
        info!(
            "Victron SmartSolar MPPT port {} closed: {}",
            port_name, reason
        );
        self.publish(
            &rx_queue_id,
            &device,
            VictronSignalType::VictronDisconnected,
            None,
            None,
            Vec::new(),
            reason,
        );
        Ok(())
    }

    async fn ensure_device_queue(
        &self,
        device: &VictronDevice,
    ) -> Result<QueueId, Box<dyn std::error::Error + Send + Sync>> {
        let rx_queue_id = self.normfs.resolve(&device_rx_queue_path(device));
        self.normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        self.station_engine.register_queue(
            &rx_queue_id,
            QueueDataType::QdtVictronSmartsolarMpptRx,
            vec![],
        );
        info!(
            "Victron SmartSolar MPPT on {} publishing to queue {}",
            device.port_name, rx_queue_id
        );
        Ok(rx_queue_id)
    }

    async fn probe(
        &self,
        reader: &mut Reader,
        demux: &mut VeDirectDemux,
        device: &mut VictronDevice,
    ) -> Result<(Vec<u8>, Vec<u8>), Box<dyn std::error::Error + Send + Sync>> {
        const POLL_SLICE: Duration = Duration::from_secs(1);
        let deadline = if self.params.known_cable {
            None
        } else {
            Some(Instant::now() + self.params.probe_timeout)
        };

        loop {
            let wait = match deadline {
                Some(deadline) => deadline.checked_duration_since(Instant::now()).ok_or_else(|| {
                    probe_err(
                        ProbeErrorKind::Silent,
                        "no valid VE.Direct block within probe timeout",
                    )
                })?,
                None => POLL_SLICE,
            };

            let bytes = match timeout(wait, reader.fill_buf()).await {
                Err(_) => {
                    if deadline.is_none() {
                        continue;
                    }
                    return Err(probe_err(
                        ProbeErrorKind::Silent,
                        "no valid VE.Direct block within probe timeout",
                    ));
                }
                Ok(Err(err)) => return Err(format!("serial read error during probe: {err}").into()),
                Ok(Ok(slice)) => {
                    if slice.is_empty() {
                        return Err(probe_err(
                            ProbeErrorKind::Silent,
                            "device closed during probe (EOF)",
                        ));
                    }
                    let bytes = slice.to_vec();
                    reader.consume(bytes.len());
                    bytes
                }
            };

            for (index, byte) in bytes.iter().enumerate() {
                if let Some(DemuxEvent::TextBlock(block)) = demux.push(*byte) {
                    match classify_block(&block) {
                        ProbeOutcome::Accept(product_id) => {
                            enrich_device(device, &block, product_id);
                            let leftover = bytes[index + 1..].to_vec();
                            return Ok((block, leftover));
                        }
                        ProbeOutcome::Reject(reason) => {
                            return Err(probe_err(ProbeErrorKind::WrongModel, reason));
                        }
                        ProbeOutcome::Continue => {}
                    }
                }
            }
        }
    }

    async fn read_loop(
        &self,
        reader: &mut Reader,
        demux: &mut VeDirectDemux,
        rx_queue_id: &QueueId,
        device: &Arc<VictronDevice>,
        leftover: Vec<u8>,
        probe_block: Vec<u8>,
    ) -> String {
        let mut shutdown = self.shutdown.clone();
        let mut malformed_count: u64 = 0;
        let mut last_malformed_log: Option<Instant> = None;
        let mut last_valid = Instant::now();
        let mut fault_reported = false;
        let mut carry = leftover;
        let mut last_text = Some(probe_block);
        let mut regs: BTreeMap<u16, Bytes> = BTreeMap::new();

        loop {
            if *shutdown.borrow() {
                return "station shutting down".to_string();
            }

            let bytes = if !carry.is_empty() {
                std::mem::take(&mut carry)
            } else {
                let read = tokio::select! {
                    _ = shutdown.changed() => return "station shutting down".to_string(),
                    result = timeout(self.params.read_timeout, reader.fill_buf()) => result,
                };

                match read {
                    Err(_) => {
                        return format!("no data received within {:?}", self.params.read_timeout);
                    }
                    Ok(Err(err)) => return format!("serial read error: {err}"),
                    Ok(Ok(slice)) => {
                        if slice.is_empty() {
                            return "device closed the connection (EOF)".to_string();
                        }
                        let bytes = slice.to_vec();
                        reader.consume(bytes.len());
                        bytes
                    }
                }
            };

            for byte in bytes {
                match demux.push(byte) {
                    Some(DemuxEvent::TextBlock(block)) => {
                        last_valid = Instant::now();
                        fault_reported = false;
                        last_text = Some(block);
                        self.publish(
                            rx_queue_id,
                            device,
                            VictronSignalType::VictronTextBlock,
                            last_text.as_deref(),
                            None,
                            regs.values().cloned().collect(),
                            String::new(),
                        );
                    }
                    Some(DemuxEvent::HexFrame(frame)) => {
                        last_valid = Instant::now();
                        fault_reported = false;
                        let frame = Bytes::from(frame);
                        if let Some((response, register, flags)) = hex::frame_header(&frame) {
                            let answered = response == hex::RSP_GET || response == hex::RSP_ASYNC;
                            if answered && flags == 0 {
                                regs.insert(register, frame.clone());
                            }
                        }
                        self.publish(
                            rx_queue_id,
                            device,
                            VictronSignalType::VictronHexFrame,
                            last_text.as_deref(),
                            Some(frame),
                            regs.values().cloned().collect(),
                            String::new(),
                        );
                    }
                    Some(DemuxEvent::TextBlockBad) | Some(DemuxEvent::HexFrameBad) => {
                        note_malformed(&mut malformed_count, &mut last_malformed_log);
                    }
                    None => {}
                }
            }

            if !fault_reported && last_valid.elapsed() >= FAULT_REPORT_AFTER {
                self.publish(
                    rx_queue_id,
                    device,
                    VictronSignalType::VictronError,
                    None,
                    None,
                    Vec::new(),
                    format!("no valid VE.Direct frame for {:?}", last_valid.elapsed()),
                );
                fault_reported = true;
            }
        }
    }

    fn publish(
        &self,
        rx_queue_id: &QueueId,
        device: &VictronDevice,
        signal_type: VictronSignalType,
        data: Option<&[u8]>,
        hex_frame: Option<Bytes>,
        hex_frames: Vec<Bytes>,
        error: String,
    ) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: signal_type as i32,
            device: Some(device.clone()),
            data: data.map(Bytes::copy_from_slice).unwrap_or_default(),
            hex_frame: hex_frame.unwrap_or_default(),
            hex_frames,
            error,
        };

        let mut buffer = Vec::new();
        if let Err(err) = envelope.encode(&mut buffer) {
            error!("Failed to encode Victron SmartSolar MPPT envelope: {err}");
            return;
        }
        if let Err(err) = self.normfs.enqueue(rx_queue_id, Bytes::from(buffer)) {
            error!("Failed to enqueue Victron SmartSolar MPPT envelope: {err}");
        }
    }
}

enum ProbeOutcome {
    Accept(u16),
    Reject(String),
    Continue,
}

fn classify_block(block: &[u8]) -> ProbeOutcome {
    match parse::text_field(block, "PID").and_then(parse_hex_u16) {
        Some(pid) if registers::is_known_product_id(pid) => ProbeOutcome::Accept(pid),
        Some(pid) => ProbeOutcome::Reject(format!("unrecognized product id {pid:#06x}")),
        None => ProbeOutcome::Continue,
    }
}

fn enrich_device(device: &mut VictronDevice, block: &[u8], product_id: u16) {
    device.product_id = product_id as u32;
    device.model_name = registers::model_name_for(product_id)
        .map(str::to_string)
        .or_else(|| parse::text_field(block, "PID").map(str::to_string))
        .unwrap_or_default();
    device.firmware_version = parse::text_field(block, "FW")
        .map(str::to_string)
        .unwrap_or_default();
    device.device_serial = parse::text_field(block, "SER#")
        .map(str::to_string)
        .unwrap_or_default();
}

async fn run_hex_poller(mut writer: Writer, mut shutdown: watch::Receiver<bool>) {
    let mut poll = interval(HEX_POLL_INTERVAL);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = poll.tick() => {}
            _ = shutdown.changed() => return,
        }

        if send_group(&mut writer, registers::CURRENT_GROUP).await.is_err() {
            return;
        }
    }
}

async fn send_group(writer: &mut Writer, registers: &[u16]) -> std::io::Result<()> {
    for &register in registers {
        writer.write_all(&hex::make_get(register)).await?;
        sleep(HEX_PACING).await;
    }
    Ok(())
}

fn note_malformed(count: &mut u64, last_log: &mut Option<Instant>) {
    *count += 1;
    let now = Instant::now();
    let should_log = match last_log {
        None => true,
        Some(previous) => now.duration_since(*previous) >= MALFORMED_LOG_INTERVAL,
    };
    if should_log {
        debug!(
            "Victron SmartSolar MPPT skipped {} malformed frame(s)",
            count
        );
        *last_log = Some(now);
    }
}

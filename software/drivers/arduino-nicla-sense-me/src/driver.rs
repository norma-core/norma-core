use crate::arduino_nicla_sense_me_proto::{
    ArduinoNiclaSenseMeDevice, ArduinoNiclaSenseMeDeviceInfo, ArduinoNiclaSenseMeSignalType,
    RxEnvelope,
};
use bytes::Bytes;
use i2c_async::AsyncI2cDevice;
use log::{debug, error, info, warn};
use normfs::{NormFS, QueueId, UintN};
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::task::JoinHandle;
use tokio::time::{MissedTickBehavior, interval};
use tokio_serial::{SerialPort, SerialPortBuilderExt, SerialStream};

pub const RX_QUEUE_ID: &str = "arduino-nicla-sense-me/rx";
pub const DEFAULT_I2C_ADDRESS: u16 = 0x22;
pub const RAW_REGISTER_START: u8 = 0x00;
pub const RAW_REGISTER_LENGTH: usize = 0xA8;

const SOFTWARE_REVISION_REGISTER: usize = 0x0C;
const PRODUCT_ID_REGISTER: usize = 0x0D;
const SERIAL_NUMBER_REGISTER: usize = 0x0E;
const SERIAL_NUMBER_LENGTH: usize = 6;

pub const USB_VID: u16 = 0x2341;
pub const USB_PID: u16 = 0x0060;
const SERIAL_CMD_DUMP: u8 = 0x01;
const SERIAL_MAGIC: [u8; 2] = [0xA5, 0x5A];
const SERIAL_FRAME_LEN: usize = 3 + RAW_REGISTER_LENGTH + 1;
const SERIAL_BAUD: u32 = 115_200;
const SERIAL_RESPONSE_TIMEOUT: Duration = Duration::from_millis(500);
const PRODUCT_ID: u8 = 0x4D;

pub const SERIAL_CMD_MOTION: u8 = 0x02;
const MOTION_MAGIC: [u8; 2] = [0xA5, 0x5B];
pub const MOTION_SAMPLE_SIZE: usize = 19;
pub const MOTION_RING_CAPACITY: usize = 256;
const MOTION_HEADER_LEN: usize = 10;

type DriverResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct ArduinoNiclaSenseMeDriverConfig {
    pub poll_interval: Duration,
    pub boards: Vec<ArduinoNiclaSenseMeBoardConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArduinoNiclaSenseMeTransport {
    I2c { i2c_bus: u32 },
    Usb,
}

#[derive(Debug, Clone)]
pub struct ArduinoNiclaSenseMeBoardConfig {
    pub id: Option<String>,
    pub transport: ArduinoNiclaSenseMeTransport,
}

impl Default for ArduinoNiclaSenseMeDriverConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(1),
            boards: Vec::new(),
        }
    }
}

pub struct ArduinoNiclaSenseMeDriver {
    _tasks: Vec<JoinHandle<()>>,
}

#[derive(Debug, Clone)]
struct Board {
    id: String,
    transport: ArduinoNiclaSenseMeTransport,
}

impl Board {
    fn key(transport: ArduinoNiclaSenseMeTransport) -> String {
        match transport {
            ArduinoNiclaSenseMeTransport::I2c { i2c_bus } => format!("i2c-{i2c_bus}"),
            ArduinoNiclaSenseMeTransport::Usb => "usb".to_string(),
        }
    }

    fn from_config(config: &ArduinoNiclaSenseMeBoardConfig) -> Self {
        Self {
            id: config
                .id
                .clone()
                .filter(|id| !id.trim().is_empty())
                .unwrap_or_else(|| Self::key(config.transport)),
            transport: config.transport,
        }
    }

    fn proto(&self, data: Option<&[u8]>, usb_port: Option<&str>) -> ArduinoNiclaSenseMeDevice {
        let (i2c_bus, i2c_address, transport) = match self.transport {
            ArduinoNiclaSenseMeTransport::I2c { i2c_bus } => {
                (i2c_bus, DEFAULT_I2C_ADDRESS as u32, "i2c")
            }
            ArduinoNiclaSenseMeTransport::Usb => (0, 0, "usb"),
        };
        ArduinoNiclaSenseMeDevice {
            id: self.id.clone(),
            i2c_bus,
            i2c_address,
            transport: transport.to_string(),
            usb_port: usb_port.unwrap_or_default().to_string(),
            info: data.and_then(parse_device_info),
        }
    }
}

impl ArduinoNiclaSenseMeDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        config: ArduinoNiclaSenseMeDriverConfig,
    ) -> DriverResult<Self> {
        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        station_engine.register_queue(
            &rx_queue_id,
            QueueDataType::QdtArduinoNiclaSenseMeRx,
            vec![],
        );

        let poll_interval = if config.poll_interval == Duration::ZERO {
            warn!("Arduino Nicla Sense ME poll interval is zero, using 1s");
            Duration::from_secs(1)
        } else {
            config.poll_interval
        };

        let mut boards = BTreeMap::new();
        for board_config in &config.boards {
            let key = Board::key(board_config.transport);
            if boards
                .insert(key.clone(), Board::from_config(board_config))
                .is_some()
            {
                warn!(
                    "Arduino Nicla Sense ME board {:?} replaces an earlier board with the same transport key {key}",
                    board_config.id
                );
            }
        }
        if boards.is_empty() {
            warn!("Arduino Nicla Sense ME driver enabled with no boards configured");
        }

        let tasks = boards
            .values()
            .map(|board| {
                let board = board.clone();
                let normfs = normfs.clone();
                let rx_queue_id = rx_queue_id.clone();
                match board.transport {
                    ArduinoNiclaSenseMeTransport::I2c { .. } => {
                        tokio::spawn(run_i2c_board_worker(normfs, rx_queue_id, board, poll_interval))
                    }
                    ArduinoNiclaSenseMeTransport::Usb => {
                        tokio::spawn(run_usb_board_worker(normfs, rx_queue_id, board, poll_interval))
                    }
                }
            })
            .collect::<Vec<_>>();

        info!(
            "Started Arduino Nicla Sense ME driver for {} board(s)",
            boards.len()
        );

        Ok(Self { _tasks: tasks })
    }
}

pub async fn start_arduino_nicla_sense_me_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: ArduinoNiclaSenseMeDriverConfig,
) -> DriverResult<Arc<ArduinoNiclaSenseMeDriver>> {
    let driver = ArduinoNiclaSenseMeDriver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

async fn run_i2c_board_worker(
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    board: Board,
    poll_interval: Duration,
) {
    let ArduinoNiclaSenseMeTransport::I2c { i2c_bus } = board.transport else {
        return;
    };
    let i2c = AsyncI2cDevice::new(i2c_bus, DEFAULT_I2C_ADDRESS);
    let mut connected = false;
    let mut last_data = None::<Bytes>;
    let mut last_error = None::<String>;
    let mut tick = interval(poll_interval);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tick.tick().await;

        match i2c
            .read_smbus_i2c_block_registers(RAW_REGISTER_START, RAW_REGISTER_LENGTH)
            .await
        {
            Ok(data) => {
                if !connected {
                    send_board_signal(
                        &normfs,
                        &rx_queue_id,
                        &board,
                        ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeConnected,
                        Some(&data),
                        None,
                        None,
                        None,
                    );
                    connected = true;
                }

                send_board_signal(
                    &normfs,
                    &rx_queue_id,
                    &board,
                    ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeRegistersSnapshot,
                    Some(&data),
                    None,
                    None,
                    None,
                );
                last_data = Some(data);
                last_error = None;
            }
            Err(error) => {
                if connected {
                    send_board_signal(
                        &normfs,
                        &rx_queue_id,
                        &board,
                        ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeDisconnected,
                        last_data.as_ref(),
                        Some(error.clone()),
                        None,
                        None,
                    );
                    connected = false;
                }

                if last_error.as_deref() != Some(error.as_str()) {
                    send_board_signal(
                        &normfs,
                        &rx_queue_id,
                        &board,
                        ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeError,
                        last_data.as_ref(),
                        Some(error.clone()),
                        None,
                        None,
                    );
                    last_error = Some(error);
                }
            }
        }
    }
}

fn crc8(data: &[u8]) -> u8 {
    let mut crc: u8 = 0;
    for &byte in data {
        crc ^= byte;
        for _ in 0..8 {
            crc = if crc & 0x80 != 0 { (crc << 1) ^ 0x07 } else { crc << 1 };
        }
    }
    crc
}

fn parse_dump_frame(frame: &[u8]) -> Result<Bytes, String> {
    if frame.len() != SERIAL_FRAME_LEN {
        return Err(format!("unexpected frame length {}", frame.len()));
    }
    if frame[0..2] != SERIAL_MAGIC {
        return Err(format!("bad frame magic {:#04x} {:#04x}", frame[0], frame[1]));
    }
    if frame[2] as usize != RAW_REGISTER_LENGTH {
        return Err(format!("bad payload length {:#04x}", frame[2]));
    }
    let payload = &frame[3..3 + RAW_REGISTER_LENGTH];
    let expected = frame[3 + RAW_REGISTER_LENGTH];
    let computed = crc8(payload);
    if computed != expected {
        return Err(format!("crc mismatch: computed {computed:#04x}, frame has {expected:#04x}"));
    }
    Ok(Bytes::copy_from_slice(payload))
}

pub fn find_usb_port() -> Option<String> {
    let ports = tokio_serial::available_ports().ok()?;
    ports.into_iter().find_map(|port| match &port.port_type {
        tokio_serial::SerialPortType::UsbPort(usb) if usb.vid == USB_VID && usb.pid == USB_PID => {
            // On macOS both /dev/tty.* and /dev/cu.* enumerate for one
            // device; prefer the callout (cu) device for host-initiated
            // CDC traffic. (Deliberate divergence from vesc-trampa, which
            // prefers tty; validated against real hardware in this plan's
            // Task 6 — if the probe hangs on open, flip this filter.)
            #[cfg(target_os = "macos")]
            if port.port_name.starts_with("/dev/tty.") {
                return None;
            }
            Some(port.port_name)
        }
        _ => None,
    })
}

pub async fn read_dump(port: &mut SerialStream) -> Result<Bytes, String> {
    // The mbed-core USB CDC stack treats the port as closed until the host
    // asserts DTR: without it Serial.available() stays 0 on the board and
    // the command is never seen. Asserting per call is idempotent.
    port.write_data_terminal_ready(true)
        .map_err(|error| format!("failed to assert DTR: {error}"))?;
    port.clear(tokio_serial::ClearBuffer::Input)
        .map_err(|error| format!("failed to clear input buffer: {error}"))?;
    port.write_all(&[SERIAL_CMD_DUMP])
        .await
        .map_err(|error| format!("failed to send dump command: {error}"))?;
    let mut frame = [0u8; SERIAL_FRAME_LEN];
    tokio::time::timeout(SERIAL_RESPONSE_TIMEOUT, port.read_exact(&mut frame))
        .await
        .map_err(|_| "timed out waiting for dump frame".to_string())?
        .map_err(|error| format!("failed to read dump frame: {error}"))?;
    parse_dump_frame(&frame)
}

fn check_motion_frame(header: &[u8; MOTION_HEADER_LEN], rest: &[u8]) -> Result<Bytes, String> {
    if header[0..2] != MOTION_MAGIC {
        return Err(format!("bad motion frame magic {:#04x} {:#04x}", header[0], header[1]));
    }
    let count = u16::from_le_bytes([header[2], header[3]]) as usize;
    if count > MOTION_RING_CAPACITY {
        return Err(format!("motion frame count {count} exceeds ring capacity"));
    }
    let expected_len = count * MOTION_SAMPLE_SIZE + 1;
    if rest.len() != expected_len {
        return Err(format!("motion frame length {} != expected {expected_len}", rest.len()));
    }
    let (payload, crc) = rest.split_at(rest.len() - 1);
    let mut blob = Vec::with_capacity(MOTION_HEADER_LEN - 2 + payload.len());
    blob.extend_from_slice(&header[2..]);
    blob.extend_from_slice(payload);
    let computed = crc8(&blob);
    if computed != crc[0] {
        return Err(format!("motion crc mismatch: computed {computed:#04x}, frame has {:#04x}", crc[0]));
    }
    Ok(Bytes::from(blob))
}

pub async fn read_motion_batch(port: &mut SerialStream) -> Result<Bytes, String> {
    port.write_all(&[SERIAL_CMD_MOTION])
        .await
        .map_err(|error| format!("failed to send motion command: {error}"))?;
    let mut header = [0u8; MOTION_HEADER_LEN];
    tokio::time::timeout(SERIAL_RESPONSE_TIMEOUT, port.read_exact(&mut header))
        .await
        .map_err(|_| "timed out waiting for motion frame".to_string())?
        .map_err(|error| format!("failed to read motion header: {error}"))?;
    if header[0..2] != MOTION_MAGIC {
        return Err(format!("bad motion frame magic {:#04x} {:#04x}", header[0], header[1]));
    }
    let count = u16::from_le_bytes([header[2], header[3]]) as usize;
    if count > MOTION_RING_CAPACITY {
        return Err(format!("motion frame count {count} exceeds ring capacity"));
    }
    let mut rest = vec![0u8; count * MOTION_SAMPLE_SIZE + 1];
    tokio::time::timeout(SERIAL_RESPONSE_TIMEOUT, port.read_exact(&mut rest))
        .await
        .map_err(|_| "timed out waiting for motion payload".to_string())?
        .map_err(|error| format!("failed to read motion payload: {error}"))?;
    check_motion_frame(&header, &rest)
}

async fn poll_usb_once(
    connection: &mut Option<(SerialStream, String)>,
    verified: &mut bool,
    motion_supported: &mut bool,
) -> Result<(Bytes, String, Option<Bytes>), String> {
    if connection.is_none() {
        let name = find_usb_port()
            .ok_or_else(|| "no Nicla Sense ME USB device found (vid 2341 pid 0060)".to_string())?;
        let stream = tokio_serial::new(&name, SERIAL_BAUD)
            .timeout(SERIAL_RESPONSE_TIMEOUT)
            .open_native_async()
            .map_err(|error| format!("failed to open {name}: {error}"))?;
        debug!("Opened Arduino Nicla Sense ME USB port {name}");
        *connection = Some((stream, name));
        *verified = false;
        *motion_supported = true;
    }
    let (stream, name) = connection.as_mut().expect("connection populated above");
    let data = read_dump(stream).await.map_err(|error| format!("{name}: {error}"))?;
    if !*verified {
        let product_id = data.get(PRODUCT_ID_REGISTER).copied();
        if product_id != Some(PRODUCT_ID) {
            return Err(format!("{name}: unexpected product id {product_id:?}"));
        }
        *verified = true;
    }
    let motion = if *motion_supported {
        match read_motion_batch(stream).await {
            Ok(blob) => {
                if blob.len() == 8 {
                    None
                } else {
                    Some(blob)
                }
            }
            Err(error) if error.contains("timed out") => {
                warn!(
                    "Arduino Nicla Sense ME motion batches unsupported by firmware on {name}; polling snapshots only"
                );
                *motion_supported = false;
                None
            }
            Err(error) => return Err(format!("{name}: {error}")),
        }
    } else {
        None
    };
    Ok((data, name.clone(), motion))
}

async fn run_usb_board_worker(
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    board: Board,
    poll_interval: Duration,
) {
    let mut connection: Option<(SerialStream, String)> = None;
    let mut verified = false;
    let mut motion_supported = true;
    let mut connected = false;
    let mut last_port = None::<String>;
    let mut last_data = None::<Bytes>;
    let mut last_error = None::<String>;
    let mut tick = interval(poll_interval);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tick.tick().await;

        match poll_usb_once(&mut connection, &mut verified, &mut motion_supported).await {
            Ok((data, port_name, motion)) => {
                if !connected {
                    send_board_signal(
                        &normfs,
                        &rx_queue_id,
                        &board,
                        ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeConnected,
                        Some(&data),
                        None,
                        Some(port_name.as_str()),
                        None,
                    );
                    connected = true;
                }
                send_board_signal(
                    &normfs,
                    &rx_queue_id,
                    &board,
                    ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeRegistersSnapshot,
                    Some(&data),
                    None,
                    Some(port_name.as_str()),
                    motion,
                );
                last_port = Some(port_name);
                last_data = Some(data);
                last_error = None;
            }
            Err(error) => {
                connection = None;
                verified = false;
                if connected {
                    send_board_signal(
                        &normfs,
                        &rx_queue_id,
                        &board,
                        ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeDisconnected,
                        last_data.as_ref(),
                        Some(error.clone()),
                        last_port.as_deref(),
                        None,
                    );
                    connected = false;
                }
                if last_error.as_deref() != Some(error.as_str()) {
                    send_board_signal(
                        &normfs,
                        &rx_queue_id,
                        &board,
                        ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeError,
                        last_data.as_ref(),
                        Some(error.clone()),
                        last_port.as_deref(),
                        None,
                    );
                    last_error = Some(error);
                }
            }
        }
    }
}

fn parse_device_info(data: &[u8]) -> Option<ArduinoNiclaSenseMeDeviceInfo> {
    let serial_end = SERIAL_NUMBER_REGISTER + SERIAL_NUMBER_LENGTH;
    if data.len() < serial_end {
        return None;
    }

    Some(ArduinoNiclaSenseMeDeviceInfo {
        software_revision: data[SOFTWARE_REVISION_REGISTER] as u32,
        product_id: data[PRODUCT_ID_REGISTER] as u32,
        serial_number: Bytes::copy_from_slice(&data[SERIAL_NUMBER_REGISTER..serial_end]),
    })
}

fn send_board_signal(
    normfs: &Arc<NormFS>,
    rx_queue_id: &QueueId,
    board: &Board,
    signal_type: ArduinoNiclaSenseMeSignalType,
    data: Option<&Bytes>,
    error_message: Option<String>,
    usb_port: Option<&str>,
    motion: Option<Bytes>,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        device: Some(board.proto(data.map(|data| data.as_ref()), usb_port)),
        data: data.cloned().unwrap_or_default(),
        motion: motion.unwrap_or_default(),
        error: error_message.unwrap_or_default(),
    };

    if let Err(error) = send_proto(normfs, rx_queue_id, &envelope) {
        error!(
            "Failed to send Arduino Nicla Sense ME {:?} signal for {}: {}",
            signal_type, board.id, error
        );
    }
}

fn send_proto<M: Message>(
    normfs: &NormFS,
    queue_id: &QueueId,
    envelope: &M,
) -> DriverResult<UintN> {
    let mut buffer = Vec::new();
    envelope.encode(&mut buffer)?;
    Ok(normfs.enqueue(queue_id, Bytes::from(buffer))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_id_defaults_to_transport_key() {
        let board = Board::from_config(&ArduinoNiclaSenseMeBoardConfig {
            id: None,
            transport: ArduinoNiclaSenseMeTransport::I2c { i2c_bus: 2 },
        });
        assert_eq!(board.id, "i2c-2");

        let board = Board::from_config(&ArduinoNiclaSenseMeBoardConfig {
            id: Some("  ".to_string()),
            transport: ArduinoNiclaSenseMeTransport::Usb,
        });
        assert_eq!(board.id, "usb");

        let board = Board::from_config(&ArduinoNiclaSenseMeBoardConfig {
            id: Some("imu-front".to_string()),
            transport: ArduinoNiclaSenseMeTransport::Usb,
        });
        assert_eq!(board.id, "imu-front");
    }

    #[test]
    fn parse_device_info_reads_header() {
        let mut data = vec![0u8; RAW_REGISTER_LENGTH];
        data[SOFTWARE_REVISION_REGISTER] = 1;
        data[PRODUCT_ID_REGISTER] = 0x4D;
        data[SERIAL_NUMBER_REGISTER..SERIAL_NUMBER_REGISTER + SERIAL_NUMBER_LENGTH]
            .copy_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);

        let info = parse_device_info(&data).expect("info");
        assert_eq!(info.software_revision, 1);
        assert_eq!(info.product_id, 0x4D);
        assert_eq!(info.serial_number.as_ref(), &[0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);
    }

    #[test]
    fn parse_device_info_rejects_short_buffer() {
        assert!(parse_device_info(&[0u8; 0x10]).is_none());
    }

    #[test]
    fn crc8_matches_check_value() {
        // Standard CRC-8 (poly 0x07, init 0x00) check value for "123456789".
        assert_eq!(crc8(b"123456789"), 0xF4);
        assert_eq!(crc8(&[]), 0x00);
    }

    fn build_frame(payload: &[u8]) -> Vec<u8> {
        let mut frame = vec![0xA5, 0x5A, payload.len() as u8];
        frame.extend_from_slice(payload);
        frame.push(crc8(payload));
        frame
    }

    #[test]
    fn parse_dump_frame_roundtrip() {
        let mut payload = vec![0u8; RAW_REGISTER_LENGTH];
        payload[0x0D] = 0x4D;
        let frame = build_frame(&payload);
        let parsed = parse_dump_frame(&frame).expect("valid frame parses");
        assert_eq!(parsed.as_ref(), payload.as_slice());
    }

    #[test]
    fn parse_dump_frame_rejects_corruption() {
        let payload = vec![0u8; RAW_REGISTER_LENGTH];
        let good = build_frame(&payload);

        let mut bad_magic = good.clone();
        bad_magic[0] = 0x00;
        assert!(parse_dump_frame(&bad_magic).is_err());

        let mut bad_len = good.clone();
        bad_len[2] = 0x10;
        assert!(parse_dump_frame(&bad_len).is_err());

        let mut bad_crc = good.clone();
        *bad_crc.last_mut().unwrap() ^= 0xFF;
        assert!(parse_dump_frame(&bad_crc).is_err());

        assert!(parse_dump_frame(&good[..good.len() - 1]).is_err());
    }

    fn crc_of(parts: &[&[u8]]) -> u8 {
        let mut all = Vec::new();
        for part in parts {
            all.extend_from_slice(part);
        }
        crc8(&all)
    }

    fn build_motion_frame(samples: usize, dropped: u16, first_millis: u32) -> ([u8; 10], Vec<u8>) {
        let count = samples as u16;
        let mut header = [0u8; 10];
        header[0..2].copy_from_slice(&[0xA5, 0x5B]);
        header[2..4].copy_from_slice(&count.to_le_bytes());
        header[4..6].copy_from_slice(&dropped.to_le_bytes());
        header[6..10].copy_from_slice(&first_millis.to_le_bytes());
        let payload = vec![0x11u8; samples * MOTION_SAMPLE_SIZE];
        let crc = crc_of(&[&header[2..], &payload]);
        let mut rest = payload;
        rest.push(crc);
        (header, rest)
    }

    #[test]
    fn check_motion_frame_roundtrip() {
        let (header, rest) = build_motion_frame(3, 7, 123_456);
        let blob = check_motion_frame(&header, &rest).expect("valid frame parses");
        assert_eq!(blob.len(), 8 + 3 * MOTION_SAMPLE_SIZE);
        assert_eq!(&blob[0..2], &3u16.to_le_bytes());
        assert_eq!(&blob[2..4], &7u16.to_le_bytes());
        assert_eq!(&blob[4..8], &123_456u32.to_le_bytes());
    }

    #[test]
    fn check_motion_frame_accepts_empty_batch() {
        let (header, rest) = build_motion_frame(0, 0, 0);
        let blob = check_motion_frame(&header, &rest).expect("empty frame parses");
        assert_eq!(blob.len(), 8);
    }

    #[test]
    fn check_motion_frame_rejects_corruption() {
        let (mut header, rest) = build_motion_frame(2, 0, 42);
        header[1] = 0x5A; // wrong frame type
        assert!(check_motion_frame(&header, &rest).is_err());

        let (header, mut rest) = build_motion_frame(2, 0, 42);
        *rest.last_mut().unwrap() ^= 0xFF; // bad crc
        assert!(check_motion_frame(&header, &rest).is_err());

        let (header, rest) = build_motion_frame(2, 0, 42);
        assert!(check_motion_frame(&header, &rest[..rest.len() - 1]).is_err()); // short
    }
}

use crate::arduino_nicla_sense_me_proto::{
    ArduinoNiclaSenseMeDevice, ArduinoNiclaSenseMeDeviceInfo, ArduinoNiclaSenseMeSignalType,
    RxEnvelope,
};
use bytes::Bytes;
use log::{debug, error, info, warn};
use normfs::{NormFS, QueueId};
use prost::Message;
use station_iface::iface_proto::drivers::QueueDataType;
use station_iface::{Backpressure, StationEngine, enqueue_with};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::task::JoinHandle;
use tokio_serial::{SerialPort, SerialPortBuilderExt, SerialStream};

/// Queue name prefix; each board gets `<prefix>/<serial-hex>/rx`.
pub const RX_QUEUE_PREFIX: &str = "arduino-nicla-sense-me";
pub const RAW_REGISTER_LENGTH: usize = 0xA8;

const SOFTWARE_REVISION_REGISTER: usize = 0x0C;
const PRODUCT_ID_REGISTER: usize = 0x0D;
const SERIAL_NUMBER_REGISTER: usize = 0x0E;
const SERIAL_NUMBER_LENGTH: usize = 6;

pub const USB_VID: u16 = 0x2341;
pub const USB_PID: u16 = 0x0060;
/// Starts streaming (one frame per firmware tick) and doubles as the
/// keepalive: the firmware stops streaming unless it sees this again
/// within 2s, so a dead host cannot leave the board transmitting.
pub const SERIAL_CMD_STREAM_START: u8 = 0x02;
/// Stops streaming immediately.
pub const SERIAL_CMD_STREAM_STOP: u8 = 0x03;
const SERIAL_MAGIC: [u8; 2] = [0xA5, 0x5A];
const SERIAL_FRAME_LEN: usize = 3 + RAW_REGISTER_LENGTH + 1;
/// Read size for the frame scanner: several frames of headroom so a
/// backlog drains in a few syscalls rather than one per byte.
const SERIAL_READ_CHUNK: usize = 4 * SERIAL_FRAME_LEN;
/// Real UART baud of the SAMD11 usb-bridge link; must match the firmware's
/// Serial.begin. 115200 capped polling at ~50 Hz (~15 ms per 172-byte dump).
pub const SERIAL_BAUD: u32 = 921_600;
const SERIAL_RESPONSE_TIMEOUT: Duration = Duration::from_millis(500);
/// Re-send the stream keepalive well within the firmware's 2s expiry.
const STREAM_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(1);
/// Frames arrive every ~10ms while streaming; a second of silence means
/// the stream is dead (unplugged, or pre-streaming firmware).
const STREAM_FRAME_TIMEOUT: Duration = Duration::from_secs(1);
/// Pace a port worker's retry loop while its link is erroring (a healthy
/// stream paces itself by frame arrival instead).
const STREAM_ERROR_RETRY: Duration = Duration::from_millis(500);
/// A link reports frames its scanner had to discard at most this often.
const BAD_FRAME_REPORT_INTERVAL: Duration = Duration::from_secs(10);
/// How often the driver re-enumerates serial ports for new boards.
/// Enumeration walks the OS device tree (sysfs/IOKit), so keep it slow.
const USB_DISCOVER_INTERVAL: Duration = Duration::from_millis(500);
const PRODUCT_ID: u8 = 0x4D;

type DriverResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// Lower-case hex of a board serial (the register-map bytes 0x0E..0x13).
pub fn serial_hex(serial: &[u8]) -> String {
    serial.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Queue a board's envelopes go to, keyed by its serial number so the same
/// physical board keeps its queue across re-plugs and port renames.
pub fn rx_queue_id(serial: &[u8]) -> String {
    format!("{RX_QUEUE_PREFIX}/{}/rx", serial_hex(serial))
}

pub struct ArduinoNiclaSenseMeDriver {
    _discovery: JoinHandle<()>,
}

impl ArduinoNiclaSenseMeDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
    ) -> DriverResult<Self> {
        let discovery = tokio::spawn(run_discovery(normfs, station_engine));
        info!("Started Arduino Nicla Sense ME driver (USB autodetect, vid 2341 pid 0060)");
        Ok(Self {
            _discovery: discovery,
        })
    }
}

pub async fn start_arduino_nicla_sense_me_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
) -> DriverResult<Arc<ArduinoNiclaSenseMeDriver>> {
    let driver = ArduinoNiclaSenseMeDriver::new(normfs, station_engine).await?;
    Ok(Arc::new(driver))
}

/// Re-enumerates matching serial ports and spawns one worker per port not
/// already owned by a worker. Mirrors the usbvideo camera watcher: a worker
/// owns its port for as long as the OS keeps listing it, and releases it on
/// exit so a re-plug (possibly under a new path) is picked up here again.
async fn run_discovery<T: StationEngine>(normfs: Arc<NormFS>, station_engine: Arc<T>) {
    let owned_ports: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    loop {
        for port in list_usb_ports() {
            if !owned_ports.lock().unwrap().insert(port.clone()) {
                continue;
            }
            info!("Discovered Arduino Nicla Sense ME candidate port {port}");
            let normfs = normfs.clone();
            let station_engine = station_engine.clone();
            let owned_ports = owned_ports.clone();
            tokio::spawn(async move {
                run_port_worker(normfs, station_engine, port.clone()).await;
                owned_ports.lock().unwrap().remove(&port);
            });
        }
        tokio::time::sleep(USB_DISCOVER_INTERVAL).await;
    }
}

fn crc8(data: &[u8]) -> u8 {
    let mut crc: u8 = 0;
    for &byte in data {
        crc ^= byte;
        for _ in 0..8 {
            crc = if crc & 0x80 != 0 {
                (crc << 1) ^ 0x07
            } else {
                crc << 1
            };
        }
    }
    crc
}

fn parse_dump_frame(frame: &[u8]) -> Result<Bytes, String> {
    if frame.len() != SERIAL_FRAME_LEN {
        return Err(format!("unexpected frame length {}", frame.len()));
    }
    if frame[0..2] != SERIAL_MAGIC {
        return Err(format!(
            "bad frame magic {:#04x} {:#04x}",
            frame[0], frame[1]
        ));
    }
    if frame[2] as usize != RAW_REGISTER_LENGTH {
        return Err(format!("bad payload length {:#04x}", frame[2]));
    }
    let payload = &frame[3..3 + RAW_REGISTER_LENGTH];
    let expected = frame[3 + RAW_REGISTER_LENGTH];
    let computed = crc8(payload);
    if computed != expected {
        return Err(format!(
            "crc mismatch: computed {computed:#04x}, frame has {expected:#04x}"
        ));
    }
    Ok(Bytes::copy_from_slice(payload))
}

/// All serial ports whose USB ids match the Nicla's SAMD11 bridge.
pub fn list_usb_ports() -> Vec<String> {
    let Ok(ports) = tokio_serial::available_ports() else {
        return Vec::new();
    };
    ports
        .into_iter()
        .filter_map(|port| match &port.port_type {
            tokio_serial::SerialPortType::UsbPort(usb)
                if usb.vid == USB_VID && usb.pid == USB_PID =>
            {
                // On macOS both /dev/tty.* and /dev/cu.* enumerate for one
                // device; prefer the callout (cu) device for host-initiated
                // CDC traffic. (Deliberate divergence from vesc-trampa,
                // which prefers tty; validated against real hardware — if
                // the probe hangs on open, flip this filter.)
                #[cfg(target_os = "macos")]
                if port.port_name.starts_with("/dev/tty.") {
                    return None;
                }
                Some(port.port_name)
            }
            _ => None,
        })
        .collect()
}

/// Prepares a freshly opened port: asserts DTR (the mbed-core USB CDC stack
/// treats the port as closed until the host raises DTR), stops any stream a
/// previous host left running (the firmware would otherwise keep pushing
/// for up to 2 s), and clears what has already arrived. Run once per
/// connection — per-request ioctls cost milliseconds on macOS.
pub async fn prepare_port(port: &mut SerialStream) -> Result<(), String> {
    port.write_data_terminal_ready(true)
        .map_err(|error| format!("failed to assert DTR: {error}"))?;
    port.write_all(&[SERIAL_CMD_STREAM_STOP])
        .await
        .map_err(|error| format!("failed to send stream stop: {error}"))?;
    // Let the firmware see the stop and finish the frame it may be pushing
    // (~2 ms on the wire) before discarding the input.
    tokio::time::sleep(Duration::from_millis(20)).await;
    port.clear(tokio_serial::ClearBuffer::Input)
        .map_err(|error| format!("failed to clear input buffer: {error}"))?;
    Ok(())
}

/// Incremental scanner over the serial byte stream. Bytes accumulate in
/// `pending`; `next_frame` returns the first complete, valid frame and
/// discards everything before it. A magic match that fails validation (a
/// payload byte pair when joining mid-stream, or real corruption) advances
/// the search by one byte, so no static payload pattern can lock the scan
/// onto a fixed offset of every frame.
#[derive(Default)]
pub struct FrameScanner {
    pending: Vec<u8>,
    bad_frames: u32,
}

impl FrameScanner {
    pub fn push(&mut self, bytes: &[u8]) {
        self.pending.extend_from_slice(bytes);
    }

    /// The next valid frame's payload, or None when more bytes are needed.
    pub fn next_frame(&mut self) -> Option<Bytes> {
        let mut search_from = 0;
        while let Some(offset) = find_magic(&self.pending[search_from..]) {
            let start = search_from + offset;
            if self.pending.len() - start < SERIAL_FRAME_LEN {
                self.pending.drain(..start);
                return None;
            }
            match parse_dump_frame(&self.pending[start..start + SERIAL_FRAME_LEN]) {
                Ok(payload) => {
                    self.pending.drain(..start + SERIAL_FRAME_LEN);
                    return Some(payload);
                }
                Err(_) => {
                    self.bad_frames += 1;
                    search_from = start + 1;
                }
            }
        }
        // No frame start in sight: keep only a possible leading magic byte.
        let keep = usize::from(self.pending.last() == Some(&SERIAL_MAGIC[0]));
        self.pending.drain(..self.pending.len() - keep);
        None
    }

    /// Frames that matched the magic but failed length/CRC validation
    /// since the last call. Expect one when joining a stream mid-frame.
    pub fn take_bad_frames(&mut self) -> u32 {
        std::mem::take(&mut self.bad_frames)
    }
}

fn find_magic(bytes: &[u8]) -> Option<usize> {
    bytes.windows(2).position(|pair| pair == SERIAL_MAGIC)
}

/// Reads from the port until the scanner yields one valid frame, or
/// `timeout` passes without one.
pub async fn read_frame(
    port: &mut SerialStream,
    scanner: &mut FrameScanner,
    timeout: Duration,
) -> Result<Bytes, String> {
    tokio::time::timeout(timeout, async {
        loop {
            if let Some(payload) = scanner.next_frame() {
                return Ok(payload);
            }
            let mut chunk = [0u8; SERIAL_READ_CHUNK];
            let read = port
                .read(&mut chunk)
                .await
                .map_err(|error| format!("failed to read serial port: {error}"))?;
            if read == 0 {
                return Err("serial port closed".to_string());
            }
            scanner.push(&chunk[..read]);
        }
    })
    .await
    .map_err(|_| format!("no valid frame within {timeout:?}"))?
}

/// Per-board queue, established once the first frame reveals the serial.
struct BoardQueue {
    queue_id: QueueId,
    device_id: String,
    port: String,
}

impl BoardQueue {
    async fn open<T: StationEngine>(
        normfs: &Arc<NormFS>,
        station_engine: &Arc<T>,
        serial: &[u8],
        port: &str,
    ) -> DriverResult<Self> {
        let queue_id = normfs.resolve(&rx_queue_id(serial));
        normfs.ensure_queue_exists_for_write(&queue_id).await?;
        station_engine.register_queue(&queue_id, QueueDataType::QdtArduinoNiclaSenseMeRx, vec![]);
        Ok(Self {
            queue_id,
            device_id: serial_hex(serial),
            port: port.to_string(),
        })
    }

    fn proto(&self, data: Option<&[u8]>) -> ArduinoNiclaSenseMeDevice {
        ArduinoNiclaSenseMeDevice {
            id: self.device_id.clone(),
            usb_port: self.port.clone(),
            info: data.and_then(parse_device_info),
        }
    }
}

struct UsbLink {
    port: String,
    stream: Option<SerialStream>,
    scanner: FrameScanner,
    verified: bool,
    /// When the next STREAM_START keepalive is due; None = stream not
    /// started yet on this connection.
    next_keepalive: Option<tokio::time::Instant>,
    /// Discarded frames on this connection not yet reported, and when the
    /// next report may go out.
    bad_frames: u32,
    next_bad_frame_report: Option<tokio::time::Instant>,
}

impl UsbLink {
    fn new(port: String) -> Self {
        Self {
            port,
            stream: None,
            scanner: FrameScanner::default(),
            verified: false,
            next_keepalive: None,
            bad_frames: 0,
            next_bad_frame_report: None,
        }
    }

    async fn disconnect(&mut self) {
        if let Some(mut stream) = self.stream.take() {
            // Best effort: stop the firmware pushing into a port nobody
            // reads (it would expire on its own after 2 s).
            let _ = tokio::time::timeout(
                Duration::from_millis(50),
                stream.write_all(&[SERIAL_CMD_STREAM_STOP]),
            )
            .await;
        }
        self.scanner = FrameScanner::default();
        self.verified = false;
        self.next_keepalive = None;
        self.bad_frames = 0;
        self.next_bad_frame_report = None;
    }

    async fn connect(&mut self) -> Result<(), String> {
        let name = &self.port;
        let mut stream = tokio_serial::new(name, SERIAL_BAUD)
            .timeout(SERIAL_RESPONSE_TIMEOUT)
            .open_native_async()
            .map_err(|error| format!("failed to open {name}: {error}"))?;
        prepare_port(&mut stream)
            .await
            .map_err(|error| format!("{name}: {error}"))?;
        debug!("Opened Arduino Nicla Sense ME USB port {name}");
        self.stream = Some(stream);
        self.scanner = FrameScanner::default();
        self.verified = false;
        self.next_keepalive = None;
        self.bad_frames = 0;
        self.next_bad_frame_report = None;
        Ok(())
    }

    /// Yields the next register image from the stream, (re)connecting as
    /// needed. Any failure drops the connection and is returned as a message.
    async fn poll(&mut self) -> Result<Bytes, String> {
        if self.stream.is_none() {
            self.connect().await?;
        }
        let name = self.port.clone();

        // Start the stream / refresh the firmware's keepalive deadline.
        let now = tokio::time::Instant::now();
        if self.next_keepalive.is_none_or(|due| now >= due) {
            let stream = self.stream.as_mut().expect("connection populated above");
            if let Err(write_error) = stream.write_all(&[SERIAL_CMD_STREAM_START]).await {
                self.disconnect().await;
                return Err(format!(
                    "{name}: failed to send stream keepalive: {write_error}"
                ));
            }
            self.next_keepalive = Some(now + STREAM_KEEPALIVE_INTERVAL);
        }

        let outcome = {
            let stream = self.stream.as_mut().expect("connection populated above");
            read_frame(stream, &mut self.scanner, STREAM_FRAME_TIMEOUT).await
        };
        match outcome {
            Ok(data) => {
                let bad_frames = self.scanner.take_bad_frames();
                if !self.verified {
                    let product_id = data.get(PRODUCT_ID_REGISTER).copied();
                    if product_id != Some(PRODUCT_ID) {
                        self.disconnect().await;
                        return Err(format!("{name}: unexpected product id {product_id:?}"));
                    }
                    self.verified = true;
                } else {
                    // Discards on the first frame are the mid-stream join;
                    // afterwards they mean corruption or a backlog overflow.
                    // Report them, rate-limited, rather than dropping silently.
                    self.bad_frames += bad_frames;
                    if self.bad_frames > 0
                        && self.next_bad_frame_report.is_none_or(|due| now >= due)
                    {
                        warn!(
                            "Arduino Nicla Sense ME {name}: discarded {} corrupt or misaligned \
                             frame(s) since the last report",
                            self.bad_frames
                        );
                        self.bad_frames = 0;
                        self.next_bad_frame_report = Some(now + BAD_FRAME_REPORT_INTERVAL);
                    }
                }
                Ok(data)
            }
            Err(message) => {
                // Any stream failure (silence, port error) reconnects; the
                // frame scanner already absorbed recoverable corruption.
                self.disconnect().await;
                Err(format!(
                    "{name}: {message} (board unplugged, or its firmware predates \
                     streaming and needs reflashing)"
                ))
            }
        }
    }
}

/// Streams one port for as long as the OS lists it. The queue is created
/// from the serial in the first valid frame; until then failures can only
/// be logged. Once the port disappears from enumeration the worker exits
/// (after a DISCONNECTED signal if it ever connected) and discovery may
/// spawn a fresh one when the board comes back.
async fn run_port_worker<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    port: String,
) {
    let mut link = UsbLink::new(port.clone());
    let mut queue = None::<BoardQueue>;
    let mut connected = false;
    let mut last_data = None::<Bytes>;
    let mut last_error = None::<String>;

    loop {
        match link.poll().await {
            Ok(data) => {
                if queue.is_none() {
                    let Some(info) = parse_device_info(&data) else {
                        // Cannot happen for a CRC-valid full-length frame.
                        error!("Arduino Nicla Sense ME {port}: frame too short for the header");
                        link.disconnect().await;
                        tokio::time::sleep(STREAM_ERROR_RETRY).await;
                        continue;
                    };
                    match BoardQueue::open(&normfs, &station_engine, &info.serial_number, &port)
                        .await
                    {
                        Ok(board_queue) => {
                            info!(
                                "Arduino Nicla Sense ME {} (firmware rev {}) on {port} -> {}",
                                board_queue.device_id, info.software_revision, board_queue.queue_id
                            );
                            queue = Some(board_queue);
                        }
                        Err(open_error) => {
                            error!(
                                "Arduino Nicla Sense ME {port}: failed to open queue for serial \
                                 {}: {open_error}",
                                serial_hex(&info.serial_number)
                            );
                            link.disconnect().await;
                            tokio::time::sleep(STREAM_ERROR_RETRY).await;
                            continue;
                        }
                    }
                }
                let board_queue = queue.as_ref().expect("queue populated above");
                if !connected {
                    send_board_signal(
                        &normfs,
                        board_queue,
                        ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeConnected,
                        Some(&data),
                        None,
                    )
                    .await;
                    connected = true;
                }
                send_board_signal(
                    &normfs,
                    board_queue,
                    ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeRegistersSnapshot,
                    Some(&data),
                    None,
                )
                .await;
                last_data = Some(data);
                last_error = None;
            }
            Err(poll_error) => {
                let port_present = list_usb_ports().contains(&port);
                if let Some(board_queue) = &queue {
                    if connected {
                        send_board_signal(
                            &normfs,
                            board_queue,
                            ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeDisconnected,
                            last_data.as_ref(),
                            Some(poll_error.clone()),
                        )
                        .await;
                        connected = false;
                    }
                    if port_present && last_error.as_deref() != Some(poll_error.as_str()) {
                        send_board_signal(
                            &normfs,
                            board_queue,
                            ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeError,
                            last_data.as_ref(),
                            Some(poll_error.clone()),
                        )
                        .await;
                    }
                } else if port_present && last_error.as_deref() != Some(poll_error.as_str()) {
                    warn!("Arduino Nicla Sense ME {port}: {poll_error}");
                }
                last_error = Some(poll_error);
                if !port_present {
                    info!("Arduino Nicla Sense ME port {port} is gone; releasing it");
                    return;
                }
                // A failing link returns quickly; pace the retry loop
                // instead of spinning.
                tokio::time::sleep(STREAM_ERROR_RETRY).await;
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

async fn send_board_signal(
    normfs: &Arc<NormFS>,
    queue: &BoardQueue,
    signal_type: ArduinoNiclaSenseMeSignalType,
    data: Option<&Bytes>,
    error_message: Option<String>,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        device: Some(queue.proto(data.map(|data| data.as_ref()))),
        data: data.cloned().unwrap_or_default(),
        error: error_message.unwrap_or_default(),
    };

    let policy =
        if signal_type == ArduinoNiclaSenseMeSignalType::ArduinoNiclaSenseMeRegistersSnapshot {
            Backpressure::Skip
        } else {
            Backpressure::Keep
        };
    if let Err(send_error) = send_proto(normfs, &queue.queue_id, &envelope, policy).await {
        error!(
            "Failed to send Arduino Nicla Sense ME {:?} signal for {}: {}",
            signal_type, queue.device_id, send_error
        );
    }
}

async fn send_proto<M: Message>(
    normfs: &NormFS,
    queue_id: &QueueId,
    envelope: &M,
    policy: Backpressure,
) -> DriverResult<()> {
    let mut buffer = Vec::new();
    envelope.encode(&mut buffer)?;
    Ok(enqueue_with(normfs, queue_id, Bytes::from(buffer), policy).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(
            info.serial_number.as_ref(),
            &[0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]
        );
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
    fn frame_scanner_joins_mid_stream_and_survives_false_magic_in_payload() {
        // A static payload pair equal to the magic (e.g. inside the serial
        // number) must not lock the scanner onto that offset.
        let mut payload = vec![0u8; RAW_REGISTER_LENGTH];
        payload[SERIAL_NUMBER_REGISTER] = SERIAL_MAGIC[0];
        payload[SERIAL_NUMBER_REGISTER + 1] = SERIAL_MAGIC[1];
        payload[0x20] = 1;
        let frame = build_frame(&payload);

        // Join exactly at the false magic of frame 0, then two full frames.
        let mut stream = frame[3 + SERIAL_NUMBER_REGISTER..].to_vec();
        stream.extend_from_slice(&frame);
        stream.extend_from_slice(&frame);

        let mut scanner = FrameScanner::default();
        scanner.push(&stream);
        assert_eq!(scanner.next_frame().as_deref(), Some(payload.as_slice()));
        assert_eq!(scanner.next_frame().as_deref(), Some(payload.as_slice()));
        assert_eq!(scanner.next_frame(), None);
        assert!(scanner.take_bad_frames() >= 1);
        assert_eq!(scanner.take_bad_frames(), 0);
    }

    #[test]
    fn frame_scanner_handles_split_reads_and_repeated_magic_byte() {
        let payload = vec![7u8; RAW_REGISTER_LENGTH];
        let frame = build_frame(&payload);
        let mut scanner = FrameScanner::default();

        // A stray magic byte right before a real frame start.
        scanner.push(&[SERIAL_MAGIC[0]]);
        scanner.push(&frame[..100]);
        assert_eq!(scanner.next_frame(), None);
        scanner.push(&frame[100..]);
        assert_eq!(scanner.next_frame().as_deref(), Some(payload.as_slice()));
        assert_eq!(scanner.take_bad_frames(), 0);
    }

    #[test]
    fn frame_scanner_counts_and_skips_corrupt_frames() {
        let payload = vec![3u8; RAW_REGISTER_LENGTH];
        let good = build_frame(&payload);
        let mut bad = good.clone();
        *bad.last_mut().unwrap() ^= 0xFF;

        let mut scanner = FrameScanner::default();
        scanner.push(&bad);
        scanner.push(&good);
        assert_eq!(scanner.next_frame().as_deref(), Some(payload.as_slice()));
        assert_eq!(scanner.take_bad_frames(), 1);
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

    #[test]
    fn rx_queue_id_is_derived_from_the_serial_number() {
        let mut data = vec![0u8; RAW_REGISTER_LENGTH];
        data[SERIAL_NUMBER_REGISTER..SERIAL_NUMBER_REGISTER + SERIAL_NUMBER_LENGTH]
            .copy_from_slice(&[0x0A, 0xBB, 0xCC, 0xDD, 0xEE, 0x0F]);
        let info = parse_device_info(&data).expect("info");
        assert_eq!(serial_hex(&info.serial_number), "0abbccddee0f");
        assert_eq!(
            rx_queue_id(&info.serial_number),
            "arduino-nicla-sense-me/0abbccddee0f/rx"
        );
    }
}

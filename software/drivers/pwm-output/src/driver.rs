use crate::pwm_output_proto::{
    Command, OutputState, PwmOutputDevice, PwmOutputSignalType, RxEnvelope, TxEnvelope,
    WaveCommand, WaveLevel,
};
use bytes::{BufMut, Bytes, BytesMut};
use log::{error, info, warn};
use normfs::{NormFS, QueueId};
use parking_lot::Mutex;
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::{commands, drivers};
use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Arc;

pub const RX_QUEUE_ID: &str = "pwm-output/rx";
pub const TX_QUEUE_ID: &str = "pwm-output/tx";
pub const DEFAULT_DEVICE_PATH: &str = "/dev/x8h7_ui";

const FRAME_MAGIC: &[u8; 4] = b"NCWV";
const FRAME_VERSION: u8 = 1;
const FRAME_HEADER_LEN: usize = 9;
const RPC_NOTIFY: u8 = 2;
const RPC_METHOD_PWM_FRAME: &str = "pwmFrame";

type DriverResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct PwmOutputDriverConfig {
    pub device_path: PathBuf,
    pub outputs: Vec<PwmOutputDeviceConfig>,
}

impl Default for PwmOutputDriverConfig {
    fn default() -> Self {
        Self {
            device_path: PathBuf::from(DEFAULT_DEVICE_PATH),
            outputs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PwmOutputDeviceConfig {
    pub id: String,
}

#[derive(Debug, Clone)]
struct OutputRuntime {
    config: PwmOutputDeviceConfig,
    state: OutputState,
}

pub struct PwmOutputDriver {
    _outputs: Arc<Mutex<BTreeMap<String, OutputRuntime>>>,
    _transport: Arc<H7WaveTransport>,
}

impl PwmOutputDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        config: PwmOutputDriverConfig,
    ) -> DriverResult<Self> {
        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);
        let tx_queue_id = normfs.resolve(TX_QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&tx_queue_id).await?;
        station_engine.register_queue(&rx_queue_id, drivers::QueueDataType::QdtPwmOutputRx, vec![]);
        station_engine.register_queue(&tx_queue_id, drivers::QueueDataType::QdtPwmOutputTx, vec![]);

        if config.outputs.is_empty() {
            warn!("PWM output driver enabled with no outputs configured");
        }

        let mut outputs = BTreeMap::new();
        for output_config in config.outputs {
            validate_output_config(&output_config)?;
            if outputs.contains_key(&output_config.id) {
                return Err(format!("duplicate PWM output id '{}'", output_config.id).into());
            }

            let runtime = OutputRuntime::new(output_config);
            send_rx(
                &normfs,
                &rx_queue_id,
                PwmOutputSignalType::PwmOutputConfigured,
                Some(runtime.device_proto()),
                Some(runtime.state.clone()),
                None,
                None,
            );
            outputs.insert(runtime.config.id.clone(), runtime);
        }

        let outputs = Arc::new(Mutex::new(outputs));
        let transport = Arc::new(H7WaveTransport::new(config.device_path));
        subscribe_commands(
            normfs.clone(),
            rx_queue_id.clone(),
            tx_queue_id,
            outputs.clone(),
            transport.clone(),
        )?;

        info!(
            "Started PWM output M4 RPC wave driver with transport {}",
            transport.path.display()
        );
        Ok(Self {
            _outputs: outputs,
            _transport: transport,
        })
    }
}

pub async fn start_pwm_output_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: PwmOutputDriverConfig,
) -> DriverResult<Arc<PwmOutputDriver>> {
    let driver = PwmOutputDriver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

fn subscribe_commands(
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    tx_queue_id: QueueId,
    outputs: Arc<Mutex<BTreeMap<String, OutputRuntime>>>,
    transport: Arc<H7WaveTransport>,
) -> Result<(), normfs::Error> {
    let commands_queue_id = normfs.resolve(station_iface::COMMANDS_QUEUE_ID);
    let callback_normfs = normfs.clone();
    normfs.subscribe(
        &commands_queue_id,
        Box::new(move |entries: &[(normfs::UintN, Bytes)]| {
            for (_, data) in entries {
                let pack = match commands::StationCommandsPack::decode(data.as_ref()) {
                    Ok(pack) => pack,
                    Err(error) => {
                        error!("Failed to decode StationCommandsPack: {}", error);
                        continue;
                    }
                };

                for command in &pack.commands {
                    if command.r#type() != drivers::StationCommandType::StcPwmOutputCommand {
                        continue;
                    }

                    let decoded = match Command::decode(command.body.as_ref()) {
                        Ok(command) => command,
                        Err(error) => {
                            error!("Failed to decode PWM output command: {}", error);
                            continue;
                        }
                    };

                    let envelope = TxEnvelope {
                        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                        local_stamp_ns: systime::get_local_stamp_ns(),
                        app_start_id: systime::get_app_start_id(),
                        command_id: command.command_id.clone(),
                        target_output_id: decoded.target_output_id.clone(),
                        command: Some(decoded),
                    };

                    if let Err(error) = send_tx(&callback_normfs, &tx_queue_id, &envelope) {
                        error!("Failed to publish PWM output TX command: {}", error);
                    }
                    process_command(
                        &callback_normfs,
                        &rx_queue_id,
                        &outputs,
                        &transport,
                        envelope,
                    );
                }
            }
            true
        }),
    )?;

    Ok(())
}

fn process_command(
    normfs: &Arc<NormFS>,
    rx_queue_id: &QueueId,
    outputs: &Arc<Mutex<BTreeMap<String, OutputRuntime>>>,
    transport: &Arc<H7WaveTransport>,
    envelope: TxEnvelope,
) {
    send_rx(
        normfs,
        rx_queue_id,
        PwmOutputSignalType::PwmOutputCommand,
        None,
        None,
        Some(envelope.clone()),
        None,
    );

    let Some(command) = envelope.command.clone() else {
        send_rx(
            normfs,
            rx_queue_id,
            PwmOutputSignalType::PwmOutputCommandRejected,
            None,
            None,
            Some(envelope),
            Some("missing command body".to_string()),
        );
        return;
    };

    let target_output_id = command.target_output_id.clone();
    if target_output_id.trim().is_empty() {
        send_rx(
            normfs,
            rx_queue_id,
            PwmOutputSignalType::PwmOutputCommandRejected,
            None,
            None,
            Some(envelope),
            Some("missing target_output_id".to_string()),
        );
        return;
    }

    let mut outputs = outputs.lock();
    let Some(output) = outputs.get_mut(target_output_id.as_str()) else {
        send_rx(
            normfs,
            rx_queue_id,
            PwmOutputSignalType::PwmOutputCommandRejected,
            None,
            None,
            Some(envelope),
            Some(format!("unknown PWM output '{}'", target_output_id)),
        );
        return;
    };

    let device = output.device_proto();
    match output.apply_command(&command, &envelope, transport) {
        Ok(()) => {
            send_rx(
                normfs,
                rx_queue_id,
                PwmOutputSignalType::PwmOutputCommandSuccess,
                Some(device),
                Some(output.state.clone()),
                Some(envelope),
                None,
            );
        }
        Err(CommandError::Rejected(message)) => {
            send_rx(
                normfs,
                rx_queue_id,
                PwmOutputSignalType::PwmOutputCommandRejected,
                Some(device),
                Some(output.state.clone()),
                Some(envelope),
                Some(message),
            );
        }
        Err(CommandError::Failed(error)) => {
            send_rx(
                normfs,
                rx_queue_id,
                PwmOutputSignalType::PwmOutputCommandFailed,
                Some(device),
                Some(output.state.clone()),
                Some(envelope),
                Some(error.to_string()),
            );
        }
    }
}

fn send_tx(normfs: &Arc<NormFS>, queue_id: &QueueId, envelope: &TxEnvelope) -> DriverResult<()> {
    let mut buf = Vec::new();
    envelope.encode(&mut buf)?;
    normfs.enqueue(queue_id, Bytes::from(buf))?;
    Ok(())
}

fn send_rx(
    normfs: &Arc<NormFS>,
    queue_id: &QueueId,
    signal_type: PwmOutputSignalType,
    device: Option<PwmOutputDevice>,
    state: Option<OutputState>,
    command: Option<TxEnvelope>,
    error_message: Option<String>,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        device,
        state,
        command,
        error: error_message.unwrap_or_default(),
    };

    let mut buf = Vec::new();
    if let Err(error) = envelope.encode(&mut buf) {
        error!("Failed to encode PWM output RX envelope: {}", error);
        return;
    }
    if let Err(error) = normfs.enqueue(queue_id, Bytes::from(buf)) {
        error!("Failed to publish PWM output RX envelope: {}", error);
    }
}

impl OutputRuntime {
    fn new(config: PwmOutputDeviceConfig) -> Self {
        let state = OutputState {
            id: config.id.clone(),
            enabled: false,
            wave: None,
        };
        Self { config, state }
    }

    fn apply_command(
        &mut self,
        command: &Command,
        envelope: &TxEnvelope,
        transport: &H7WaveTransport,
    ) -> Result<(), CommandError> {
        let variant_count =
            usize::from(command.wave.is_some()) + usize::from(command.disable.is_some());
        if variant_count != 1 {
            return Err(CommandError::Rejected(format!(
                "expected exactly one command variant, got {variant_count}"
            )));
        }

        if let Some(wave) = command.wave.as_ref() {
            validate_wave(wave)?;
            transport
                .send_envelope(envelope)
                .map_err(CommandError::Failed)?;
            self.state.wave = Some(wave.clone());
            self.state.enabled = true;
            return Ok(());
        }

        if command.disable.is_some() {
            transport
                .send_envelope(envelope)
                .map_err(CommandError::Failed)?;
            self.state.enabled = false;
            self.state.wave = None;
            return Ok(());
        }

        unreachable!("command variant count checked above")
    }

    fn device_proto(&self) -> PwmOutputDevice {
        PwmOutputDevice {
            id: self.config.id.clone(),
        }
    }
}

#[derive(Debug)]
enum CommandError {
    Rejected(String),
    Failed(io::Error),
}

#[derive(Debug)]
struct H7WaveTransport {
    path: PathBuf,
}

impl H7WaveTransport {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn send_envelope(&self, envelope: &TxEnvelope) -> io::Result<()> {
        let mut payload = BytesMut::with_capacity(envelope.encoded_len());
        envelope
            .encode(&mut payload)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let frame = encode_frame(payload.freeze())?;
        let rpc = encode_rpc_notify(RPC_METHOD_PWM_FRAME, frame.as_ref())?;
        let mut file = OpenOptions::new().write(true).open(&self.path)?;
        file.write_all(rpc.as_ref())?;
        file.flush()
    }
}

fn encode_rpc_notify(method: &str, arg: &[u8]) -> io::Result<Bytes> {
    let mut frame = BytesMut::with_capacity(16 + method.len() + arg.len());
    frame.put_u8(0x93); // [type, method, params]
    frame.put_u8(RPC_NOTIFY);
    put_msgpack_str(&mut frame, method)?;
    frame.put_u8(0x91); // one positional argument
    put_msgpack_bin(&mut frame, arg)?;
    Ok(frame.freeze())
}

fn put_msgpack_str(buf: &mut BytesMut, value: &str) -> io::Result<()> {
    let len = value.len();
    if len <= 31 {
        buf.put_u8(0xa0 | u8::try_from(len).expect("fixstr length fits in u8"));
    } else if let Ok(len_u8) = u8::try_from(len) {
        buf.put_u8(0xd9);
        buf.put_u8(len_u8);
    } else if let Ok(len_u16) = u16::try_from(len) {
        buf.put_u8(0xda);
        buf.put_u16(len_u16);
    } else {
        let len_u32 = u32::try_from(len).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("msgpack string is too large: {len}"),
            )
        })?;
        buf.put_u8(0xdb);
        buf.put_u32(len_u32);
    }
    buf.extend_from_slice(value.as_bytes());
    Ok(())
}

fn put_msgpack_bin(buf: &mut BytesMut, value: &[u8]) -> io::Result<()> {
    let len = value.len();
    if let Ok(len_u8) = u8::try_from(len) {
        buf.put_u8(0xc4);
        buf.put_u8(len_u8);
    } else if let Ok(len_u16) = u16::try_from(len) {
        buf.put_u8(0xc5);
        buf.put_u16(len_u16);
    } else {
        let len_u32 = u32::try_from(len).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("msgpack binary payload is too large: {len}"),
            )
        })?;
        buf.put_u8(0xc6);
        buf.put_u32(len_u32);
    }
    buf.extend_from_slice(value);
    Ok(())
}

fn encode_frame(payload: Bytes) -> io::Result<Bytes> {
    let len = u32::try_from(payload.len()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("PWM output command payload is too large: {}", payload.len()),
        )
    })?;
    let mut frame = BytesMut::with_capacity(FRAME_HEADER_LEN + payload.len() + 4);
    frame.extend_from_slice(FRAME_MAGIC);
    frame.put_u8(FRAME_VERSION);
    frame.put_u32_le(len);
    frame.extend_from_slice(payload.as_ref());
    let crc = crc32(frame.as_ref());
    frame.put_u32_le(crc);
    Ok(frame.freeze())
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn validate_output_config(config: &PwmOutputDeviceConfig) -> DriverResult<()> {
    if config.id.trim().is_empty() {
        return Err("PWM output id must not be empty".into());
    }
    Ok(())
}

fn validate_wave(wave: &WaveCommand) -> Result<(), CommandError> {
    if wave.repeat == 0 {
        return Err(CommandError::Rejected(
            "wave repeat must be greater than 0".to_string(),
        ));
    }
    if wave.segments.is_empty() {
        return Err(CommandError::Rejected(
            "wave must contain at least one segment".to_string(),
        ));
    }

    for (idx, segment) in wave.segments.iter().enumerate() {
        if segment.duration_us == 0 {
            return Err(CommandError::Rejected(format!(
                "wave segment {idx} duration_us must be greater than 0"
            )));
        }
        if WaveLevel::try_from(segment.level) == Ok(WaveLevel::Unspecified) {
            return Err(CommandError::Rejected(format!(
                "wave segment {idx} level must be LOW or HIGH"
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> PwmOutputDeviceConfig {
        PwmOutputDeviceConfig {
            id: "steering".to_string(),
        }
    }

    fn wave() -> WaveCommand {
        WaveCommand {
            channel: 7,
            segments: vec![
                crate::pwm_output_proto::WaveSegment {
                    level: WaveLevel::High as i32,
                    duration_us: 1_500,
                },
                crate::pwm_output_proto::WaveSegment {
                    level: WaveLevel::Low as i32,
                    duration_us: 18_500,
                },
            ],
            repeat: 5,
        }
    }

    #[test]
    fn validates_minimal_pwm_config() {
        let cfg = config();
        assert!(validate_output_config(&cfg).is_ok());
    }

    #[test]
    fn rejects_empty_output_id() {
        let mut cfg = config();
        cfg.id = String::new();
        assert!(validate_output_config(&cfg).is_err());
    }

    #[test]
    fn rejects_empty_wave() {
        let command = WaveCommand {
            channel: 7,
            segments: Vec::new(),
            repeat: 1,
        };
        assert!(matches!(
            validate_wave(&command),
            Err(CommandError::Rejected(_))
        ));
    }

    #[test]
    fn rejects_zero_repeat() {
        let mut command = wave();
        command.repeat = 0;
        assert!(matches!(
            validate_wave(&command),
            Err(CommandError::Rejected(_))
        ));
    }

    #[test]
    fn rejects_zero_duration() {
        let mut command = wave();
        command.segments[0].duration_us = 0;
        assert!(matches!(
            validate_wave(&command),
            Err(CommandError::Rejected(_))
        ));
    }

    #[test]
    fn encodes_framed_payload() {
        let payload = Bytes::from_static(&[1, 2, 3, 4]);
        let frame = encode_frame(payload.clone()).unwrap();
        assert_eq!(&frame[0..4], FRAME_MAGIC);
        assert_eq!(frame[4], FRAME_VERSION);
        assert_eq!(u32::from_le_bytes(frame[5..9].try_into().unwrap()), 4);
        assert_eq!(&frame[9..13], payload.as_ref());
        let crc_offset = frame.len() - 4;
        let crc = u32::from_le_bytes(frame[crc_offset..].try_into().unwrap());
        assert_eq!(crc, crc32(&frame[..crc_offset]));
    }

    #[test]
    fn encodes_rpc_notify_with_binary_frame() {
        let frame = Bytes::from_static(b"NCWV-frame");
        let rpc = encode_rpc_notify(RPC_METHOD_PWM_FRAME, frame.as_ref()).unwrap();
        assert_eq!(
            rpc.as_ref(),
            &[
                0x93, 0x02, 0xa8, b'p', b'w', b'm', b'F', b'r', b'a', b'm', b'e', 0x91, 0xc4, 0x0a,
                b'N', b'C', b'W', b'V', b'-', b'f', b'r', b'a', b'm', b'e',
            ]
        );
    }
}

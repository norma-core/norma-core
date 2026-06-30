use crate::arduino_nicla_sense_env_proto::{
    ArduinoNiclaSenseEnvDevice, ArduinoNiclaSenseEnvDeviceInfo, ArduinoNiclaSenseEnvSignalType,
    RxEnvelope,
};
use crate::i2c::AsyncI2cDevice;
use bytes::Bytes;
use log::{error, info, warn};
use normfs::{NormFS, QueueId, UintN};
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio::time::{MissedTickBehavior, interval};

pub const RX_QUEUE_ID: &str = "arduino-nicla-sense-env/rx";
pub const DEFAULT_I2C_ADDRESS: u16 = 0x21;
pub const RAW_REGISTER_START: u8 = 0x00;
pub const RAW_REGISTER_LENGTH: usize = 0xD5;

const SOFTWARE_REVISION_REGISTER: usize = 0x0C;
const PRODUCT_ID_REGISTER: usize = 0x0D;
const SERIAL_NUMBER_REGISTER: usize = 0x0E;
const SERIAL_NUMBER_LENGTH: usize = 6;

type DriverResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct ArduinoNiclaSenseEnvDriverConfig {
    pub poll_interval: Duration,
    pub boards: Vec<ArduinoNiclaSenseEnvBoardConfig>,
}

#[derive(Debug, Clone)]
pub struct ArduinoNiclaSenseEnvBoardConfig {
    pub i2c_bus: u32,
}

impl Default for ArduinoNiclaSenseEnvDriverConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(1),
            boards: Vec::new(),
        }
    }
}

pub struct ArduinoNiclaSenseEnvDriver {
    _tasks: Vec<JoinHandle<()>>,
}

#[derive(Debug, Clone)]
struct Board {
    id: String,
    i2c_bus: u32,
}

impl Board {
    fn from_bus(i2c_bus: u32) -> Self {
        Self {
            id: format!("i2c-{i2c_bus}"),
            i2c_bus,
        }
    }

    fn proto(&self, data: Option<&[u8]>) -> ArduinoNiclaSenseEnvDevice {
        ArduinoNiclaSenseEnvDevice {
            id: self.id.clone(),
            i2c_bus: self.i2c_bus,
            i2c_address: DEFAULT_I2C_ADDRESS as u32,
            info: data.and_then(parse_device_info),
        }
    }
}

impl ArduinoNiclaSenseEnvDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        config: ArduinoNiclaSenseEnvDriverConfig,
    ) -> DriverResult<Self> {
        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        station_engine.register_queue(
            &rx_queue_id,
            QueueDataType::QdtArduinoNiclaSenseEnvRx,
            vec![],
        );

        let poll_interval = if config.poll_interval == Duration::ZERO {
            warn!("Arduino Nicla Sense Env poll interval is zero, using 1s");
            Duration::from_secs(1)
        } else {
            config.poll_interval
        };

        let i2c_buses = config
            .boards
            .iter()
            .map(|board| board.i2c_bus)
            .collect::<BTreeSet<_>>();
        if i2c_buses.is_empty() {
            warn!("Arduino Nicla Sense Env driver enabled with no i2c-buses configured");
        }

        let tasks = i2c_buses
            .iter()
            .map(|i2c_bus| {
                let board = Board::from_bus(*i2c_bus);
                tokio::spawn(run_board_worker(
                    normfs.clone(),
                    rx_queue_id.clone(),
                    board,
                    poll_interval,
                ))
            })
            .collect::<Vec<_>>();

        info!(
            "Started Arduino Nicla Sense Env driver for {} I2C bus(es)",
            i2c_buses.len()
        );

        Ok(Self { _tasks: tasks })
    }
}

pub async fn start_arduino_nicla_sense_env_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: ArduinoNiclaSenseEnvDriverConfig,
) -> DriverResult<Arc<ArduinoNiclaSenseEnvDriver>> {
    let driver = ArduinoNiclaSenseEnvDriver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

async fn run_board_worker(
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    board: Board,
    poll_interval: Duration,
) {
    let i2c = AsyncI2cDevice::new(board.i2c_bus, DEFAULT_I2C_ADDRESS);
    let mut connected = false;
    let mut last_data = None::<Vec<u8>>;
    let mut last_error = None::<String>;
    let mut tick = interval(poll_interval);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tick.tick().await;

        match i2c
            .read_registers(RAW_REGISTER_START, RAW_REGISTER_LENGTH)
            .await
        {
            Ok(data) => {
                if !connected {
                    send_board_signal(
                        &normfs,
                        &rx_queue_id,
                        &board,
                        ArduinoNiclaSenseEnvSignalType::ArduinoNiclaSenseEnvConnected,
                        Some(data.as_slice()),
                        None,
                    );
                    connected = true;
                }

                send_board_signal(
                    &normfs,
                    &rx_queue_id,
                    &board,
                    ArduinoNiclaSenseEnvSignalType::ArduinoNiclaSenseEnvRegistersSnapshot,
                    Some(data.as_slice()),
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
                        ArduinoNiclaSenseEnvSignalType::ArduinoNiclaSenseEnvDisconnected,
                        last_data.as_deref(),
                        Some(error.clone()),
                    );
                    connected = false;
                }

                if last_error.as_deref() != Some(error.as_str()) {
                    send_board_signal(
                        &normfs,
                        &rx_queue_id,
                        &board,
                        ArduinoNiclaSenseEnvSignalType::ArduinoNiclaSenseEnvError,
                        last_data.as_deref(),
                        Some(error.clone()),
                    );
                    last_error = Some(error);
                }
            }
        }
    }
}

fn parse_device_info(data: &[u8]) -> Option<ArduinoNiclaSenseEnvDeviceInfo> {
    let serial_end = SERIAL_NUMBER_REGISTER + SERIAL_NUMBER_LENGTH;
    if data.len() < serial_end {
        return None;
    }

    Some(ArduinoNiclaSenseEnvDeviceInfo {
        software_revision: data[SOFTWARE_REVISION_REGISTER] as u32,
        product_id: data[PRODUCT_ID_REGISTER] as u32,
        serial_number: Bytes::copy_from_slice(&data[SERIAL_NUMBER_REGISTER..serial_end]),
    })
}

fn send_board_signal(
    normfs: &Arc<NormFS>,
    rx_queue_id: &QueueId,
    board: &Board,
    signal_type: ArduinoNiclaSenseEnvSignalType,
    data: Option<&[u8]>,
    error_message: Option<String>,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        device: Some(board.proto(data)),
        data: data.map(Bytes::copy_from_slice).unwrap_or_default(),
        command: None,
        error: error_message.unwrap_or_default(),
    };

    if let Err(error) = send_proto(normfs, rx_queue_id, &envelope) {
        error!(
            "Failed to send Arduino Nicla Sense Env {:?} signal for {}: {}",
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

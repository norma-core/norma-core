use crate::ina226_proto::{Ina226Device, Ina226DeviceInfo, Ina226SignalType, RxEnvelope};
use bytes::{Bytes, BytesMut};
use i2c_async::AsyncI2cDevice;
use log::{error, info, warn};
use normfs::{NormFS, QueueId, UintN};
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio::time::{MissedTickBehavior, interval};

pub const RX_QUEUE_ID: &str = "ina226/rx";
pub const DEFAULT_I2C_ADDRESS: u16 = 0x40;
pub const REGISTER_COUNT: usize = 10;
pub const REGISTER_LENGTH: usize = 2;
pub const DUMP_REGISTERS: [u8; REGISTER_COUNT] =
    [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0e, 0x0f];

const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(1);
const MANUFACTURER_ID_REGISTER: u8 = 0x0e;
const DIE_ID_REGISTER: u8 = 0x0f;

type DriverResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct Ina226DriverConfig {
    pub devices: Vec<Ina226DeviceConfig>,
}

#[derive(Debug, Clone)]
pub struct Ina226DeviceConfig {
    pub id: Option<String>,
    pub i2c_bus: u32,
    pub i2c_address: u16,
    pub shunt_resistance_ohms: Option<f64>,
}

impl Default for Ina226DriverConfig {
    fn default() -> Self {
        Self {
            devices: Vec::new(),
        }
    }
}

pub struct Ina226Driver {
    _tasks: Vec<JoinHandle<()>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct DeviceKey {
    i2c_bus: u32,
    i2c_address: u16,
}

#[derive(Debug, Clone)]
struct Device {
    id: String,
    key: DeviceKey,
    shunt_resistance_ohms: Option<f64>,
}

#[derive(Debug, Clone)]
struct RegisterDump {
    data: Bytes,
}

impl Device {
    fn from_config(config: &Ina226DeviceConfig) -> Self {
        let key = DeviceKey {
            i2c_bus: config.i2c_bus,
            i2c_address: config.i2c_address,
        };

        Self {
            id: config
                .id
                .clone()
                .filter(|id| !id.trim().is_empty())
                .unwrap_or_else(|| format!("i2c-{}-0x{:02x}", key.i2c_bus, key.i2c_address)),
            key,
            shunt_resistance_ohms: config
                .shunt_resistance_ohms
                .filter(|resistance| resistance.is_finite() && *resistance > 0.0),
        }
    }

    fn proto(&self, dump: Option<&RegisterDump>) -> Ina226Device {
        Ina226Device {
            id: self.id.clone(),
            i2c_bus: self.key.i2c_bus,
            i2c_address: self.key.i2c_address as u32,
            info: build_device_info(dump, self.shunt_resistance_ohms),
        }
    }
}

impl Ina226Driver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        config: Ina226DriverConfig,
    ) -> DriverResult<Self> {
        let devices = config
            .devices
            .iter()
            .map(|device| {
                (
                    DeviceKey {
                        i2c_bus: device.i2c_bus,
                        i2c_address: device.i2c_address,
                    },
                    Device::from_config(device),
                )
            })
            .collect::<BTreeMap<_, _>>();
        if devices.is_empty() {
            warn!("INA226 driver enabled with no devices configured");
        }

        let mut tasks = Vec::with_capacity(devices.len());
        for device in devices.values() {
            let rx_queue_path = device_rx_queue_path(device.key);
            let rx_queue_id = normfs.resolve(&rx_queue_path);
            normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
            station_engine.register_queue(&rx_queue_id, QueueDataType::QdtIna226Rx, vec![]);

            tasks.push(tokio::spawn(run_device_worker(
                normfs.clone(),
                rx_queue_id,
                device.clone(),
                DEFAULT_POLL_INTERVAL,
            )));
        }

        info!("Started INA226 driver for {} device(s)", devices.len());

        Ok(Self { _tasks: tasks })
    }
}

fn device_rx_queue_path(key: DeviceKey) -> String {
    format!("ina226/i2c-{}-0x{:02x}/rx", key.i2c_bus, key.i2c_address)
}

pub async fn start_ina226_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: Ina226DriverConfig,
) -> DriverResult<Arc<Ina226Driver>> {
    let driver = Ina226Driver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

async fn run_device_worker(
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    device: Device,
    poll_interval: Duration,
) {
    let i2c = AsyncI2cDevice::new(device.key.i2c_bus, device.key.i2c_address);
    let mut connected = false;
    let mut last_dump = None::<RegisterDump>;
    let mut last_error = None::<String>;
    let mut tick = interval(poll_interval);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tick.tick().await;

        match read_register_dump(&i2c).await {
            Ok(dump) => {
                if !connected {
                    send_device_signal(
                        &normfs,
                        &rx_queue_id,
                        &device,
                        Ina226SignalType::Ina226Connected,
                        Some(&dump),
                        None,
                    );
                    connected = true;
                }

                send_device_signal(
                    &normfs,
                    &rx_queue_id,
                    &device,
                    Ina226SignalType::Ina226RegistersSnapshot,
                    Some(&dump),
                    None,
                );
                last_dump = Some(dump);
                last_error = None;
            }
            Err(error) => {
                if connected {
                    send_device_signal(
                        &normfs,
                        &rx_queue_id,
                        &device,
                        Ina226SignalType::Ina226Disconnected,
                        last_dump.as_ref(),
                        Some(error.clone()),
                    );
                    connected = false;
                }

                if last_error.as_deref() != Some(error.as_str()) {
                    send_device_signal(
                        &normfs,
                        &rx_queue_id,
                        &device,
                        Ina226SignalType::Ina226Error,
                        last_dump.as_ref(),
                        Some(error.clone()),
                    );
                    last_error = Some(error);
                }
            }
        }
    }
}

async fn read_register_dump(i2c: &AsyncI2cDevice) -> Result<RegisterDump, String> {
    let mut data = BytesMut::with_capacity(REGISTER_COUNT * REGISTER_LENGTH);
    let results = i2c
        .read_register_bytes_bulk(DUMP_REGISTERS.to_vec(), REGISTER_LENGTH)
        .await?;

    for (register, result) in results {
        let bytes = result
            .map_err(|error| format!("failed to read INA226 register 0x{register:02x}: {error}"))?;
        if bytes.len() != REGISTER_LENGTH {
            return Err(format!(
                "short INA226 register read from 0x{register:02x}: expected {}, got {}",
                REGISTER_LENGTH,
                bytes.len()
            ));
        }
        data.extend_from_slice(bytes.as_ref());
    }

    Ok(RegisterDump {
        data: data.freeze(),
    })
}

fn build_device_info(
    dump: Option<&RegisterDump>,
    shunt_resistance_ohms: Option<f64>,
) -> Option<Ina226DeviceInfo> {
    let manufacturer_id = dump.and_then(|dump| read_u16_be(dump, MANUFACTURER_ID_REGISTER));
    let die = dump.and_then(|dump| read_u16_be(dump, DIE_ID_REGISTER));

    if manufacturer_id.is_none() && die.is_none() && shunt_resistance_ohms.is_none() {
        return None;
    }

    Some(Ina226DeviceInfo {
        manufacturer_id: manufacturer_id.unwrap_or_default() as u32,
        die_id: die.map(|die| (die >> 4) as u32).unwrap_or_default(),
        revision_id: die.map(|die| (die & 0x000F) as u32).unwrap_or_default(),
        shunt_resistance_ohms: shunt_resistance_ohms.unwrap_or_default(),
    })
}

fn read_u16_be(dump: &RegisterDump, register: u8) -> Option<u16> {
    let index = DUMP_REGISTERS
        .iter()
        .position(|candidate| *candidate == register)?;
    let offset = index * REGISTER_LENGTH;
    let bytes = dump.data.get(offset..offset + REGISTER_LENGTH)?;
    Some(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn send_device_signal(
    normfs: &Arc<NormFS>,
    rx_queue_id: &QueueId,
    device: &Device,
    signal_type: Ina226SignalType,
    dump: Option<&RegisterDump>,
    error_message: Option<String>,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        device: Some(device.proto(dump)),
        data: dump.map(|dump| dump.data.clone()).unwrap_or_default(),
        error: error_message.unwrap_or_default(),
    };

    if let Err(error) = send_proto(normfs, rx_queue_id, &envelope) {
        error!(
            "Failed to send INA226 {:?} signal for {}: {}",
            signal_type, device.id, error
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

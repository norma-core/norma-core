use crate::dfrobot_rs485_proto::{
    DfrobotDevice, DfrobotSignalType, RegisterRange, RxEnvelope,
};
use crate::modbus::{self, ModbusError};
use crate::sensors::SensorModel;
use bytes::Bytes;
use log::{error, info, warn};
use normfs::{NormFS, QueueId, UintN};
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio::time::{MissedTickBehavior, interval, sleep};
use tokio_serial::SerialPortBuilderExt;

pub const QUEUE_PREFIX: &str = "dfrobot-rs485";

/// Per-transaction response timeout. The Python tooling uses 300 ms with the
/// same sensors and adapters.
const RESPONSE_TIMEOUT: Duration = Duration::from_millis(300);
/// Modbus RTU inter-frame silence (>= 3.5 char times; ~4 ms at 9600 baud).
const INTER_FRAME_GAP: Duration = Duration::from_millis(5);
/// How often to rescan candidate ports while no port is claimed.
const PORT_SCAN_INTERVAL: Duration = Duration::from_secs(3);

type DriverResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct DfrobotRs485DriverConfig {
    pub ports: Vec<String>,
    pub baud: u32,
    pub poll_interval: Duration,
    pub sensors: Vec<DfrobotSensorConfig>,
}

#[derive(Debug, Clone)]
pub struct DfrobotSensorConfig {
    pub id: Option<String>,
    pub model: SensorModel,
    pub modbus_id: u8,
}

pub struct DfrobotRs485Driver {
    _worker: JoinHandle<()>,
}

#[derive(Debug, Clone)]
struct Sensor {
    id: String,
    model: SensorModel,
    modbus_id: u8,
}

impl Sensor {
    fn from_config(config: &DfrobotSensorConfig) -> Self {
        let default_id = format!("{}-{}", config.model.config_name(), config.modbus_id);
        Self {
            id: config
                .id
                .clone()
                .filter(|id| !id.trim().is_empty())
                .unwrap_or(default_id),
            model: config.model,
            modbus_id: config.modbus_id,
        }
    }

    fn rx_queue_path(&self) -> String {
        format!("{QUEUE_PREFIX}/{}/rx", self.id)
    }

    fn proto(&self, port_name: &str, baud: u32) -> DfrobotDevice {
        DfrobotDevice {
            id: self.id.clone(),
            model: self.model.proto() as i32,
            modbus_id: self.modbus_id as u32,
            port_name: port_name.to_string(),
            baud,
        }
    }
}

/// Per-sensor connection state (the ina226 pattern, one per sensor):
/// dedups error signals so a dead sensor doesn't spam its queue at 1 Hz.
struct SensorState {
    sensor: Sensor,
    rx_queue_id: QueueId,
    connected: bool,
    last_error: Option<String>,
}

impl DfrobotRs485Driver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        config: DfrobotRs485DriverConfig,
    ) -> DriverResult<Self> {
        if config.sensors.is_empty() {
            warn!("DFRobot RS485 driver enabled with no sensors configured");
        }

        let mut states = Vec::with_capacity(config.sensors.len());
        for sensor_config in &config.sensors {
            let sensor = Sensor::from_config(sensor_config);
            let rx_queue_id = normfs.resolve(&sensor.rx_queue_path());
            normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
            station_engine.register_queue(&rx_queue_id, QueueDataType::QdtDfrobotRs485Rx, vec![]);
            states.push(SensorState {
                sensor,
                rx_queue_id,
                connected: false,
                last_error: None,
            });
        }

        info!(
            "Started DFRobot RS485 driver for {} sensor(s), ports {:?}, {} baud",
            states.len(),
            config.ports,
            config.baud
        );

        let worker = tokio::spawn(run_bus_worker(normfs, config, states));

        Ok(Self { _worker: worker })
    }
}

pub async fn start_dfrobot_rs485_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: DfrobotRs485DriverConfig,
) -> DriverResult<Arc<DfrobotRs485Driver>> {
    let driver = DfrobotRs485Driver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

async fn run_bus_worker(
    normfs: Arc<NormFS>,
    config: DfrobotRs485DriverConfig,
    mut states: Vec<SensorState>,
) {
    if states.is_empty() {
        return;
    }

    loop {
        let (mut port, port_name) = acquire_port(&config, &states).await;
        info!("DFRobot RS485 claimed port {port_name}");

        let mut tick = interval(config.poll_interval);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

        'poll: loop {
            tick.tick().await;

            let mut port_lost = false;
            for state in states.iter_mut() {
                match poll_sensor(&mut port, state).await {
                    Ok(ranges) => {
                        if !state.connected {
                            send_signal(
                                &normfs,
                                state,
                                &port_name,
                                config.baud,
                                DfrobotSignalType::DfrobotConnected,
                                ranges.clone(),
                                None,
                            );
                            state.connected = true;
                        }
                        send_signal(
                            &normfs,
                            state,
                            &port_name,
                            config.baud,
                            DfrobotSignalType::DfrobotRegistersSnapshot,
                            ranges,
                            None,
                        );
                        state.last_error = None;
                    }
                    Err(modbus_error) => {
                        if matches!(modbus_error, ModbusError::Io(_)) {
                            port_lost = true;
                        }
                        let message = modbus_error.to_string();
                        if state.connected {
                            send_signal(
                                &normfs,
                                state,
                                &port_name,
                                config.baud,
                                DfrobotSignalType::DfrobotDisconnected,
                                Vec::new(),
                                Some(message.clone()),
                            );
                            state.connected = false;
                        }
                        if state.last_error.as_deref() != Some(message.as_str()) {
                            send_signal(
                                &normfs,
                                state,
                                &port_name,
                                config.baud,
                                DfrobotSignalType::DfrobotError,
                                Vec::new(),
                                Some(message.clone()),
                            );
                            state.last_error = Some(message);
                        }
                    }
                }
            }

            if port_lost {
                warn!("DFRobot RS485 lost port {port_name}, rescanning");
                for state in states.iter_mut() {
                    if state.connected {
                        send_signal(
                            &normfs,
                            state,
                            &port_name,
                            config.baud,
                            DfrobotSignalType::DfrobotDisconnected,
                            Vec::new(),
                            Some("serial port lost".to_string()),
                        );
                        state.connected = false;
                        state.last_error = Some("serial port lost".to_string());
                    }
                }
                break 'poll;
            }
        }
    }
}

/// Reads every configured range of one sensor. All ranges must succeed for
/// the poll to count as a success — a partial snapshot is treated as the
/// error of the range that failed.
async fn poll_sensor(
    port: &mut tokio_serial::SerialStream,
    state: &SensorState,
) -> Result<Vec<RegisterRange>, ModbusError> {
    let mut ranges = Vec::new();
    for (start, count) in state.sensor.model.poll_ranges() {
        let data = modbus::transact(
            port,
            state.sensor.modbus_id,
            *start,
            *count,
            RESPONSE_TIMEOUT,
        )
        .await?;
        ranges.push(RegisterRange {
            start_register: *start as u32,
            data,
        });
        sleep(INTER_FRAME_GAP).await;
    }
    Ok(ranges)
}

/// Tries candidate ports (from the configured glob/fallback list, in order)
/// until one has at least one configured sensor answering. Probes every
/// configured Modbus ID per candidate: any answer claims the port; silent
/// sensors are retried by the normal poll loop afterwards. No bus scanning
/// beyond the configured IDs (design decision — see the spec).
async fn acquire_port(
    config: &DfrobotRs485DriverConfig,
    states: &[SensorState],
) -> (tokio_serial::SerialStream, String) {
    loop {
        for candidate in expand_port_globs(&config.ports) {
            let mut port = match tokio_serial::new(&candidate, config.baud).open_native_async() {
                Ok(port) => port,
                Err(open_error) => {
                    log::debug!("DFRobot RS485: cannot open {candidate}: {open_error}");
                    continue;
                }
            };

            for state in states.iter() {
                let (start, count) = state.sensor.model.poll_ranges()[0];
                if modbus::transact(
                    &mut port,
                    state.sensor.modbus_id,
                    start,
                    count,
                    RESPONSE_TIMEOUT,
                )
                .await
                .is_ok()
                {
                    return (port, candidate);
                }
                sleep(INTER_FRAME_GAP).await;
            }
            log::debug!("DFRobot RS485: no configured sensor answered on {candidate}");
        }
        sleep(PORT_SCAN_INTERVAL).await;
    }
}

/// Minimal '*'-only glob matching — enough for /dev/ttyUSB* style patterns
/// without pulling in a glob dependency.
fn matches_glob(pattern: &str, name: &str) -> bool {
    fn helper(pattern: &[u8], name: &[u8]) -> bool {
        match pattern.first() {
            None => name.is_empty(),
            Some(b'*') => {
                helper(&pattern[1..], name)
                    || (!name.is_empty() && helper(pattern, &name[1..]))
            }
            Some(&ch) => !name.is_empty() && ch == name[0] && helper(&pattern[1..], &name[1..]),
        }
    }
    helper(pattern.as_bytes(), name.as_bytes())
}

fn expand_port_globs(patterns: &[String]) -> Vec<String> {
    let mut candidates = Vec::new();
    for pattern in patterns {
        if !pattern.contains('*') {
            if std::path::Path::new(pattern).exists() {
                candidates.push(pattern.clone());
            }
            continue;
        }
        let (dir, file_pattern) = pattern.rsplit_once('/').unwrap_or((".", pattern.as_str()));
        let Ok(entries) = std::fs::read_dir(if dir.is_empty() { "/" } else { dir }) else {
            continue;
        };
        let mut matched: Vec<String> = entries
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| matches_glob(file_pattern, name))
            .map(|name| format!("{dir}/{name}"))
            .collect();
        matched.sort();
        candidates.extend(matched);
    }
    candidates.dedup();
    candidates
}

fn send_signal(
    normfs: &Arc<NormFS>,
    state: &SensorState,
    port_name: &str,
    baud: u32,
    signal_type: DfrobotSignalType,
    ranges: Vec<RegisterRange>,
    error_message: Option<String>,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        device: Some(state.sensor.proto(port_name, baud)),
        ranges,
        error: error_message.unwrap_or_default(),
    };

    if let Err(send_error) = send_proto(normfs, &state.rx_queue_id, &envelope) {
        error!(
            "Failed to send DFRobot RS485 {:?} signal for {}: {}",
            signal_type, state.sensor.id, send_error
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
    fn default_sensor_id_is_model_dash_modbus_id() {
        let sensor = Sensor::from_config(&DfrobotSensorConfig {
            id: None,
            model: SensorModel::Irradiance,
            modbus_id: 1,
        });
        assert_eq!(sensor.id, "irradiance-1");
        assert_eq!(sensor.rx_queue_path(), "dfrobot-rs485/irradiance-1/rx");
    }

    #[test]
    fn explicit_sensor_id_overrides_default() {
        let sensor = Sensor::from_config(&DfrobotSensorConfig {
            id: Some("greenhouse-light".to_string()),
            model: SensorModel::Light,
            modbus_id: 4,
        });
        assert_eq!(sensor.rx_queue_path(), "dfrobot-rs485/greenhouse-light/rx");
    }

    #[test]
    fn blank_sensor_id_falls_back_to_default() {
        let sensor = Sensor::from_config(&DfrobotSensorConfig {
            id: Some("   ".to_string()),
            model: SensorModel::Uv,
            modbus_id: 3,
        });
        assert_eq!(sensor.id, "uv-3");
    }

    #[test]
    fn glob_matching() {
        assert!(matches_glob("/dev/ttyUSB*", "/dev/ttyUSB0"));
        assert!(matches_glob("cu.usbserial-*", "cu.usbserial-0001"));
        assert!(matches_glob("/dev/ttyUSB0", "/dev/ttyUSB0"));
        assert!(!matches_glob("ttyUSB*", "ttyACM0"));
        assert!(!matches_glob("ttyUSB?", "ttyUSB0")); // '?' is not supported
        assert!(matches_glob("*usb*", "cu.usbserial-0001"));
    }
}

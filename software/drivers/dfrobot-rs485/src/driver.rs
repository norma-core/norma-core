use crate::dfrobot_rs485_proto::{
    DfrobotDevice, DfrobotSignalType, RegisterRange, RxEnvelope,
};
use crate::modbus::{self, ModbusError};
use crate::sensors::{self, SensorModel};
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
use tokio_serial::{SerialPort, SerialPortBuilderExt};

pub const QUEUE_PREFIX: &str = "dfrobot-rs485";

/// Per-transaction response timeout. The Python tooling uses 300 ms with the
/// same sensors and adapters.
const RESPONSE_TIMEOUT: Duration = Duration::from_millis(300);
/// Modbus RTU inter-frame silence (>= 3.5 char times; ~4 ms at 9600 baud).
const INTER_FRAME_GAP: Duration = Duration::from_millis(5);
/// How often to rescan candidate ports while no port is claimed.
const PORT_SCAN_INTERVAL: Duration = Duration::from_secs(3);
/// Fallback poll interval substituted when configured with a zero Duration
/// (which would otherwise panic `tokio::time::interval`).
const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(1);

type DriverResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct DfrobotRs485DriverConfig {
    pub ports: Vec<String>,
    pub bauds: Vec<u32>,
    pub poll_interval: Duration,
    pub sensors: Vec<DfrobotSensorConfig>,
    pub scan_ids: Vec<u8>,
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

    fn detected(model: SensorModel, modbus_id: u8) -> Self {
        Self {
            id: format!("{}-{}", model.config_name(), modbus_id),
            model,
            modbus_id,
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
    /// Connection-static registers, read once at the connect transition and
    /// appended to every snapshot (ST3215 EEPROM-cache pattern). Cleared on
    /// disconnect/port loss; the driver never writes, so nothing else can
    /// invalidate it.
    static_ranges: Option<Vec<RegisterRange>>,
}

impl DfrobotRs485Driver {
    pub async fn new<T: StationEngine + Send + Sync + 'static>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        mut config: DfrobotRs485DriverConfig,
    ) -> DriverResult<Self> {
        if config.poll_interval.is_zero() {
            warn!(
                "DFRobot RS485 poll-interval is zero, using {:?}",
                DEFAULT_POLL_INTERVAL
            );
            config.poll_interval = DEFAULT_POLL_INTERVAL;
        }

        config.bauds = sanitize_bauds(&config.bauds);
        if config.bauds.is_empty() {
            warn!(
                "DFRobot RS485 baud candidate list is empty, using {:?}",
                default_bauds()
            );
            config.bauds = default_bauds();
        }

        if config.scan_ids.is_empty() && config.sensors.is_empty() {
            warn!("DFRobot RS485 driver enabled with no scan range and no sensors configured");
        }

        info!(
            "Started DFRobot RS485 driver: ports {:?}, bauds {:?}, scan ids {:?}, {} explicit sensor(s)",
            config.ports,
            config.bauds,
            config.scan_ids,
            config.sensors.len()
        );

        let worker = tokio::spawn(run_bus_worker(normfs, station_engine, config));

        Ok(Self { _worker: worker })
    }
}

pub async fn start_dfrobot_rs485_driver<T: StationEngine + Send + Sync + 'static>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: DfrobotRs485DriverConfig,
) -> DriverResult<Arc<DfrobotRs485Driver>> {
    let driver = DfrobotRs485Driver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

async fn run_bus_worker<T: StationEngine + Send + Sync + 'static>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: DfrobotRs485DriverConfig,
) {
    // Queues survive re-acquisition: the same sensor id maps to the same
    // queue (history continuity), and register_queue runs once per queue
    // per process.
    let mut registered: std::collections::HashMap<String, QueueId> =
        std::collections::HashMap::new();

    loop {
        let (mut port, port_name, claimed_baud, discovered) = acquire_and_scan(&config).await;

        let mut states: Vec<SensorState> = Vec::new();
        for sensor in discovered {
            let path = sensor.rx_queue_path();
            let rx_queue_id = if let Some(existing) = registered.get(&path) {
                existing.clone()
            } else {
                let queue_id = normfs.resolve(&path);
                if let Err(error) = normfs.ensure_queue_exists_for_write(&queue_id).await {
                    error!("DFRobot RS485: cannot create queue {path}: {error}");
                    continue;
                }
                station_engine.register_queue(
                    &queue_id,
                    QueueDataType::QdtDfrobotRs485Rx,
                    vec![],
                );
                registered.insert(path, queue_id.clone());
                queue_id
            };
            states.push(SensorState {
                sensor,
                rx_queue_id,
                connected: false,
                last_error: None,
                static_ranges: None,
            });
        }

        if states.is_empty() {
            sleep(PORT_SCAN_INTERVAL).await;
            continue;
        }

        info!(
            "DFRobot RS485 claimed port {port_name} at {claimed_baud} baud with {} sensor(s): {}",
            states.len(),
            states
                .iter()
                .map(|state| state.sensor.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );

        let mut tick = interval(config.poll_interval);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

        'poll: loop {
            tick.tick().await;

            let mut port_lost = false;
            for state in states.iter_mut() {
                let poll_result = match read_ranges(
                    &mut port,
                    state.sensor.modbus_id,
                    state.sensor.model.poll_ranges(),
                )
                .await
                {
                    Ok(dynamic) => {
                        if state.static_ranges.is_none() {
                            // Connect transition: capture the static set once.
                            // Both reads must succeed before CONNECTED is
                            // emitted (spec; mirrors the ST3215 full first read).
                            match read_ranges(
                                &mut port,
                                state.sensor.modbus_id,
                                state.sensor.model.static_ranges(),
                            )
                            .await
                            {
                                Ok(statics) => {
                                    state.static_ranges = Some(statics);
                                    Ok(dynamic)
                                }
                                Err(error) => Err(error),
                            }
                        } else {
                            Ok(dynamic)
                        }
                    }
                    Err(error) => Err(error),
                };

                match poll_result {
                    Ok(dynamic) => {
                        let ranges =
                            assemble_ranges(dynamic, state.static_ranges.as_deref());
                        if !state.connected {
                            send_signal(
                                &normfs,
                                state,
                                &port_name,
                                claimed_baud,
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
                            claimed_baud,
                            DfrobotSignalType::DfrobotRegistersSnapshot,
                            ranges,
                            None,
                        );
                        state.last_error = None;
                    }
                    Err(modbus_error) => {
                        state.static_ranges = None;
                        if matches!(modbus_error, ModbusError::Io(_)) {
                            port_lost = true;
                        }
                        let message = modbus_error.to_string();
                        if state.connected {
                            send_signal(
                                &normfs,
                                state,
                                &port_name,
                                claimed_baud,
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
                                claimed_baud,
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
                    state.static_ranges = None;
                    if state.connected {
                        send_signal(
                            &normfs,
                            state,
                            &port_name,
                            claimed_baud,
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

/// Reads a list of register ranges from one sensor. All ranges must succeed
/// — a partial result is treated as the error of the range that failed.
async fn read_ranges(
    port: &mut tokio_serial::SerialStream,
    modbus_id: u8,
    ranges: &[(u16, u16)],
) -> Result<Vec<RegisterRange>, ModbusError> {
    let mut out = Vec::with_capacity(ranges.len());
    for (start, count) in ranges {
        let data = modbus::transact(port, modbus_id, *start, *count, RESPONSE_TIMEOUT).await?;
        out.push(RegisterRange {
            start_register: *start as u32,
            data,
        });
        sleep(INTER_FRAME_GAP).await;
    }
    Ok(out)
}

/// Envelope ranges for CONNECTED/SNAPSHOT: fresh dynamic ranges followed by
/// the cached static ranges. Consumers decode by register address, so order
/// carries no meaning.
fn assemble_ranges(
    dynamic: Vec<RegisterRange>,
    statics: Option<&[RegisterRange]>,
) -> Vec<RegisterRange> {
    let mut ranges = dynamic;
    if let Some(statics) = statics {
        ranges.extend_from_slice(statics);
    }
    ranges
}

/// One single-register read (count = 1). Detection MUST use these: the
/// 0x083B/0x0009 block and the SEN0644 config cluster return zeros in larger
/// block reads (deep-sweep finding, 2026-07-29).
async fn read_single(
    port: &mut tokio_serial::SerialStream,
    modbus_id: u8,
    register: u16,
) -> Result<u16, ModbusError> {
    let data = modbus::transact(port, modbus_id, register, 1, RESPONSE_TIMEOUT).await?;
    sleep(INTER_FRAME_GAP).await;
    Ok(((data[0] as u16) << 8) | data[1] as u16)
}

/// Probes one Modbus ID and classifies the device behind it.
/// Returns None when the ID does not answer (or stops answering mid-probe).
async fn detect_sensor(
    port: &mut tokio_serial::SerialStream,
    modbus_id: u8,
) -> Option<Sensor> {
    read_single(port, modbus_id, 0x0000).await.ok()?;
    let radiation_addr = read_single(port, modbus_id, sensors::REG_RADIATION_ADDRESS)
        .await
        .ok()?;
    let light_addr = read_single(port, modbus_id, sensors::REG_LIGHT_ADDRESS)
        .await
        .ok()?;

    let (range, hw_id) = if radiation_addr == modbus_id as u16 {
        let range = read_single(port, modbus_id, sensors::REG_RANGE_CONSTANT)
            .await
            .ok()?;
        let hw_id = read_single(port, modbus_id, sensors::REG_HARDWARE_ID)
            .await
            .ok()?;
        (range, hw_id)
    } else {
        (0, 0)
    };

    let model = sensors::classify(modbus_id, radiation_addr, light_addr, range, hw_id);
    match model {
        SensorModel::Unknown => info!(
            "DFRobot RS485: unclassified device at id {modbus_id} \
             (0x07D0={radiation_addr}, 0x0064={light_addr}, 0x083B={range}, \
             0x0009=0x{hw_id:04X}) — recording as unknown"
        ),
        SensorModel::Light => {
            let version = read_single(port, modbus_id, sensors::REG_LIGHT_VERSION)
                .await
                .unwrap_or(0);
            info!(
                "DFRobot RS485: detected {} at id {modbus_id} (version {version})",
                model.config_name()
            );
        }
        _ => info!(
            "DFRobot RS485: detected {} at id {modbus_id} (0x083B={range}, 0x0009=0x{hw_id:04X})",
            model.config_name()
        ),
    }
    Some(Sensor::detected(model, modbus_id))
}

/// Result of one scan pass at one baud rate.
struct ScanOutcome {
    /// The sensor set for this pass: all explicit-config sensors plus every
    /// detected responder.
    sensors: Vec<Sensor>,
    /// Modbus IDs that actually answered during this pass — the claim and
    /// mixed-bus decisions count these, not `sensors` (which includes
    /// offline explicit entries).
    responding_ids: Vec<u8>,
}

/// Builds the sensor set for one candidate port at the port's current baud.
/// Explicit config entries are always included (their queues surface
/// timeouts if the device is offline) and skip detection; the scan range
/// covers the remaining IDs. `responding_ids` records which IDs answered.
async fn scan_bus(
    port: &mut tokio_serial::SerialStream,
    config: &DfrobotRs485DriverConfig,
) -> ScanOutcome {
    let mut sensors = Vec::new();
    let mut responding_ids = Vec::new();
    let mut taken: std::collections::HashSet<u8> = std::collections::HashSet::new();

    for sensor_config in &config.sensors {
        let sensor = Sensor::from_config(sensor_config);
        // The plan is always the single uniform block; this probe is intentionally the same read the poll loop does.
        let (start, count) = sensor.model.poll_ranges()[0];
        if modbus::transact(port, sensor.modbus_id, start, count, RESPONSE_TIMEOUT)
            .await
            .is_ok()
        {
            responding_ids.push(sensor.modbus_id);
        }
        sleep(INTER_FRAME_GAP).await;
        taken.insert(sensor.modbus_id);
        sensors.push(sensor);
    }

    for id in &config.scan_ids {
        if taken.contains(id) {
            continue;
        }
        if let Some(sensor) = detect_sensor(port, *id).await {
            responding_ids.push(*id);
            sensors.push(sensor);
        }
    }

    ScanOutcome {
        sensors,
        responding_ids,
    }
}

/// Tries candidate ports (glob/fallback list, in order). On each port, runs
/// the full ID scan at every candidate baud rate, then claims the baud with
/// the most responding devices (tie: earlier in the list). Devices answering
/// at a non-claimed baud are warned about and not polled (mixed bus).
async fn acquire_and_scan(
    config: &DfrobotRs485DriverConfig,
) -> (tokio_serial::SerialStream, String, u32, Vec<Sensor>) {
    loop {
        for candidate in expand_port_globs(&config.ports) {
            let initial_baud = config.bauds.first().copied().unwrap_or(9600);
            let mut port = match tokio_serial::new(&candidate, initial_baud).open_native_async() {
                Ok(port) => port,
                Err(open_error) => {
                    log::debug!("DFRobot RS485: cannot open {candidate}: {open_error}");
                    continue;
                }
            };

            let mut passes: Vec<(u32, ScanOutcome)> = Vec::new();
            for &baud in &config.bauds {
                if let Err(error) = port.set_baud_rate(baud) {
                    warn!("DFRobot RS485: cannot set {baud} baud on {candidate}: {error}");
                    continue;
                }
                let _ = port.clear(tokio_serial::ClearBuffer::Input);
                let outcome = scan_bus(&mut port, config).await;
                passes.push((baud, outcome));
            }

            let counts: Vec<(u32, usize)> = passes
                .iter()
                .map(|(baud, outcome)| (*baud, outcome.responding_ids.len()))
                .collect();
            let Some(best_index) = best_baud(&counts) else {
                log::debug!("DFRobot RS485: no responders on {candidate} at any baud");
                continue;
            };

            for (index, (baud, outcome)) in passes.iter().enumerate() {
                if index != best_index && !outcome.responding_ids.is_empty() {
                    warn!(
                        "DFRobot RS485: mixed bus on {candidate}: {} device(s) answering at \
                         {baud} baud (ids {:?}) will not be polled at the claimed baud — unify the bus baud",
                        outcome.responding_ids.len(),
                        outcome.responding_ids
                    );
                }
            }

            let (claimed_baud, outcome) = passes.swap_remove(best_index);
            if let Err(error) = port.set_baud_rate(claimed_baud) {
                warn!(
                    "DFRobot RS485: cannot return {candidate} to {claimed_baud} baud: {error}"
                );
                continue;
            }
            let _ = port.clear(tokio_serial::ClearBuffer::Input);
            return (port, candidate, claimed_baud, outcome.sensors);
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
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));
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
        command: None,
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

/// Default Modbus ID scan range: 1-10 inclusive (design decision, spec §Decisions).
pub fn default_scan_ids() -> Vec<u8> {
    (1..=10).collect()
}

/// Parses a scan-ids spec: "A-B" (inclusive) or a single "A".
/// Valid Modbus unit IDs are 1-254 (0 and 255 are broadcast addresses).
pub fn parse_scan_ids(spec: &str) -> Option<Vec<u8>> {
    let spec = spec.trim();
    let (low, high) = match spec.split_once('-') {
        Some((low, high)) => {
            if high.contains('-') {
                return None;
            }
            (low.trim().parse::<u8>().ok()?, high.trim().parse::<u8>().ok()?)
        }
        None => {
            let single = spec.parse::<u8>().ok()?;
            (single, single)
        }
    };
    if low == 0 || high < low || high > 254 {
        return None;
    }
    Some((low..=high).collect())
}

/// Sanitizes an explicit ID list from config: keeps first occurrence order,
/// drops duplicates and the broadcast addresses 0/255.
pub fn sanitize_scan_ids(ids: &[u8]) -> Vec<u8> {
    let mut seen = std::collections::HashSet::new();
    ids.iter()
        .copied()
        .filter(|id| (1..=254).contains(id) && seen.insert(*id))
        .collect()
}

/// Default candidate baud rates for baud auto-detection, in try order.
/// The radiation-family sensors ship at 4800, SEN0644 at 9600.
pub fn default_bauds() -> Vec<u32> {
    vec![4800, 9600]
}

/// Sanitizes a configured baud list: keeps first-occurrence order, drops
/// duplicates and the invalid value 0.
pub fn sanitize_bauds(bauds: &[u32]) -> Vec<u32> {
    let mut seen = std::collections::HashSet::new();
    bauds
        .iter()
        .copied()
        .filter(|baud| *baud != 0 && seen.insert(*baud))
        .collect()
}

/// Picks the scan pass to claim: the one with the most responding devices.
/// Ties go to the earlier candidate (strictly-greater comparison); passes
/// with zero responders never win. Returns the index into `counts`.
fn best_baud(counts: &[(u32, usize)]) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (index, (_, count)) in counts.iter().enumerate() {
        if *count == 0 {
            continue;
        }
        match best {
            None => best = Some(index),
            Some(current) if *count > counts[current].1 => best = Some(index),
            _ => {}
        }
    }
    best
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
    fn envelope_encoding_round_trip() {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: 111,
            local_stamp_ns: 222,
            app_start_id: 333,
            signal_type: DfrobotSignalType::DfrobotRegistersSnapshot as i32,
            device: Some(DfrobotDevice {
                id: "irradiance-1".to_string(),
                model: SensorModel::Irradiance.proto() as i32,
                modbus_id: 1,
                port_name: "/dev/ttyUSB0".to_string(),
                baud: 9600,
            }),
            ranges: vec![
                RegisterRange {
                    start_register: 0x07D0,
                    data: Bytes::from_static(&[0x00, 0x01, 0x02, 0x03]),
                },
                RegisterRange {
                    start_register: 0x07D4,
                    data: Bytes::from_static(&[0xAA, 0xBB]),
                },
            ],
            error: "boom".to_string(),
            command: None,
        };

        let mut buffer = Vec::new();
        Message::encode(&envelope, &mut buffer).expect("encode should succeed");

        let decoded = RxEnvelope::decode(buffer.as_slice()).expect("decode should succeed");

        assert_eq!(decoded.signal_type, envelope.signal_type);
        let device = decoded.device.expect("device should be present");
        let expected_device = envelope.device.unwrap();
        assert_eq!(device.id, expected_device.id);
        assert_eq!(device.model, expected_device.model);
        assert_eq!(device.modbus_id, expected_device.modbus_id);
        assert_eq!(decoded.ranges.len(), 2);
        assert_eq!(decoded.ranges[0].start_register, 0x07D0);
        assert_eq!(decoded.ranges[0].data.as_ref(), &[0x00, 0x01, 0x02, 0x03]);
        assert_eq!(decoded.ranges[1].start_register, 0x07D4);
        assert_eq!(decoded.ranges[1].data.as_ref(), &[0xAA, 0xBB]);
        assert_eq!(decoded.error, "boom");
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

    #[test]
    fn default_scan_ids_is_one_to_ten() {
        assert_eq!(default_scan_ids(), (1..=10).collect::<Vec<u8>>());
    }

    #[test]
    fn parse_scan_ids_accepts_ranges_and_singles() {
        assert_eq!(parse_scan_ids("1-10"), Some((1..=10).collect()));
        assert_eq!(parse_scan_ids(" 2 - 4 "), Some(vec![2, 3, 4]));
        assert_eq!(parse_scan_ids("5"), Some(vec![5]));
        assert_eq!(parse_scan_ids("254-254"), Some(vec![254]));
    }

    #[test]
    fn parse_scan_ids_rejects_invalid_specs() {
        assert_eq!(parse_scan_ids("10-1"), None); // reversed
        assert_eq!(parse_scan_ids("0-5"), None);  // 0 is broadcast
        assert_eq!(parse_scan_ids("1-255"), None); // 255 is broadcast (SEN0644)
        assert_eq!(parse_scan_ids("abc"), None);
        assert_eq!(parse_scan_ids(""), None);
        assert_eq!(parse_scan_ids("1-2-3"), None);
    }

    #[test]
    fn sanitize_scan_ids_dedups_and_drops_invalid() {
        assert_eq!(sanitize_scan_ids(&[3, 3, 0, 255, 7, 3]), vec![3, 7]);
        assert_eq!(sanitize_scan_ids(&[]), Vec::<u8>::new());
    }

    #[test]
    fn detected_sensor_naming() {
        let known = Sensor::detected(SensorModel::Par, 2);
        assert_eq!(known.id, "par-2");
        assert_eq!(known.rx_queue_path(), "dfrobot-rs485/par-2/rx");

        let unknown = Sensor::detected(SensorModel::Unknown, 5);
        assert_eq!(unknown.id, "unknown-5");
        assert_eq!(unknown.rx_queue_path(), "dfrobot-rs485/unknown-5/rx");
    }

    #[test]
    fn default_bauds_is_4800_then_9600() {
        assert_eq!(default_bauds(), vec![4800, 9600]);
    }

    #[test]
    fn sanitize_bauds_dedups_and_drops_zero() {
        assert_eq!(sanitize_bauds(&[9600, 4800, 9600, 0]), vec![9600, 4800]);
        assert_eq!(sanitize_bauds(&[]), Vec::<u32>::new());
        assert_eq!(sanitize_bauds(&[0]), Vec::<u32>::new());
    }

    #[test]
    fn best_baud_picks_most_responders() {
        assert_eq!(best_baud(&[(4800, 0), (9600, 4)]), Some(1));
        assert_eq!(best_baud(&[(4800, 3), (9600, 1)]), Some(0));
    }

    #[test]
    fn best_baud_tie_goes_to_earlier_candidate() {
        assert_eq!(best_baud(&[(4800, 2), (9600, 2)]), Some(0));
    }

    #[test]
    fn best_baud_none_when_all_silent() {
        assert_eq!(best_baud(&[(4800, 0), (9600, 0)]), None);
        assert_eq!(best_baud(&[]), None);
    }

    #[test]
    fn assemble_ranges_appends_cached_statics() {
        let dynamic = vec![RegisterRange {
            start_register: 0x0000,
            data: Bytes::from_static(&[0x00, 0x02]),
        }];
        let statics = vec![
            RegisterRange {
                start_register: 0x07D0,
                data: Bytes::from_static(&[0x00, 0x03]),
            },
            RegisterRange {
                start_register: 0x083B,
                data: Bytes::from_static(&[0x05, 0xDC]),
            },
        ];

        let with_statics = assemble_ranges(dynamic.clone(), Some(&statics));
        assert_eq!(with_statics.len(), 3);
        assert_eq!(with_statics[0].start_register, 0x0000);
        assert_eq!(with_statics[1].start_register, 0x07D0);
        assert_eq!(with_statics[2].start_register, 0x083B);

        let without = assemble_ranges(dynamic, None);
        assert_eq!(without.len(), 1);
    }

    #[test]
    fn scan_outcome_counts_only_responders() {
        let outcome = ScanOutcome {
            sensors: vec![
                Sensor::detected(SensorModel::Par, 2),
                Sensor::from_config(&DfrobotSensorConfig {
                    id: None,
                    model: SensorModel::Uv,
                    modbus_id: 3,
                }),
            ],
            responding_ids: vec![2],
        };
        assert_eq!(outcome.responding_ids.len(), 1);
        assert_eq!(outcome.sensors.len(), 2);
    }
}

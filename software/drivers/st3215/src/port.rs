use super::state::ST3215BusCommunicator;
use crate::errors::{convert_error, enqueue_error};
use crate::port_meta::St3215PortMeta;
use crate::presets::*;
use crate::protocol;
use crate::st3215_proto::{
    RxEnvelope, St3215Bus as St3215BusProto, St3215Error, St3215SignalType, TxEnvelope,
};
use bytes::{Bytes, BytesMut};
use log::warn;
use log::{debug, error, info};
use parking_lot::Mutex;
use prost::Message;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;
use tokio_serial::SerialPortBuilderExt;
use tokio_serial::SerialPortInfo;

pub const ST3215_TIMEOUT_MS: u64 = 20;
pub const ST3215_COMMAND_TIMEOUT_MS: u64 = 20;
pub const ST3215_SLOW_READ_WARN_MS: u128 = 10;

const NO_COMMAND_SEARCH_DELAY_MS: u64 = 500;
const MIN_TIME_BETWEEN_SEARCHES_MS: u64 = 100;
pub const MAX_MOTORS_CNT: u8 = 8;

pub struct St3215Port {
    port_info: SerialPortInfo,
    bus_info: St3215BusProto,
    com: Arc<ST3215BusCommunicator>,
    command_waiting: Arc<AtomicBool>,
    meta: Arc<St3215PortMeta>,
    eeprom_cache: Arc<Mutex<HashMap<u8, Bytes>>>,
}

impl St3215Port {
    pub async fn new(
        port_info: SerialPortInfo,
        com: Arc<ST3215BusCommunicator>,
        bus_info: St3215BusProto,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let meta = St3215PortMeta::new(&bus_info.serial_number, &com).await?;
        Ok(St3215Port {
            port_info,
            bus_info,
            com,
            command_waiting: Arc::new(AtomicBool::new(false)),
            meta: Arc::new(meta),
            eeprom_cache: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub async fn open(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let port_name = self.port_info.port_name.clone();
        info!("Attempting to open ST3215 port: {}", port_name);

        let port = match tokio_serial::new(&port_name, protocol::SUPPORTED_BAUD_RATES[0])
            .timeout(Duration::from_millis(20))
            .open_native_async()
        {
            Ok(p) => p,
            Err(e) => {
                error!("Failed to open ST3215 port {}: {}", port_name, e);
                return Err(Box::new(e));
            }
        };
        info!("Successfully opened ST3215 port: {}", port_name);

        let (done_tx, mut done_rx) = mpsc::channel::<Result<(), String>>(1);
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<TxEnvelope>();
        let command_waiting = self.command_waiting.clone();

        // Subscribe to tx_queue_id for receiving commands
        let serial_for_filter = self.bus_info.serial_number.clone();
        let cmd_tx_clone = cmd_tx.clone();
        let normfs = self.com.normfs.clone();
        let tx_queue_id = self.com.tx_queue_id.clone();
        let subscription_id = normfs.subscribe(
            &tx_queue_id,
            Box::new(move |entries| {
                for (_id, data) in entries {
                    if let Ok(envelope) = TxEnvelope::decode(data.as_ref()) {
                        if envelope.target_bus_serial == serial_for_filter {
                            command_waiting.store(true, Ordering::SeqCst);
                            if let Err(e) = cmd_tx_clone.send(envelope) {
                                error!("Failed to send command to channel: {}", e);
                                return false;
                            }
                        }
                    }
                }
                true
            }),
        )?;

        let com = self.com.clone();
        let bus_info = self.bus_info.clone();
        let worker_command_waiting = self.command_waiting.clone();
        let meta = self.meta.clone();
        let eeprom_cache = self.eeprom_cache.clone();

        tokio::spawn(async move {
            Self::worker_loop(
                port,
                com,
                bus_info,
                done_tx,
                cmd_rx,
                worker_command_waiting,
                meta,
                eeprom_cache,
            )
            .await;
        });

        _ = done_rx.recv().await;
        let tx_queue_id = self.com.tx_queue_id.clone();
        normfs.unsubscribe(&tx_queue_id, subscription_id);
        drop(cmd_tx);

        Ok(())
    }

    fn should_break_read(command_waiting: &Arc<AtomicBool>) -> bool {
        command_waiting.load(Ordering::SeqCst)
    }

    #[allow(clippy::too_many_arguments)]
    async fn worker_loop(
        mut port: tokio_serial::SerialStream,
        com: Arc<ST3215BusCommunicator>,
        bus_info: St3215BusProto,
        done_tx: mpsc::Sender<Result<(), String>>,
        mut cmd_rx: mpsc::UnboundedReceiver<TxEnvelope>,
        command_waiting: Arc<AtomicBool>,
        meta: Arc<St3215PortMeta>,
        eeprom_cache: Arc<Mutex<HashMap<u8, Bytes>>>,
    ) {
        let mut last_seen_motors = HashSet::new();
        let mut missing_since: HashMap<u8, Instant> = HashMap::new();
        let mut interval = tokio::time::interval(Duration::from_millis(20));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut last_command_time = Instant::now();
        let mut last_search_time = Instant::now();

        loop {
            tokio::select! {
                Some(command) = cmd_rx.recv() => {
                    command_waiting.store(false, Ordering::SeqCst);
                    last_command_time = Instant::now();

                    // Calculate command receive latency
                    let now_ns = systime::get_monotonic_stamp_ns();
                    let latency_ns = now_ns.saturating_sub(command.monotonic_stamp_ns);
                    let latency_ms = latency_ns as f64 / 1_000_000.0;

                    debug!("Received ST3215 command for port {} (latency: {:.2}ms): TxEnvelope {{ monotonic_stamp_ns: {}, local_stamp_ns: {}, app_start_id: {}, target_bus_serial: {:?}, command_id: {:02X?}, write: {:?}, reg_write: {:?}, action: {:?}, reset: {:?}, reset_calibration: {:?}, freeze_calibration: {:?}, auto_calibrate: {:?}, sync_write: {:?} }}",
                        bus_info.port_name, latency_ms, command.monotonic_stamp_ns, command.local_stamp_ns, command.app_start_id, command.target_bus_serial, command.command_id, command.write, command.reg_write, command.action, command.reset, command.reset_calibration, command.freeze_calibration, command.auto_calibrate, command.sync_write);

                    let motor_id = command.get_motor_id().unwrap_or(0);

                    if Self::send_command_received_envelope(&com, &bus_info, motor_id, &command).is_err() {
                        break;
                    }

                    // Check if this is a motor ID change command
                    // We'll clear the old motor state AFTER sending the command result
                    let motor_id_to_clear = if let Some(write_cmd) = &command.write {
                        if write_cmd.address == protocol::EepromRegister::ID.address() as u32 && !write_cmd.value.is_empty() {
                            let old_motor_id = write_cmd.motor_id as u8;
                            info!(
                                "Motor ID change detected - will clear state for old motor ID {} after command completes",
                                old_motor_id
                            );
                            Some(old_motor_id)
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    if command.reset_calibration.is_some() || command.freeze_calibration.is_some() {
                        eeprom_cache.lock().clear();
                    } else if command.reset.is_some() || command.reg_write.is_some() {
                        eeprom_cache.lock().remove(&(motor_id as u8));
                    }

                    match Self::process_command(&mut port, &command, &bus_info, &meta).await {
                        Ok(processed) => {
                            let signal_type = if processed {
                                St3215SignalType::St3215CommandSuccess
                            } else {
                                St3215SignalType::St3215CommandRejected
                            };
                            if Self::send_command_result_envelope(&com, &bus_info, motor_id, &command, signal_type, None).is_err() {
                                break;
                            }
                        },
                        Err(e) => {
                            enqueue_error(&com, &bus_info, motor_id as u16, &e);
                            if Self::send_command_result_envelope(&com, &bus_info, motor_id, &command, St3215SignalType::St3215CommandFailed, Some(convert_error(&e))).is_err() {
                                break;
                            }

                            // Drain any stale bytes left in the serial buffer by the failed
                            // request so the next command starts on a clean boundary.
                            Self::drain_serial(&mut port).await;

                            match e {
                                protocol::Error::Servo { ref errors, .. } => {
                                    error!("Servo error during command processing: {:?}", errors);
                                }
                                protocol::Error::Timeout { .. } => {
                                    warn!("Timeout error during command processing on port {}", bus_info.port_name);
                                }
                                protocol::Error::Io { error: ref io_err, .. } => {
                                    error!("I/O error during command processing: {}", io_err);
                                    break;
                                }
                                _ => {
                                    error!("ST3215 error during command processing: {}", e);
                                    break;
                                }
                            }
                        }
                    }

                    // Now clear the old motor ID state AFTER command result is sent
                    if let Some(old_motor_id) = motor_id_to_clear {
                        info!("Clearing state for old motor ID {}", old_motor_id);
                        if Self::send_drive_disconnect_envelope(&com, &bus_info, old_motor_id).is_err() {
                            warn!("Failed to send disconnect signal for old motor ID {}", old_motor_id);
                        }
                        eeprom_cache.lock().remove(&old_motor_id);
                    }
                }
                _ = interval.tick() => {
                    if Self::should_break_read(&command_waiting) {
                        continue;
                    }

                    let search_for_new = last_command_time.elapsed() >= Duration::from_millis(NO_COMMAND_SEARCH_DELAY_MS) &&
                                         last_search_time.elapsed() >= Duration::from_millis(MIN_TIME_BETWEEN_SEARCHES_MS);

                    if search_for_new {
                        last_search_time = Instant::now();
                    }

                    if !Self::scan_motors(&mut port, &com, &bus_info, &mut last_seen_motors, &mut missing_since, &command_waiting, search_for_new, &eeprom_cache).await {
                        log::warn!("ST3215 port disconnected: {}", bus_info.port_name);
                        break;
                    }
                }
                else => {
                    log::warn!("ST3215 command channel closed, exiting port worker: {}", bus_info.port_name);
                    break;
                }
            }
        }

        info!("ST3215 port worker exited: {}", bus_info.port_name);
        drop(done_tx.send(Ok(())));
    }

    async fn scan_motors(
        port: &mut tokio_serial::SerialStream,
        com: &Arc<ST3215BusCommunicator>,
        bus_info: &St3215BusProto,
        last_seen_motors: &mut HashSet<u8>,
        missing_since: &mut HashMap<u8, Instant>,
        command_waiting: &Arc<AtomicBool>,
        search_for_new: bool,
        eeprom_cache: &Arc<Mutex<HashMap<u8, Bytes>>>,
    ) -> bool {
        let mut currently_seen_motors = HashSet::new();
        let eeprom_size = protocol::RamRegister::TorqueEnable.address() as usize;
        let ram_size = (protocol::RamRegister::PresentCurrent.address()
            + protocol::RamRegister::PresentCurrent.size()
            - protocol::RamRegister::TorqueEnable.address()) as usize;
        let full_size = eeprom_size + ram_size;

        for &motor_id in last_seen_motors.iter() {
            if Self::should_break_read(command_waiting) {
                return true;
            }

            let cached_eeprom = eeprom_cache.lock().get(&motor_id).cloned();

            let read_result = if cached_eeprom.is_some() {
                Self::read_motor_ram(port, motor_id, &bus_info.serial_number).await
            } else {
                Self::read_motor_config(port, motor_id, &bus_info.serial_number).await
            };

            match read_result {
                Ok(read_data) => {
                    currently_seen_motors.insert(motor_id);
                    if read_data.is_empty() {
                        continue;
                    }

                    let final_data = if let Some(eeprom) = cached_eeprom {
                        let mut combined = BytesMut::with_capacity(eeprom.len() + read_data.len());
                        combined.extend_from_slice(&eeprom);
                        combined.extend_from_slice(&read_data);
                        combined.freeze()
                    } else {
                        if read_data.len() >= eeprom_size {
                            eeprom_cache
                                .lock()
                                .insert(motor_id, read_data.slice(..eeprom_size));
                        }
                        read_data
                    };

                    if Self::send_drive_state_envelope(com, bus_info, motor_id, final_data).is_err() {
                        return false;
                    }
                }
                Err(ref e) => {
                    enqueue_error(com, bus_info, motor_id as u16, e);
                    if let protocol::Error::Servo { ref data, .. } = e {
                        currently_seen_motors.insert(motor_id);
                        if !data.is_empty() {
                            let final_data =
                                if data.len() >= full_size {
                                    // Full read (eeprom + ram)
                                    data.clone()
                                } else if data.len() >= ram_size {
                                    if let Some(eeprom) = cached_eeprom {
                                        // RAM only - prepend cached eeprom
                                        let mut combined =
                                            BytesMut::with_capacity(eeprom.len() + data.len());
                                        combined.extend_from_slice(&eeprom);
                                        combined.extend_from_slice(data);
                                        combined.freeze()
                                    } else {
                                        error!("Motor {}: servo error with RAM-only data but no EEPROM cache, sending empty. Data: {:02x?}", motor_id, data.as_ref());
                                        Bytes::new()
                                    }
                                } else {
                                    error!("Motor {}: servo error with unexpected data size {}, sending empty. Data: {:02x?}", motor_id, data.len(), data.as_ref());
                                    Bytes::new()
                                };
                            if Self::send_drive_state_envelope(
                                com,
                                bus_info,
                                motor_id,
                                final_data,
                            )
                            .is_err()
                            {
                                return false;
                            }
                        }
                    }
                }
            }
        }

        // Hysteresis: only disconnect a motor after a 100ms grace window of consecutive
        // failures, so a single transient Timeout (e.g. during another motor's reset) does
        // not evict a known-good motor.
        const DISCONNECT_GRACE_MS: u128 = 100;
        let now = Instant::now();
        let missing: Vec<u8> = last_seen_motors
            .difference(&currently_seen_motors)
            .copied()
            .collect();
        for motor_id in missing {
            let first_missed = *missing_since.entry(motor_id).or_insert(now);
            if now.duration_since(first_missed).as_millis() >= DISCONNECT_GRACE_MS {
                eeprom_cache.lock().remove(&motor_id);
                missing_since.remove(&motor_id);
                if Self::send_drive_disconnect_envelope(com, bus_info, motor_id).is_err() {
                    return false;
                }
            } else {
                // Still within grace — keep the motor in last_seen so we retry next tick.
                currently_seen_motors.insert(motor_id);
            }
        }
        // Clear grace tracker for motors that are responding again.
        for motor_id in &currently_seen_motors {
            missing_since.remove(motor_id);
        }

        if !search_for_new {
            *last_seen_motors = currently_seen_motors;
            return true;
        }

        if Self::should_break_read(command_waiting) {
            return true;
        }
        match Self::search_motors_ignoring(
            port,
            MAX_MOTORS_CNT,
            &currently_seen_motors,
            com,
            bus_info,
            command_waiting,
        )
        .await
        {
            Ok(new_motors) => {
                for motor_id in new_motors {
                    if Self::should_break_read(command_waiting) {
                        break;
                    }
                    currently_seen_motors.insert(motor_id);
                    log::info!(
                        "Detected new ST3215 motor ID on port: {} {}",
                        bus_info.port_name,
                        motor_id
                    );
                    if Self::send_drive_connect_envelope(com, bus_info, motor_id).is_err() {
                        return false;
                    }
                }
                *last_seen_motors = currently_seen_motors;
                true
            }
            Err(e) => {
                if let protocol::Error::Io {
                    error: ref io_err, ..
                } = e
                {
                    error!(
                        "I/O error during motor search: {} ({})",
                        io_err.kind(),
                        io_err
                    );
                    return false;
                }
                error!("Failed to search for new motors: {}", e);
                *last_seen_motors = currently_seen_motors;
                true
            }
        }
    }

    async fn search_motors_ignoring(
        port: &mut tokio_serial::SerialStream,
        max_motor_id: u8,
        ignore_ids: &HashSet<u8>,
        com: &Arc<ST3215BusCommunicator>,
        bus_info: &St3215BusProto,
        command_waiting: &Arc<AtomicBool>,
    ) -> Result<Vec<u8>, protocol::Error> {
        let mut found_motors = Vec::new();
        for motor_id in 1..=max_motor_id {
            if Self::should_break_read(command_waiting) {
                break;
            }
            if ignore_ids.contains(&motor_id) {
                continue;
            }

            let ping_req = protocol::ST3215Request::Ping { motor: motor_id };
            match ping_req.async_readwrite(port, 10).await {
                Ok(_) => {
                    found_motors.push(motor_id);
                }
                Err(e) => match e {
                    protocol::Error::Timeout { .. } => {}
                    protocol::Error::Io { .. } => {
                        return Err(e);
                    }
                    _ => {
                        enqueue_error(com, bus_info, motor_id as u16, &e);
                        if let protocol::Error::Servo { .. } = &e {
                            found_motors.push(motor_id);
                        } else {
                            log::debug!(
                                "Ignored error during motor search for ID {}: {}",
                                motor_id,
                                e
                            );
                        }
                    }
                },
            }
        }
        Ok(found_motors)
    }

    async fn read_motor_config(
        port: &mut tokio_serial::SerialStream,
        motor_id: u8,
        bus_serial: &str,
    ) -> Result<Bytes, protocol::Error> {
        let ram_end_addr = protocol::RamRegister::PresentCurrent.address()
            + protocol::RamRegister::PresentCurrent.size();
        let read_req = protocol::ST3215Request::Read {
            motor: motor_id,
            address: 0,
            length: ram_end_addr,
        };
        let started = Instant::now();
        let result = read_req.async_readwrite(port, ST3215_TIMEOUT_MS).await;
        let elapsed_ms = started.elapsed().as_millis();
        if elapsed_ms >= ST3215_SLOW_READ_WARN_MS {
            warn!("ST3215 slow read_motor_config: bus={} motor={} elapsed={}ms", bus_serial, motor_id, elapsed_ms);
        }
        match result? {
            protocol::ST3215Response::Read { data, .. } => Ok(data),
            _ => unreachable!(),
        }
    }

    async fn read_motor_ram(
        port: &mut tokio_serial::SerialStream,
        motor_id: u8,
        bus_serial: &str,
    ) -> Result<Bytes, protocol::Error> {
        let ram_start_addr = protocol::RamRegister::TorqueEnable.address();
        let ram_end_addr = protocol::RamRegister::PresentCurrent.address()
            + protocol::RamRegister::PresentCurrent.size();
        let read_req = protocol::ST3215Request::Read {
            motor: motor_id,
            address: ram_start_addr,
            length: ram_end_addr - ram_start_addr,
        };
        let started = Instant::now();
        let result = read_req.async_readwrite(port, ST3215_TIMEOUT_MS).await;
        let elapsed_ms = started.elapsed().as_millis();
        if elapsed_ms >= ST3215_SLOW_READ_WARN_MS {
            warn!("ST3215 slow read_motor_ram: bus={} motor={} elapsed={}ms", bus_serial, motor_id, elapsed_ms);
        }
        match result? {
            protocol::ST3215Response::Read { data, .. } => Ok(data),
            _ => unreachable!(),
        }
    }

    fn send_command_received_envelope(
        com: &Arc<ST3215BusCommunicator>,
        bus_info: &St3215BusProto,
        motor_id: u32,
        command: &TxEnvelope,
    ) -> Result<(), String> {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: St3215SignalType::St3215Command as i32,
            bus: Some(bus_info.clone()),
            motor_id,
            command: Some(command.clone()),
            ..Default::default()
        };
        com.send_rx(&envelope).map_err(|e| {
            let err_msg = format!("Failed to send ST3215 envelope: {}", e);
            error!("{}", err_msg);
            err_msg
        })
    }

    fn send_command_result_envelope(
        com: &Arc<ST3215BusCommunicator>,
        bus_info: &St3215BusProto,
        motor_id: u32,
        command: &TxEnvelope,
        result: St3215SignalType,
        error: Option<St3215Error>,
    ) -> Result<(), String> {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: result as i32,
            bus: Some(bus_info.clone()),
            motor_id,
            command: Some(command.clone()),
            error,
            ..Default::default()
        };
        com.send_rx(&envelope).map_err(|e| {
            let err_msg = format!("Failed to send ST3215 envelope: {}", e);
            error!("{}", err_msg);
            err_msg
        })
    }

    fn send_drive_connect_envelope(
        com: &Arc<ST3215BusCommunicator>,
        bus_info: &St3215BusProto,
        motor_id: u8,
    ) -> Result<(), String> {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: St3215SignalType::St3215DriveConnect as i32,
            bus: Some(bus_info.clone()),
            motor_id: motor_id as u32,
            ..Default::default()
        };
        com.send_rx(&envelope).map_err(|e| {
            let err_msg = format!("Failed to send ST3215 envelope: {}", e);
            error!("{}", err_msg);
            err_msg
        })
    }

    fn send_drive_disconnect_envelope(
        com: &Arc<ST3215BusCommunicator>,
        bus_info: &St3215BusProto,
        motor_id: u8,
    ) -> Result<(), String> {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: St3215SignalType::St3215DriveDisconnect as i32,
            bus: Some(bus_info.clone()),
            motor_id: motor_id as u32,
            ..Default::default()
        };
        com.send_rx(&envelope).map_err(|e| {
            let err_msg = format!("Failed to send ST3215 envelope: {}", e);
            error!("{}", err_msg);
            err_msg
        })
    }

    fn send_drive_state_envelope(
        com: &Arc<ST3215BusCommunicator>,
        bus_info: &St3215BusProto,
        motor_id: u8,
        data: Bytes,
    ) -> Result<(), String> {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: St3215SignalType::St3215DriveState as i32,
            bus: Some(bus_info.clone()),
            motor_id: motor_id as u32,
            data,
            ..Default::default()
        };
        com.send_rx(&envelope).map_err(|e| {
            let err_msg = format!("Failed to send ST3215 envelope: {}", e);
            error!("{}", err_msg);
            err_msg
        })
    }

    async fn process_command(
        port: &mut tokio_serial::SerialStream,
        command: &TxEnvelope,
        bus_info: &St3215BusProto,
        meta: &St3215PortMeta,
    ) -> Result<bool, protocol::Error> {
        // Handle different command types
        if let Some(write_cmd) = &command.write {
            // Handle write command
            info!(
                "Processing ST3215 Write command - Motor: {}, Address: 0x{:02X}, Value: {:?}",
                write_cmd.motor_id, write_cmd.address, write_cmd.value
            );

            let request = protocol::ST3215Request::Write {
                motor: write_cmd.motor_id as u8,
                address: write_cmd.address as u8,
                data: write_cmd.value.clone(),
            };

            // Use async_readwrite which handles response type validation
            let response = request
                .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                .await?;
            info!(
                "ST3215 Write command completed - Motor: {}, Response: {:?}",
                write_cmd.motor_id, response
            );
        } else if let Some(reg_write_cmd) = &command.reg_write {
            // Handle register write command
            info!(
                "Processing ST3215 RegWrite command - Motor: {}, Address: 0x{:02X}, Value: {:?}",
                reg_write_cmd.motor_id, reg_write_cmd.address, reg_write_cmd.value
            );

            let request = protocol::ST3215Request::RegWrite {
                motor: reg_write_cmd.motor_id as u8,
                address: reg_write_cmd.address as u8,
                data: reg_write_cmd.value.clone(),
            };

            // Use async_readwrite which handles response type validation
            let response = request
                .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                .await?;
            info!(
                "ST3215 RegWrite command completed - Motor: {}, Response: {:?}",
                reg_write_cmd.motor_id, response
            );
        } else if let Some(action_cmd) = &command.action {
            // Handle action command
            info!(
                "Processing ST3215 Action command - Motor: {}",
                action_cmd.motor_id
            );

            let request = protocol::ST3215Request::Action {
                motor: action_cmd.motor_id as u8,
            };

            // Use async_readwrite which handles response type validation
            let response = request
                .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                .await?;
            info!(
                "ST3215 Action command completed - Motor: {}, Response: {:?}",
                action_cmd.motor_id, response
            );
        } else if let Some(sync_write_cmd) = &command.sync_write {
            // Handle sync write command
            if sync_write_cmd.motors.is_empty() {
                warn!("ST3215 SyncWrite command has no motors, skipping");
                return Ok(true);
            }

            debug!(
                "Processing ST3215 SyncWrite command - Address: 0x{:02X}, Motors: {}",
                sync_write_cmd.address,
                sync_write_cmd.motors.len()
            );

            let motor_data: Vec<(u8, bytes::Bytes)> = sync_write_cmd
                .motors
                .iter()
                .map(|m| (m.motor_id as u8, m.value.clone()))
                .collect();

            let request = protocol::ST3215Request::SyncWrite {
                address: sync_write_cmd.address as u8,
                data: motor_data,
            };

            // Use async_write since SyncWrite doesn't expect individual responses
            request.async_write(port, ST3215_COMMAND_TIMEOUT_MS).await?;
            debug!(
                "ST3215 SyncWrite command completed - {} motors updated",
                sync_write_cmd.motors.len()
            );
        } else if let Some(reset_cmd) = &command.reset {
            // Handle reset command
            info!(
                "Processing ST3215 Reset command - Motor: {}",
                reset_cmd.motor_id
            );

            let motor_id = reset_cmd.motor_id as u8;
            let request = protocol::ST3215Request::Reset { motor: motor_id };

            // Write Reset and read its ack in a single round-trip — sharing the timeout
            // window keeps the request/response pairing intact.
            let response = request
                .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                .await?;
            info!(
                "ST3215 Reset command completed - Motor: {}, Response: {:?}",
                motor_id, response
            );

            // Block the worker until the servo finishes rebooting so the next scan
            // tick doesn't read a still-rebooting motor and evict it. Settle first so
            // the ping doesn't land before the motor has actually begun resetting,
            // then poll up to RESET_REBOOT_TIMEOUT_MS for a fast path.
            const RESET_SETTLE_MS: u64 = 100;
            const RESET_REBOOT_TIMEOUT_MS: u64 = 200;
            const RESET_POLL_INTERVAL_MS: u64 = 20;
            tokio::time::sleep(Duration::from_millis(RESET_SETTLE_MS)).await;
            let reboot_start = Instant::now();
            let mut online = false;
            while reboot_start.elapsed() < Duration::from_millis(RESET_REBOOT_TIMEOUT_MS) {
                let ping_req = protocol::ST3215Request::Ping { motor: motor_id };
                if ping_req
                    .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                    .await
                    .is_ok()
                {
                    info!(
                        "Motor {} back online {}ms after reset settle",
                        motor_id,
                        reboot_start.elapsed().as_millis()
                    );
                    online = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(RESET_POLL_INTERVAL_MS)).await;
            }
            if !online {
                warn!(
                    "Motor {} did not respond within {}ms after reset settle",
                    motor_id, RESET_REBOOT_TIMEOUT_MS
                );
            }
        } else if command
            .reset_calibration
            .as_ref()
            .map(|r| r.reset)
            .unwrap_or(false)
        {
            info!("Processing ST3215 Reset Calibration command for all motors.");
            let mut all_ok = true;
            for motor_id in 1..=MAX_MOTORS_CNT {
                match Self::reset_calibration(port, motor_id).await {
                    Ok(verified) => {
                        if motor_id <= 6 {
                            all_ok &= verified;
                        }
                    }
                    Err(e) => {
                        warn!("Failed to reset calibration for motor {}: {}", motor_id, e);
                        if motor_id <= 6 {
                            all_ok = false;
                        }
                    }
                }
            }
            if !all_ok {
                return Ok(false);
            }
        } else if command
            .freeze_calibration
            .as_ref()
            .map(|f| f.freeze)
            .unwrap_or(false)
        {
            info!("Processing ST3215 FreezeCalibration command for all motors.");

            // Extract midpoints from provided arcs if available
            let freeze_cmd = command.freeze_calibration.as_ref().unwrap();
            let mut midpoints: std::collections::HashMap<u8, u16> = std::collections::HashMap::new();

            for arc in &freeze_cmd.arcs {
                if arc.midpoint > 0 {
                    midpoints.insert(arc.motor_id as u8, arc.midpoint as u16);
                    info!("Motor {}: Using provided midpoint from command: {}", arc.motor_id, arc.midpoint);
                }
            }

            let mut all_ok = true;
            let max_motors_cnt = if !freeze_cmd.arcs.is_empty() {
                freeze_cmd.arcs.len() as u8
            } else {
                MAX_MOTORS_CNT
            };

            for motor_id in 1..=max_motors_cnt {
                // Send hardware reset without unlocking EEPROM
                let reset_req = protocol::ST3215Request::Reset { motor: motor_id };
                if let Err(e) = reset_req.async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS).await {
                    warn!("Failed to send reset to motor {}: {}", motor_id, e);
                } else {
                    info!("FreezeCalibration: Hardware reset completed for motor {}", motor_id);
                }
                
                let provided_midpoint = midpoints.get(&motor_id).copied();
                match Self::freeze_calibration(port, motor_id, meta, bus_info, provided_midpoint, max_motors_cnt).await {
                    Ok(verified) => {
                        if !verified {
                            warn!(
                                "Motor {} freeze_calibration completed but not all writes verified, marking command as rejected",
                                motor_id
                            );
                        }
                        all_ok &= verified;
                    }
                    Err(e) => {
                        warn!("Failed to freeze calibration for motor {}: {}", motor_id, e);
                        all_ok = false;
                    }
                }
            }
            if !all_ok {
                return Ok(false);
            }
        } else if command
            .auto_calibrate
            .as_ref()
            .map(|c| c.calibrate)
            .unwrap_or(false)
        {
            info!("Processing ST3215 AutoCalibrate command.");
            if let Err(e) = Self::auto_calibrate(port, bus_info, meta).await {
                warn!("Auto-calibration failed: {}", e);
            }
        } else {
            info!(
                "Got cmd {:?} TxEnvelope, just enqueue as success for now.",
                command.command_id
            );
            return Ok(true);
        }

        Ok(true)
    }

    /// Drain any leftover bytes from the serial port. Used after a failed request to
    /// clear stale/late response bytes that would otherwise desync the next request.
    /// Bounded by a short read timeout so the drain itself can't hang.
    async fn drain_serial(port: &mut tokio_serial::SerialStream) {
        let mut buf = [0u8; 256];
        let mut total = 0usize;
        loop {
            match tokio::time::timeout(Duration::from_millis(5), port.read(&mut buf)).await {
                Ok(Ok(n)) if n > 0 => {
                    total += n;
                    continue;
                }
                _ => break,
            }
        }
        if total > 0 {
            warn!("Drained {} stale bytes from serial port", total);
        }
    }

    /// Helper: RegWrite + Action pattern for EEPROM writes with read-back verification and retries.
    /// On any error the serial port is drained (to clear stale bytes from a partial / late
    /// response) and the attempt is retried.
    pub async fn reg_write_with_action(
        port: &mut tokio_serial::SerialStream,
        motor_id: u8,
        register: protocol::EepromRegister,
        data: Bytes,
    ) -> Result<bool, protocol::Error> {
        const MAX_RETRIES: u8 = 5;

        for attempt in 1..=MAX_RETRIES {
            info!(
                "EEPROM write motor {}: 0x{:02X} = {:02x?} (attempt {}/{})",
                motor_id, register.address(), data.as_ref(), attempt, MAX_RETRIES
            );

            let reg_write_req = protocol::ST3215Request::RegWrite {
                motor: motor_id,
                address: register.address(),
                data: data.clone(),
            };
            if let Err(e) = reg_write_req
                .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                .await
            {
                warn!(
                    "EEPROM RegWrite failed motor {}: 0x{:02X}: {} (attempt {}/{})",
                    motor_id, register.address(), e, attempt, MAX_RETRIES
                );
                Self::drain_serial(port).await;
                continue;
            }

            let action_req = protocol::ST3215Request::Action { motor: motor_id };
            if let Err(e) = action_req
                .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                .await
            {
                warn!(
                    "EEPROM Action failed motor {}: 0x{:02X}: {} (attempt {}/{})",
                    motor_id, register.address(), e, attempt, MAX_RETRIES
                );
                Self::drain_serial(port).await;
                continue;
            }

            // Read back and verify
            let read_req = protocol::ST3215Request::Read {
                motor: motor_id,
                address: register.address(),
                length: register.size(),
            };
            match read_req.async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS).await {
                Ok(protocol::ST3215Response::Read { data: readback, .. }) => {
                    if readback.as_ref() == data.as_ref() {
                        info!(
                            "EEPROM write verified motor {}: 0x{:02X} = {:02x?}",
                            motor_id, register.address(), data.as_ref()
                        );
                        return Ok(true);
                    }
                    warn!(
                        "EEPROM verify mismatch motor {}: 0x{:02X} expected {:02x?} got {:02x?} (attempt {}/{})",
                        motor_id, register.address(), data.as_ref(), readback.as_ref(), attempt, MAX_RETRIES
                    );
                }
                Ok(_) => {
                    warn!(
                        "EEPROM verify unexpected response motor {}: 0x{:02X} (attempt {}/{})",
                        motor_id, register.address(), attempt, MAX_RETRIES
                    );
                }
                Err(e) => {
                    warn!(
                        "EEPROM verify read failed motor {}: 0x{:02X}: {} (attempt {}/{})",
                        motor_id, register.address(), e, attempt, MAX_RETRIES
                    );
                    Self::drain_serial(port).await;
                }
            }
        }

        error!(
            "EEPROM write failed after {} retries motor {}: 0x{:02X} = {:02x?}",
            MAX_RETRIES, motor_id, register.address(), data.as_ref()
        );
        Ok(false)
    }

    /// Helper: Write + Action pattern for RAM registers with read-back verification and retries.
    /// On any error the serial port is drained and the attempt is retried.
    pub async fn ram_write_with_action(
        port: &mut tokio_serial::SerialStream,
        motor_id: u8,
        register: protocol::RamRegister,
        data: Bytes,
    ) -> Result<bool, protocol::Error> {
        const MAX_RETRIES: u8 = 5;

        for attempt in 1..=MAX_RETRIES {
            info!(
                "RAM write motor {}: 0x{:02X} = {:02x?} (attempt {}/{})",
                motor_id, register.address(), data.as_ref(), attempt, MAX_RETRIES
            );

            let write_req = protocol::ST3215Request::Write {
                motor: motor_id,
                address: register.address(),
                data: data.clone(),
            };
            if let Err(e) = write_req
                .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                .await
            {
                warn!(
                    "RAM Write failed motor {}: 0x{:02X}: {} (attempt {}/{})",
                    motor_id, register.address(), e, attempt, MAX_RETRIES
                );
                Self::drain_serial(port).await;
                continue;
            }

            let action_req = protocol::ST3215Request::Action { motor: motor_id };
            if let Err(e) = action_req
                .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
                .await
            {
                warn!(
                    "RAM Action failed motor {}: 0x{:02X}: {} (attempt {}/{})",
                    motor_id, register.address(), e, attempt, MAX_RETRIES
                );
                Self::drain_serial(port).await;
                continue;
            }

            let read_req = protocol::ST3215Request::Read {
                motor: motor_id,
                address: register.address(),
                length: register.size(),
            };
            match read_req.async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS).await {
                Ok(protocol::ST3215Response::Read { data: readback, .. }) => {
                    if readback.as_ref() == data.as_ref() {
                        info!(
                            "RAM write verified motor {}: 0x{:02X} = {:02x?}",
                            motor_id, register.address(), data.as_ref()
                        );
                        return Ok(true);
                    }
                    warn!(
                        "RAM verify mismatch motor {}: 0x{:02X} expected {:02x?} got {:02x?} (attempt {}/{})",
                        motor_id, register.address(), data.as_ref(), readback.as_ref(), attempt, MAX_RETRIES
                    );
                }
                Ok(_) => {
                    warn!(
                        "RAM verify unexpected response motor {}: 0x{:02X} (attempt {}/{})",
                        motor_id, register.address(), attempt, MAX_RETRIES
                    );
                }
                Err(e) => {
                    warn!(
                        "RAM verify read failed motor {}: 0x{:02X}: {} (attempt {}/{})",
                        motor_id, register.address(), e, attempt, MAX_RETRIES
                    );
                    Self::drain_serial(port).await;
                }
            }
        }

        error!(
            "RAM write failed after {} retries motor {}: 0x{:02X} = {:02x?}",
            MAX_RETRIES, motor_id, register.address(), data.as_ref()
        );
        Ok(false)
    }

    pub async fn reset_calibration(
        port: &mut tokio_serial::SerialStream,
        motor_id: u8,
    ) -> Result<bool, protocol::Error> {
        info!(
            "Processing ST3215 ResetCalibration command - Motor: {}",
            motor_id
        );

        // Step 1: RegWrite to lock register with 0
        info!("ResetCalibration: Unlocking EEPROM for motor {}", motor_id);
        let lock_reg_write_req = protocol::ST3215Request::Write {
            motor: motor_id,
            address: protocol::RamRegister::Lock.address(),
            data: Bytes::from_static(&[0]),
        };
        lock_reg_write_req
            .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
            .await?;
        info!("ResetCalibration: EEPROM unlocked for motor {}", motor_id);

        // action
        let action_req = protocol::ST3215Request::Action { motor: motor_id };
        action_req
            .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
            .await?;

        // Step 2: Reset
        info!("ResetCalibration: Resetting motor {}", motor_id);
        let reset_req = protocol::ST3215Request::Reset { motor: motor_id };
        reset_req
            .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
            .await?;
        info!("ResetCalibration: Motor {} reset", motor_id);

        // action
        let action_req = protocol::ST3215Request::Action { motor: motor_id };
        action_req
            .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
            .await?;

        // write zero offset
        let verified = Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::Offset,
            Bytes::from_static(&[0, 0]),
        )
        .await?;
        info!("ResetCalibration: Offset zeroed for motor {}", motor_id);

        // Step 3: RegWrite to lock register with 1
        info!("ResetCalibration: Locking EEPROM for motor {}", motor_id);
        let unlock_reg_write_req = protocol::ST3215Request::Write {
            motor: motor_id,
            address: protocol::RamRegister::Lock.address(),
            data: Bytes::from_static(&[1]),
        };
        unlock_reg_write_req
            .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
            .await?;
        info!("ResetCalibration: EEPROM locked for motor {}", motor_id);

        // Step 4: Action
        info!("ResetCalibration: Triggering action for motor {}", motor_id);
        let action_req = protocol::ST3215Request::Action { motor: motor_id };
        action_req
            .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
            .await?;
        info!("ResetCalibration: Action triggered for motor {}", motor_id);

        info!(
            "ST3215 ResetCalibration command completed for Motor: {}",
            motor_id
        );
        Ok(verified)
    }

    pub async fn auto_calibrate(
        port: &mut tokio_serial::SerialStream,
        bus_info: &St3215BusProto,
        meta: &St3215PortMeta,
    ) -> Result<(), protocol::Error> {
        crate::auto_calibrate::calibrate(port, bus_info, meta).await.map(|_| ())
    }

    pub async fn freeze_calibration(
        port: &mut tokio_serial::SerialStream,
        motor_id: u8,
        meta: &St3215PortMeta,
        bus_info: &St3215BusProto,
        provided_midpoint: Option<u16>,
        max_motors_cnt: u8,
    ) -> Result<bool, protocol::Error> {
        // 1. Get midpoint - use provided if available, otherwise calculate
        let midpoint = if let Some(mp) = provided_midpoint {
            info!("Motor {}: Using provided midpoint {}", motor_id, mp);
            mp
        } else {
            match meta.get_midpoint(motor_id) {
                Some(mp) => {
                    info!("Motor {}: Calculated midpoint {}", motor_id, mp);
                    mp
                }
                None => {
                    warn!(
                        "Could not calculate midpoint for motor {}. No calibration data?",
                        motor_id
                    );
                    // Not a protocol error, but we can't proceed.
                    return Ok(true);
                }
            }
        };

        let mut correction = (midpoint as i16) - 2048;

        // Wrap offset to stay within -2047..2047 range
        if correction > 2047 {
            correction = correction - 4096;
        } else if correction < -2047 {
            correction = correction + 4096;
        }
        correction = correction.clamp(-2047, 2047);

        info!(
            "bus: {}, motor: {}, midpoint: {}, correction: {}",
            bus_info.serial_number, motor_id, midpoint, correction
        );

        // 2. Unlock EPROM
        info!("FreezeCalibration: Unlocking EEPROM for motor {}", motor_id);
        let mut all_verified = Self::ram_write_with_action(
            port,
            motor_id,
            protocol::RamRegister::Lock,
            Bytes::from_static(&[0x00]),
        )
        .await?;
        info!("FreezeCalibration: EEPROM unlocked for motor {}", motor_id);

        let pid = pid_config_for_motor_count(max_motors_cnt);
        info!(
            "Applying custom calibration settings for motor {} (PID: p={}, i={}, d={})",
            motor_id, pid.p, pid.i, pid.d
        );
        // Set operating mode to position control
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::Mode,
            Bytes::from_static(&[0]),
        )
        .await?;
        // Set P_Coefficient
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::PCoef,
            Bytes::from(vec![pid.p]),
        )
        .await?;
        // Set I_Coefficient
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::ICoef,
            Bytes::from(vec![pid.i]),
        )
        .await?;
        // Set D_Coefficient
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::DCoef,
            Bytes::from(vec![pid.d]),
        )
        .await?;
        // Set Return Delay Time to 0
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::ReturnDelay,
            Bytes::from_static(&[0]),
        )
        .await?;
        // Set Max Torque
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::MaxTorque,
            Bytes::copy_from_slice(&DEFAULT_MAX_TORQUE.to_le_bytes()),
        )
        .await?;
        // Set Protection Current
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::ProtectionCurrent,
            Bytes::copy_from_slice(&DEFAULT_PROTECTION_CURRENT.to_le_bytes()),
        )
        .await?;
        // Set Overload Torque
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::OverloadTorque,
            Bytes::from_static(&[DEFAULT_OVERLOAD_TORQUE]),
        )
        .await?;

        // Set Acceleration in RAM (best-effort: some motor firmware clamps this register,
        // so verify mismatches must not fail the whole freeze).
        let _ = Self::ram_write_with_action(
            port,
            motor_id,
            protocol::RamRegister::Acc,
            Bytes::from_static(&[DEFAULT_ACCEL]),
        )
        .await?;

        // 3. Position correction write
        all_verified &= Self::reg_write_with_action(
            port,
            motor_id,
            protocol::EepromRegister::Offset,
            Bytes::from(vec![correction as u8, (correction >> 8) as u8]),
        )
        .await?;
        info!(
            "FreezeCalibration: Position correction written for motor {}",
            motor_id
        );

        // 4. Lock EPROM
        info!("FreezeCalibration: Locking EEPROM for motor {}", motor_id);
        all_verified &= Self::ram_write_with_action(
            port,
            motor_id,
            protocol::RamRegister::Lock,
            Bytes::from_static(&[0x01]),
        )
        .await?;
        info!("FreezeCalibration: EEPROM locked for motor {}", motor_id);

        // 5. Action command to trigger the writes
        info!(
            "FreezeCalibration: Triggering action for motor {}",
            motor_id
        );
        let action_req = protocol::ST3215Request::Action { motor: motor_id };
        action_req
            .async_readwrite(port, ST3215_COMMAND_TIMEOUT_MS)
            .await?;
        info!("FreezeCalibration: Action triggered for motor {}", motor_id);

        info!(
            "ST3215 FreezeCalibration command completed for Motor: {}",
            motor_id
        );
        Ok(all_verified)
    }
}

impl TxEnvelope {
    fn get_motor_id(&self) -> Option<u32> {
        if let Some(write) = &self.write {
            Some(write.motor_id)
        } else if let Some(reg_write) = &self.reg_write {
            Some(reg_write.motor_id)
        } else if let Some(action) = &self.action {
            Some(action.motor_id)
        } else if let Some(reset) = &self.reset {
            Some(reset.motor_id)
        } else if self.sync_write.is_some() {
            // SyncWrite is a broadcast command
            Some(protocol::BROADCAST_ID as u32)
        } else {
            None
        }
    }
}

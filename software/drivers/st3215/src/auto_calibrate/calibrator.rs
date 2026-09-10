/// Generic ST3215 motor calibrator for any robot configuration

use crate::calibrate;
use crate::presets::*;
use crate::protocol::{RamRegister, EepromRegister};
use crate::st3215_proto::{FreezeCalibrationCommand, FreezeMotorArc, InferenceState, TxEnvelope};
use crate::state::ST3215BusCommunicator;
use bytes::Bytes;
use log::info;
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::watch;
use tokio::time::Duration;

const VELOCITY_THRESHOLD: u16 = 10;
const SKIP_INITIAL_SAMPLES: u32 = 3;
const MOTOR_STARTUP_STEPS: u32 = 4;
const MIN_DISPLACEMENT: u32 = 5;
const MAX_READS_WITHOUT_DISPLACEMENT: u32 = 100;
const CALIBRATION_STEP: u16 = 1020;
const SAFE_OFFSET: u16 = 60;

pub struct ST3215Calibrator {
    target_bus_serial: String,
    comm: Arc<ST3215BusCommunicator>,
    inference_rx: watch::Receiver<InferenceState>,
    command_counter: u64,
    motor_positions: HashMap<u8, BTreeSet<u16>>,
    stop_requested: Arc<AtomicBool>,
    current_step: u32,
    total_steps: u32,
    active_motors: Vec<u8>,
}

impl ST3215Calibrator {
    pub fn new(
        target_bus_serial: String,
        comm: Arc<ST3215BusCommunicator>,
        inference_rx: watch::Receiver<InferenceState>,
        stop_requested: Arc<AtomicBool>,
    ) -> Self {
        Self {
            target_bus_serial,
            comm,
            inference_rx,
            command_counter: 0,
            motor_positions: HashMap::new(),
            stop_requested,
            current_step: 0,
            total_steps: 0,
            active_motors: Vec::new(),
        }
    }

    pub fn set_active_motors(&mut self, motor_ids: Vec<u8>) {
        self.active_motors = motor_ids;
    }

    pub fn set_total_steps(&mut self, total: u32) {
        self.total_steps = total;
        self.current_step = 0;
    }

    pub async fn next_step(&mut self, phase: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.check_stop().await?;
        self.current_step += 1;
        info!("Calibration step {}/{}: {}", self.current_step, self.total_steps, phase);
        self.update_calibration_state(phase, crate::state::CalibrationStatus::InProgress, None);
        Ok(())
    }

    fn update_calibration_state(&self, phase: &str, status: crate::state::CalibrationStatus, error_message: Option<&str>) {
        self.comm.update_calibration_progress(
            &self.target_bus_serial,
            self.current_step,
            self.total_steps,
            phase,
            status,
            error_message,
        );
    }

    pub fn mark_done(&mut self) {
        info!("Calibration completed successfully");
        self.update_calibration_state("Completed", crate::state::CalibrationStatus::Done, None);
    }

    pub fn mark_failed(&mut self, error: &str) {
        info!("Calibration failed: {}", error);
        self.update_calibration_state("Failed", crate::state::CalibrationStatus::Failed, Some(error));
    }

    pub fn is_stopped(&self) -> bool {
        self.stop_requested.load(Ordering::Relaxed)
    }

    pub async fn save_calibration(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Saving calibration for bus {}", self.target_bus_serial);

        const FULL_RANGE: u32 = 4096;
        const MAX_ANGLE_STEP: u32 = 4095;

        let motor_ids = self.active_motors.clone();
        let mut motor_arcs: Vec<FreezeMotorArc> = Vec::new();

        for motor_id in motor_ids {
            let positions = match self.motor_positions.get(&motor_id) {
                Some(p) if !p.is_empty() => p,
                _ => {
                    log::warn!("Motor {}: No calibration data, skipping", motor_id);
                    continue;
                }
            };

            let arc = calibrate::calculate_arc(positions);
            let arc_min = arc.min as u32;
            let arc_max = arc.max as u32;

            let midpoint = if arc_max >= arc_min {
                let range_size = arc_max - arc_min;
                arc_min + range_size / 2
            } else {
                let range_size = (FULL_RANGE - arc_min) + arc_max;
                (arc_min + range_size / 2) & MAX_ANGLE_STEP
            };

            info!(
                "Motor {}: Sending arc min={} max={} midpoint={}",
                motor_id, arc_min, arc_max, midpoint
            );

            motor_arcs.push(FreezeMotorArc {
                motor_id: motor_id as u32,
                min_angle: arc_min,
                max_angle: arc_max,
                midpoint,
            });
        }

        let arcs_count = motor_arcs.len();
        let command_id = self.next_command_id();
        let envelope = TxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            target_bus_serial: self.target_bus_serial.clone(),
            command_id,
            freeze_calibration: Some(FreezeCalibrationCommand {
                freeze: true,
                arcs: motor_arcs,
            }),
            ..Default::default()
        };
        self.comm.send_tx(&envelope);

        info!("Calibration freeze command sent with {} motor arcs", arcs_count);
        Ok(())
    }

    pub async fn disable_all_motors_torque(&mut self, motor_ids: &[u8]) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if motor_ids.is_empty() {
            return Ok(());
        }

        info!("Disabling torque for motors: {:?}", motor_ids);

        // Use sync_write to disable torque for all motors at once
        let command_id = self.next_command_id();
        let motor_writes: Vec<_> = motor_ids
            .iter()
            .map(|&motor_id| crate::st3215_proto::st3215_sync_write_command::MotorWrite {
                motor_id: motor_id as u32,
                value: vec![0].into(), // TorqueEnable = 0
            })
            .collect();

        let envelope = TxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            target_bus_serial: self.target_bus_serial.clone(),
            command_id: command_id.clone(),
            sync_write: Some(crate::st3215_proto::St3215SyncWriteCommand {
                address: RamRegister::TorqueEnable.address() as u32,
                motors: motor_writes,
            }),
            ..Default::default()
        };

        self.comm.send_tx(&envelope);
        self.wait_for_command_result(&command_id).await?;

        info!("Torque disabled for all motors");
        Ok(())
    }

    async fn check_stop(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if self.is_stopped() {
            info!("Stop detected - disabling torque for all motors");
            let active_motors = self.active_motors.clone();
            if let Err(e) = self.disable_all_motors_torque(&active_motors).await {
                log::error!("Failed to disable torque on stop: {}", e);
            }
            self.update_calibration_state("Stopped by user", crate::state::CalibrationStatus::Stopped, None);
            Err("Calibration stopped by user".into())
        } else {
            Ok(())
        }
    }

    fn next_command_id(&mut self) -> Bytes {
        self.command_counter += 1;
        Bytes::from(self.command_counter.to_le_bytes().to_vec())
    }

    async fn wait_for_command_result(&mut self, command_id: &Bytes) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let timeout = Duration::from_secs(5);
        let deadline = tokio::time::Instant::now() + timeout;

        loop {
            tokio::select! {
                Ok(()) = self.inference_rx.changed() => {
                    let state = self.inference_rx.borrow().clone();

                    // Check all buses for command result
                    for bus in &state.buses {
                        if bus.bus.as_ref().map(|b| b.serial_number.as_str()) == Some(&self.target_bus_serial) {
                            // Check motors for command result - if we see the command_id, it completed
                            for motor in &bus.motors {
                                if let Some(last_command) = &motor.last_command {
                                    if let Some(cmd) = &last_command.command {
                                        if &cmd.command_id == command_id {
                                            return Ok(());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                _ = tokio::time::sleep_until(deadline) => {
                    return Err("Command timeout".into());
                }
            }
        }
    }

    async fn send_write(&mut self, motor_id: u8, address: u8, value: Vec<u8>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let command_id = self.next_command_id();
        let envelope = TxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            target_bus_serial: self.target_bus_serial.clone(),
            command_id: command_id.clone(),
            write: Some(crate::st3215_proto::St3215WriteCommand {
                motor_id: motor_id as u32,
                address: address as u32,
                value: value.into(),
            }),
            ..Default::default()
        };
        self.comm.send_tx(&envelope);
        self.wait_for_command_result(&command_id).await
    }

    pub async fn send_write_verified(&mut self, motor_id: u8, address: u8, value: Vec<u8>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Send the write
        self.send_write(motor_id, address, value.clone()).await?;

        // Wait for value to appear in registers
        let timeout = Duration::from_secs(5);
        let deadline = tokio::time::Instant::now() + timeout;
        let max_retries = 5;
        let mut attempt = 0;

        loop {
            tokio::select! {
                Ok(()) = self.inference_rx.changed() => {
                    let state = self.inference_rx.borrow().clone();
                    if let Some(bus) = state.buses.iter().find(|b| {
                        b.bus.as_ref().map(|b| b.serial_number.as_str()) == Some(&self.target_bus_serial)
                    }) {
                        if let Some(motor) = bus.motors.iter().find(|m| m.id == motor_id as u32) {
                            // Check if value matches
                            let addr = address as usize;
                            if motor.state.len() >= addr + value.len() {
                                let current_value = &motor.state[addr..addr + value.len()];
                                if current_value == value.as_slice() {
                                    return Ok(());
                                }
                            }
                        }
                    }
                }
                _ = tokio::time::sleep_until(deadline) => {
                    attempt += 1;
                    if attempt >= max_retries {
                        return Err("EEPROM write verification timeout".into());
                    }
                }
            }
        }
    }

    async fn send_eeprom_write(&mut self, motor_id: u8, address: u8, value: Vec<u8>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Unlock EEPROM
        self.unlock_eeprom(motor_id).await?;

        // Send reg_write
        let reg_write_id = self.next_command_id();
        let reg_write_envelope = TxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            target_bus_serial: self.target_bus_serial.clone(),
            command_id: reg_write_id.clone(),
            reg_write: Some(crate::st3215_proto::St3215RegWriteCommand {
                motor_id: motor_id as u32,
                address: address as u32,
                value: value.into(),
            }),
            ..Default::default()
        };
        self.comm.send_tx(&reg_write_envelope);
        self.wait_for_command_result(&reg_write_id).await?;

        // Send action to execute the reg_write
        let action_id = self.next_command_id();
        let action_envelope = TxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            target_bus_serial: self.target_bus_serial.clone(),
            command_id: action_id.clone(),
            action: Some(crate::st3215_proto::St3215ActionCommand {
                motor_id: motor_id as u32,
            }),
            ..Default::default()
        };
        self.comm.send_tx(&action_envelope);
        self.wait_for_command_result(&action_id).await?;

        // Lock EEPROM
        self.lock_eeprom(motor_id).await
    }

    pub async fn send_eeprom_write_verified(&mut self, motor_id: u8, address: u8, value: Vec<u8>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Send the EEPROM write
        self.send_eeprom_write(motor_id, address, value.clone()).await?;

        // Wait for value to appear in EEPROM registers
        let timeout = Duration::from_secs(5);
        let deadline = tokio::time::Instant::now() + timeout;
        let max_retries = 5;
        let mut attempt = 0;

        loop {
            tokio::select! {
                Ok(()) = self.inference_rx.changed() => {
                    let state = self.inference_rx.borrow().clone();
                    if let Some(bus) = state.buses.iter().find(|b| {
                        b.bus.as_ref().map(|b| b.serial_number.as_str()) == Some(&self.target_bus_serial)
                    }) {
                        if let Some(motor) = bus.motors.iter().find(|m| m.id == motor_id as u32) {
                            // Check if value matches in EEPROM registers
                            let addr = address as usize;
                            if motor.state.len() >= addr + value.len() {
                                let current_value = &motor.state[addr..addr + value.len()];
                                if current_value == value.as_slice() {
                                    return Ok(());
                                }
                            }
                        }
                    }
                }
                _ = tokio::time::sleep_until(deadline) => {
                    attempt += 1;
                    if attempt >= max_retries {
                        return Err("EEPROM write verification timeout".into());
                    }
                }
            }
        }
    }

    pub async fn unlock_eeprom(&mut self, motor_id: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.send_write_verified(motor_id, RamRegister::Lock.address(), vec![0]).await
    }

    pub async fn lock_eeprom(&mut self, motor_id: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.send_write_verified(motor_id, RamRegister::Lock.address(), vec![1]).await
    }

    pub async fn send_reset(&mut self, motor_id: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Motor {} - Sending reset command", motor_id);

        // Unlock EEPROM, send reset, lock EEPROM
        self.unlock_eeprom(motor_id).await?;

        let command_id = self.next_command_id();
        let envelope = TxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            target_bus_serial: self.target_bus_serial.clone(),
            command_id: command_id.clone(),
            reset: Some(crate::st3215_proto::St3215ResetCommand {
                port_name: self.target_bus_serial.clone(),
                motor_id: motor_id as u32,
            }),
            ..Default::default()
        };
        self.comm.send_tx(&envelope);
        self.wait_for_command_result(&command_id).await?;

        self.lock_eeprom(motor_id).await?;

        // Wait for motor to complete reset
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Write offset=0 to EEPROM (handles its own unlock/lock)
        self.send_eeprom_write_verified(motor_id, EepromRegister::Offset.address(), 0i16.to_le_bytes().to_vec()).await?;

        // Wait for offset to become 0 in motor state
        let timeout = Duration::from_secs(3);
        let deadline = tokio::time::Instant::now() + timeout;
        let mut last_offset = None;

        loop {
            tokio::select! {
                Ok(()) = self.inference_rx.changed() => {
                    let state = self.inference_rx.borrow().clone();
                    if let Some(bus) = state.buses.iter().find(|b| {
                        b.bus.as_ref().map(|b| b.serial_number.as_str()) == Some(&self.target_bus_serial)
                    }) {
                        if let Some(motor) = bus.motors.iter().find(|m| m.id == motor_id as u32) {
                            let offset_addr = EepromRegister::Offset.address() as usize;
                            if motor.state.len() > offset_addr + 1 {
                                let offset = i16::from_le_bytes([motor.state[offset_addr], motor.state[offset_addr + 1]]);
                                last_offset = Some(offset);
                                if offset == 0 {
                                    info!("Motor {} - Reset complete, offset is 0", motor_id);
                                    return Ok(());
                                }
                            }
                        }
                    }
                }
                _ = tokio::time::sleep_until(deadline) => {
                    let offset_msg = last_offset.map(|o| format!("actual offset: {}", o))
                        .unwrap_or_else(|| "offset not read".to_string());
                    return Err(format!("Reset verification timeout - offset did not become 0 ({})", offset_msg).into());
                }
            }
        }
    }

    pub async fn set_torque(&mut self, motor_id: u8, enable: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.send_write_verified(motor_id, RamRegister::TorqueEnable.address(), vec![enable]).await
    }

    async fn set_position(&mut self, motor_id: u8, position: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Set speed and acceleration before position command
        self.send_write_verified(motor_id, RamRegister::GoalSpeed.address(), CALIBRATION_SPEED.to_le_bytes().to_vec()).await?;
        self.send_write_verified(motor_id, RamRegister::Acc.address(), vec![CALIBRATION_ACCEL]).await?;
        // Command position
        self.send_write_verified(motor_id, RamRegister::GoalPosition.address(), position.to_le_bytes().to_vec()).await
    }

    pub async fn prepare_motor(&mut self, motor_id: u8, max_motors_cnt: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Motor {} - Preparing", motor_id);

        self.send_reset(motor_id).await?;
        tokio::time::sleep(Duration::from_millis(100)).await;

        let pid = pid_config_for_motor_count(max_motors_cnt);
        info!("Motor {} - Setting EEPROM parameters (PID: p={}, i={}, d={})", motor_id, pid.p, pid.i, pid.d);
        self.send_eeprom_write_verified(motor_id, EepromRegister::Mode.address(), vec![0]).await?;
        self.send_eeprom_write_verified(motor_id, EepromRegister::PCoef.address(), vec![pid.p]).await?;
        self.send_eeprom_write_verified(motor_id, EepromRegister::ICoef.address(), vec![pid.i]).await?;
        self.send_eeprom_write_verified(motor_id, EepromRegister::DCoef.address(), vec![pid.d]).await?;
        self.send_eeprom_write_verified(motor_id, EepromRegister::ReturnDelay.address(), vec![0]).await?;

        info!("Motor {} - Setting RAM parameters", motor_id);
        self.send_write_verified(motor_id, RamRegister::TorqueEnable.address(), vec![0]).await?;
        self.send_eeprom_write_verified(motor_id, EepromRegister::MaxTorque.address(), CALIBRATION_TORQUE_LIMIT.to_le_bytes().to_vec()).await?;
        self.send_write_verified(motor_id, RamRegister::GoalSpeed.address(), CALIBRATION_SPEED.to_le_bytes().to_vec()).await?;
        self.send_write_verified(motor_id, RamRegister::Acc.address(), vec![CALIBRATION_ACCEL]).await?;
        self.send_write_verified(motor_id, RamRegister::TorqueLimit.address(), CALIBRATION_TORQUE_LIMIT.to_le_bytes().to_vec()).await?;

        Ok(())
    }

    pub async fn cleanup_motor(&mut self, motor_id: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.send_eeprom_write(motor_id, EepromRegister::MaxTorque.address(), DEFAULT_MAX_TORQUE.to_le_bytes().to_vec()).await?;
        self.send_eeprom_write(motor_id, EepromRegister::ProtectionCurrent.address(), DEFAULT_PROTECTION_CURRENT.to_le_bytes().to_vec()).await?;
        self.send_eeprom_write(motor_id, EepromRegister::OverloadTorque.address(), vec![DEFAULT_OVERLOAD_TORQUE]).await?;
        self.send_eeprom_write(motor_id, EepromRegister::Offset.address(), vec![0,0]).await?;

        self.send_write(motor_id, RamRegister::GoalSpeed.address(), vec![0,0]).await?;
        self.send_write(motor_id, RamRegister::Acc.address(), vec![DEFAULT_ACCEL]).await?;
        self.send_write(motor_id, RamRegister::TorqueLimit.address(), DEFAULT_TORQUE_LIMIT.to_le_bytes().to_vec()).await?;

        Ok(())
    }

    pub async fn read_encoder_position(&mut self, motor_id: u8) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
        if self.inference_rx.changed().await.is_ok() {
            let state = self.inference_rx.borrow().clone();
            if let Some(bus) = state.buses.iter().find(|b| {
                b.bus.as_ref().map(|bus| bus.serial_number.as_str()) == Some(&self.target_bus_serial)
            }) {
                if let Some(motor) = bus.motors.iter().find(|m| m.id == motor_id as u32) {
                    if motor.state.len() <= RamRegister::PresentPosition.address() as usize + 1 {
                        log::warn!("Motor {} - State size too small to read position. Got {} bytes", motor_id, motor.state.len());
                        return Err("Failed to read position".into());
                    }
                    let displayed = crate::protocol::get_motor_position(&motor.state);
                    let offset_addr = EepromRegister::Offset.address() as usize;
                    let offset = if motor.state.len() > offset_addr + 1 {
                        i16::from_le_bytes([motor.state[offset_addr], motor.state[offset_addr + 1]])
                    } else {
                        0
                    };
                    Ok(((displayed as i32 + offset as i32 + 4096) % 4096) as u16)
                } else {
                    Err("Motor not found".into())
                }
            } else {
                Err("Bus not found".into())
            }
        } else {
            Err("Failed to read motor state".into())
        }
    }

    pub async fn wait_for_stall(&mut self, motor_id: u8) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
        info!("Motor {} - Waiting for stall", motor_id);

        let start_stamp = systime::get_monotonic_stamp_ns();
        let mut last_stamp = start_stamp;
        let mut startup_steps = 0u32;
        let mut stable_count = 0u32;
        let mut first_stale_stamp: Option<u64> = None;
        let mut start_position: Option<u16> = None;
        let mut total_fresh_reads: u32 = 0;

        loop {
            self.check_stop().await?;

            if self.inference_rx.changed().await.is_ok() {
                let state = self.inference_rx.borrow().clone();

                if let Some(bus) = state.buses.iter().find(|b| {
                    b.bus.as_ref().map(|bus| bus.serial_number.as_str()) == Some(&self.target_bus_serial)
                }) {
                    if let Some(motor) = bus.motors.iter().find(|m| m.id == motor_id as u32) {
                        if motor.error.is_some() {
                            log::warn!("Motor {} in error state, recovering", motor_id);
                            let _ = self.send_write_verified(motor_id, RamRegister::TorqueEnable.address(), vec![0]).await;
                            let _ = self.send_write_verified(motor_id, RamRegister::TorqueEnable.address(), vec![1]).await;
                            continue;
                        }

                        // Pre-check motor state size for all required data
                        let offset_addr = EepromRegister::Offset.address() as usize;
                        if motor.state.len() <= offset_addr + 1 {
                            continue;
                        }

                        let current_stamp = motor.monotonic_stamp_ns;
                        let is_fresh = current_stamp > last_stamp;

                        if is_fresh {
                            last_stamp = current_stamp;
                            startup_steps += 1;
                        }

                        // Extract motor data without individual size checks
                        let velocity = crate::protocol::get_motor_velocity(&motor.state);
                        let displayed_position = crate::protocol::get_motor_position(&motor.state);
                        let offset = i16::from_le_bytes([motor.state[offset_addr], motor.state[offset_addr + 1]]);
                        let encoder_position = ((displayed_position as i32 + offset as i32 + 4096) % 4096) as u16;
                        self.motor_positions.entry(motor_id).or_insert_with(BTreeSet::new).insert(encoder_position);

                        if start_position.is_none() {
                            start_position = Some(displayed_position);
                        }

                        if is_fresh {
                            total_fresh_reads += 1;
                        }

                        let displacement = (displayed_position as i32 - start_position.unwrap() as i32).unsigned_abs();
                        let displaced = displacement >= MIN_DISPLACEMENT;

                        if startup_steps >= MOTOR_STARTUP_STEPS {
                            if displaced {
                                if !is_fresh && velocity < VELOCITY_THRESHOLD {
                                    if first_stale_stamp.is_none() {
                                        first_stale_stamp = Some(current_stamp);
                                    }

                                    let stale_duration_ms = (current_stamp - first_stale_stamp.unwrap()) / 1_000_000;
                                    if stale_duration_ms >= 100 {
                                        stable_count += 1;
                                    }
                                } else if is_fresh {
                                    first_stale_stamp = None;
                                    if velocity < VELOCITY_THRESHOLD {
                                        stable_count += 1;
                                    } else {
                                        stable_count = 0;
                                    }
                                }

                                if stable_count > SKIP_INITIAL_SAMPLES {
                                    info!("Motor {} - Stalled at position {}", motor_id, displayed_position);
                                    return Ok(displayed_position);
                                }
                            } else if total_fresh_reads >= MAX_READS_WITHOUT_DISPLACEMENT {
                                log::warn!(
                                    "Motor {} - Unable to move from position {} after {} fresh reads",
                                    motor_id, displayed_position, total_fresh_reads
                                );
                                return Ok(displayed_position);
                            }
                        }
                    }
                }
            }
        }
    }

    pub async fn find_min(&mut self, motor_id: u8, torque_after: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Motor {} - Finding minimum position", motor_id);
        self.check_stop().await?;

        let current_encoder = self.read_encoder_position(motor_id).await?;

        let mut new_offset = (current_encoder as i32 - (4095 - SAFE_OFFSET as i32)) as i16;

        if new_offset < -2047 {
            new_offset = new_offset + 4096;
        } else if new_offset > 2047 {
            new_offset = new_offset - 4096;
        }
        new_offset = new_offset.clamp(-2047, 2047);

        self.send_eeprom_write_verified(motor_id, EepromRegister::Offset.address(),
            new_offset.to_le_bytes().to_vec()).await?;

        let mut current_target = 4095 - SAFE_OFFSET;
        let mut final_pos;

        while current_target > 0 {
            let next_target = if current_target >= CALIBRATION_STEP {
                current_target - CALIBRATION_STEP
            } else {
                0
            };

            self.set_position(motor_id, next_target).await?;
            final_pos = self.wait_for_stall(motor_id).await?;

            if final_pos > next_target + 50 {
                info!("Motor {} - Found min at {}", motor_id, final_pos);
                break;
            }

            current_target = next_target;
        }

        self.set_torque(motor_id, torque_after).await?;

        Ok(())
    }

    pub async fn find_max(&mut self, motor_id: u8, torque_after: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Motor {} - Finding maximum position", motor_id);
        self.check_stop().await?;

        let current_encoder = self.read_encoder_position(motor_id).await?;

        let mut new_offset = (current_encoder as i32 - SAFE_OFFSET as i32) as i16;

        if new_offset > 2047 {
            new_offset = new_offset - 4096;
        } else if new_offset < -2047 {
            new_offset = new_offset + 4096;
        }
        new_offset = new_offset.clamp(-2047, 2047);

        self.send_eeprom_write_verified(motor_id, EepromRegister::Offset.address(),
            new_offset.to_le_bytes().to_vec()).await?;

        let mut current_target = SAFE_OFFSET;
        let mut final_pos;

        while current_target < 4095 {
            let next_target = if current_target + CALIBRATION_STEP <= 4095 {
                current_target + CALIBRATION_STEP
            } else {
                4095
            };

            self.set_position(motor_id, next_target).await?;
            final_pos = self.wait_for_stall(motor_id).await?;

            if final_pos < next_target - 50 {
                info!("Motor {} - Found max at {}", motor_id, final_pos);
                break;
            }

            current_target = next_target;
        }

        self.set_torque(motor_id, torque_after).await?;
        Ok(())
    }

    pub async fn shift(&mut self, motor_id: u8, steps: i16, torque_after: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Motor {} - Shifting by {} steps", motor_id, steps);
        self.check_stop().await?;

        let current_encoder = self.read_encoder_position(motor_id).await?;

        let start_position = if steps >= 0 { SAFE_OFFSET as i32 } else { 4095 - SAFE_OFFSET as i32 };
        let mut new_offset = (current_encoder as i32 - start_position) as i16;

        if new_offset > 2047 {
            new_offset = new_offset - 4096;
        } else if new_offset < -2047 {
            new_offset = new_offset + 4096;
        }
        new_offset = new_offset.clamp(-2047, 2047);

        self.send_eeprom_write_verified(motor_id, EepromRegister::Offset.address(),
            new_offset.to_le_bytes().to_vec()).await?;

        let target_displayed = (start_position as i32 + steps as i32).clamp(0, 4095) as u16;
        let step_size = CALIBRATION_STEP as i32;
        let mut current_pos = start_position as u16;
        let direction = if steps > 0 { 1 } else { -1 };

        while (direction > 0 && current_pos < target_displayed) || (direction < 0 && current_pos > target_displayed) {
            let next_step = if direction > 0 {
                ((current_pos as i32 + step_size).min(target_displayed as i32)) as u16
            } else {
                ((current_pos as i32 - step_size).max(target_displayed as i32)) as u16
            };

            self.set_position(motor_id, next_step).await?;
            self.wait_for_stall(motor_id).await?;
            current_pos = next_step;
        }

        self.set_torque(motor_id, torque_after).await?;

        Ok(())
    }

    pub async fn go_to_float_position(&mut self, motor_id: u8, float_pos: f32, torque_after: u8) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Motor {} - Moving to float position {}", motor_id, float_pos);
        self.check_stop().await?;

        // Clamp float position to [0.0, 1.0]
        let float_pos = float_pos.clamp(0.0, 1.0);

        // Get recorded positions and calculate arc
        let positions = self.motor_positions.get(&motor_id)
            .ok_or("No recorded positions for motor")?;

        if positions.is_empty() {
            return Err("No positions recorded during calibration".into());
        }

        // Print all recorded positions before arc calculation
        info!("Motor {} - Recorded {} positions: {:?}", motor_id, positions.len(), positions);

        let arc = calibrate::calculate_arc(positions);

        // Calculate midpoint and range
        let (midpoint, range) = if arc.max >= arc.min {
            // Normal range
            let range = arc.max - arc.min;
            let midpoint = arc.min + range / 2;
            (midpoint, range)
        } else {
            // Wraparound range
            let range = (4096 - arc.min) + arc.max;
            let midpoint = ((arc.min + range / 2) & 0xFFF) as u16;
            (midpoint, range)
        };

        // Calculate offset to center the arc at 2048
        // ST3215 offset formula: displayed = raw - offset
        // So to center midpoint at 2048: offset = midpoint - 2048
        let offset = (midpoint as i32 - 2048) as i16;
        let offset_clamped = offset.clamp(-2047, 2047);

        info!("Motor {} - Arc: min={}, max={}, midpoint={}, range={}, offset={}",
            motor_id, arc.min, arc.max, midpoint, range, offset_clamped);

        // Write offset to EEPROM to center the arc at 2048
        self.send_eeprom_write_verified(motor_id, EepromRegister::Offset.address(),
            offset_clamped.to_le_bytes().to_vec()).await?;

        // Calculate goal position in the new offset coordinate system
        // float_pos = 0.5 -> 2048 (center)
        // float_pos = 0.0 -> 2048 - range/2 (min)
        // float_pos = 1.0 -> 2048 + range/2 (max)
        let goal_offset = ((float_pos - 0.5) * range as f32) as i32;
        let goal_pos = ((2048 + goal_offset) & 0xFFF) as u16;

        info!("Motor {} - Float position {} -> goal position {}", motor_id, float_pos, goal_pos);

        self.set_position(motor_id, goal_pos).await?;

        info!("Motor {} - Commanded to position {}", motor_id, goal_pos);

        let final_pos = self.wait_for_stall(motor_id).await?;

        info!("Motor {} - Reached position {}", motor_id, final_pos);

        self.set_torque(motor_id, torque_after).await?;
        Ok(())
    }
}

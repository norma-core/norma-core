use crate::command_inbox::{CommandReceiver, command_inbox};
use crate::yahboom_dogzilla_lite_proto::{YahboomDogzillaLiteDevice, YahboomDogzillaLiteSignalType, ImuOrientation, TxEnvelope};
use crate::shared::{
    CommandEffect, DEFAULT_SERVO_POSITIONS, build_status, compute_command_effect,
    send_command_result, send_status_update, should_report_command_success, target_matches,
    unsupported_command_message,
};
use crate::state::YahboomDogzillaLiteCommunicator;
use log::warn;
use prost::Message;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::interval;

const SIM_POLL_INTERVAL: Duration = Duration::from_millis(20);
const SIM_MAX_UNITS_PER_SEC: f32 = 255.0;
const GRIPPER_INDEX: usize = 12;
const ARM_INDEX_RANGE: std::ops::RangeInclusive<usize> = 13..=14;
const LEG_INDEX_RANGE: std::ops::RangeInclusive<usize> = 0..=11;
const NEUTRAL: u32 = 128;
const GAIT_STOP_THRESHOLD: f32 = 0.05;
const GAIT_BASE_HZ: f32 = 0.8;
const GAIT_MAX_EXTRA_HZ: f32 = 2.2;
const GAIT_STRIDE_MIN: f32 = 6.0;
const GAIT_STRIDE_MAX: f32 = 28.0;
const GAIT_LIFT_RATIO: f32 = 0.6;
const GAIT_YAW_RATE_DEG: f32 = 70.0;
const LEG_SERVO_GROUPS: [(usize, usize, usize); 4] = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (9, 10, 11)];
const LEG_PHASE_OFFSETS: [f32; 4] = [0.0, std::f32::consts::PI, 0.0, std::f32::consts::PI];

pub(crate) struct YahboomDogzillaLiteSimulator {
    device_info: YahboomDogzillaLiteDevice,
    com: Arc<YahboomDogzillaLiteCommunicator>,
    leg_servo_speed: u32,
    arm_servo_speed: u32,
    servo_positions: Vec<f32>,
    servo_targets: Vec<u32>,
    orientation: ImuOrientation,
    movement_x: u32,
    movement_y: u32,
    movement_yaw: u32,
    gait_phase: f32,
    movement_active: bool,
    last_battery_read: Instant,
    cached_battery_level: u32,
    last_tick: Instant,
}

impl YahboomDogzillaLiteSimulator {
    pub(crate) fn new(device_info: YahboomDogzillaLiteDevice, com: Arc<YahboomDogzillaLiteCommunicator>) -> Self {
        Self {
            device_info,
            com,
            leg_servo_speed: 127,
            arm_servo_speed: 127,
            servo_positions: DEFAULT_SERVO_POSITIONS.iter().map(|&v| v as f32).collect(),
            servo_targets: DEFAULT_SERVO_POSITIONS.to_vec(),
            orientation: ImuOrientation {
                roll: 0.0,
                pitch: 0.0,
                yaw: 0.0,
            },
            movement_x: NEUTRAL,
            movement_y: NEUTRAL,
            movement_yaw: NEUTRAL,
            gait_phase: 0.0,
            movement_active: false,
            last_battery_read: Instant::now() - Duration::from_secs(60),
            cached_battery_level: 100,
            last_tick: Instant::now(),
        }
    }

    pub(crate) async fn run(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let (tx_sender, tx_receiver) = command_inbox();

        let device_serial = self.device_info.serial_number.clone();
        let result_com = self.com.clone();
        let result_device = self.device_info.clone();
        let normfs = self.com.normfs.clone();
        let tx_queue_id = self.com.tx_queue_id.clone();
        let subscription_id = normfs.subscribe(
            &tx_queue_id,
            Box::new(move |entries: &[(normfs::UintN, bytes::Bytes)]| {
                for (_id, data) in entries {
                    match TxEnvelope::decode(data.as_ref()) {
                        Ok(envelope) => {
                            if !target_matches(&envelope.target_device_serial, &device_serial) {
                                continue;
                            }

                            if envelope.command.is_none() {
                                continue;
                            }

                            let failed_envelope = envelope.clone();
                            if let Err(e) = tx_sender.push(envelope) {
                                warn!("Failed to queue TX command: {}", e);
                                send_command_result(
                                    &result_com,
                                    &result_device,
                                    &failed_envelope,
                                    YahboomDogzillaLiteSignalType::YahboomDogzillaLiteCommandFailed,
                                    Some(e.to_string()),
                                );
                            }
                        }
                        Err(e) => {
                            warn!("Failed to decode TX envelope: {}", e);
                        }
                    }
                }
                true
            }),
        )?;

        let result = self.main_loop(tx_receiver).await;
        normfs.unsubscribe(&tx_queue_id, subscription_id);
        result
    }

    async fn main_loop(
        &mut self,
        mut tx_receiver: CommandReceiver,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut poll_interval = interval(SIM_POLL_INTERVAL);

        loop {
            tokio::select! {
                command = tx_receiver.recv() => {
                    match command {
                        Some(envelope) => self.process_envelope(&envelope),
                        None => return Ok(()),
                    }
                }
                _ = poll_interval.tick() => {
                    self.tick();
                }
            }
        }
    }

    fn process_envelope(&mut self, envelope: &TxEnvelope) {
        let Some(command) = envelope.command.as_ref() else {
            return;
        };

        if let Some(message) = unsupported_command_message(command) {
            self.send_command_result(
                envelope,
                YahboomDogzillaLiteSignalType::YahboomDogzillaLiteCommandFailed,
                Some(message),
            );
            return;
        }

        let effect = compute_command_effect(command);
        if command.servo.is_some() && effect.servo_writes.is_empty() {
            let servo_id = command
                .servo
                .as_ref()
                .map(|servo| servo.servo_id)
                .unwrap_or(0);
            self.send_command_result(
                envelope,
                YahboomDogzillaLiteSignalType::YahboomDogzillaLiteCommandFailed,
                Some(format!(
                    "Unsupported command: unknown servo ID {}",
                    servo_id
                )),
            );
            return;
        }

        self.apply_command_effect(effect);
        if let Some(movement) = &command.movement {
            self.apply_movement_command(movement.move_x, movement.move_y, movement.move_yaw);
        }

        if should_report_command_success(command) {
            self.send_command_result(envelope, YahboomDogzillaLiteSignalType::YahboomDogzillaLiteCommandSuccess, None);
        }
    }

    fn apply_command_effect(&mut self, effect: CommandEffect) {
        for write in effect.servo_writes {
            if let Some(slot) = self.servo_targets.get_mut(write.index) {
                *slot = write.position as u32;
            }
        }

        if let Some(speed) = effect.leg_servo_speed {
            self.leg_servo_speed = speed;
        }
        if let Some(speed) = effect.arm_servo_speed {
            self.arm_servo_speed = speed;
        }
    }

    fn apply_movement_command(&mut self, move_x: u32, move_y: u32, move_yaw: u32) {
        self.movement_x = move_x.clamp(0, 255);
        self.movement_y = move_y.clamp(0, 255);
        self.movement_yaw = move_yaw.clamp(0, 255);
    }

    fn tick(&mut self) {
        let now = Instant::now();
        let dt = now.duration_since(self.last_tick).as_secs_f32();
        self.last_tick = now;
        if dt > 0.0 {
            self.update_movement_targets(dt);
            self.update_servo_positions(dt);
        }

        let battery_level = self.current_battery_level();
        let status = build_status(
            &self.device_info,
            self.servo_positions
                .iter()
                .map(|&v| v.round().clamp(0.0, 255.0) as u32)
                .collect(),
            self.leg_servo_speed,
            self.arm_servo_speed,
            battery_level,
            self.orientation.clone(),
        );

        send_status_update(&self.com, &self.device_info, status);
    }

    fn send_command_result(
        &self,
        envelope: &TxEnvelope,
        signal_type: YahboomDogzillaLiteSignalType,
        error_message: Option<String>,
    ) {
        send_command_result(
            &self.com,
            &self.device_info,
            envelope,
            signal_type,
            error_message,
        );
    }

    fn current_battery_level(&mut self) -> u32 {
        if self.last_battery_read.elapsed() >= Duration::from_secs(60) {
            self.cached_battery_level = 100;
            self.last_battery_read = Instant::now();
        }

        self.cached_battery_level
    }

    fn update_servo_positions(&mut self, dt: f32) {
        let max_delta_base = SIM_MAX_UNITS_PER_SEC * dt;
        for (index, current) in self.servo_positions.iter_mut().enumerate() {
            let target = match self.servo_targets.get(index) {
                Some(value) => *value as f32,
                None => continue,
            };

            let speed = if index == GRIPPER_INDEX {
                0.0
            } else if ARM_INDEX_RANGE.contains(&index) {
                self.arm_servo_speed as f32
            } else if LEG_INDEX_RANGE.contains(&index) {
                self.leg_servo_speed as f32
            } else {
                0.0
            };

            let speed_ratio = if index == GRIPPER_INDEX || speed <= 0.0 {
                1.0
            } else {
                (speed.clamp(1.0, 255.0) / 255.0).clamp(0.0, 1.0)
            };
            let max_delta = max_delta_base * speed_ratio;
            if max_delta <= 0.0 {
                continue;
            }

            let delta = target - *current;
            if delta.abs() <= max_delta {
                *current = target;
            } else {
                *current += max_delta * delta.signum();
            }
            *current = current.clamp(0.0, 255.0);
        }
    }

    fn update_movement_targets(&mut self, dt: f32) {
        let (move_x, move_y, move_yaw) = self.normalized_movement();
        let speed = (move_x * move_x + move_y * move_y).sqrt().clamp(0.0, 1.0);
        let yaw_speed = move_yaw.abs().clamp(0.0, 1.0);
        let has_motion = speed >= GAIT_STOP_THRESHOLD || yaw_speed >= GAIT_STOP_THRESHOLD;

        if !has_motion {
            if self.movement_active {
                self.reset_leg_targets_to_default();
                self.movement_active = false;
            }
            return;
        }

        self.movement_active = true;
        let gait_drive = speed.max(yaw_speed);
        let stride = lerp(GAIT_STRIDE_MIN, GAIT_STRIDE_MAX, gait_drive);
        let step_rate = GAIT_BASE_HZ + GAIT_MAX_EXTRA_HZ * gait_drive;
        self.gait_phase = wrap_phase(self.gait_phase + dt * step_rate * std::f32::consts::TAU);
        let lateral = move_y.clamp(-1.0, 1.0);

        for (leg_index, (hip_idx, knee_idx, ankle_idx)) in LEG_SERVO_GROUPS.iter().enumerate() {
            let phase = self.gait_phase + LEG_PHASE_OFFSETS[leg_index];
            let swing = phase.sin();
            let lift = (1.0 - phase.cos()).max(0.0);
            let lateral_offset = stride * 0.35 * lateral;
            let side_sign = if leg_index == 0 || leg_index == 3 {
                1.0
            } else {
                -1.0
            };
            let yaw_turn = yaw_speed * move_yaw.signum() * side_sign * stride * 0.6;

            let hip_base = DEFAULT_SERVO_POSITIONS[*hip_idx] as f32;
            let knee_base = DEFAULT_SERVO_POSITIONS[*knee_idx] as f32;
            let ankle_base = DEFAULT_SERVO_POSITIONS[*ankle_idx] as f32;

            let hip_target = hip_base + swing * stride + lateral_offset + yaw_turn;
            let knee_target = knee_base + lift * stride * GAIT_LIFT_RATIO;
            let ankle_target = ankle_base - lift * stride * (GAIT_LIFT_RATIO * 1.2);

            self.servo_targets[*hip_idx] = clamp_servo(hip_target);
            self.servo_targets[*knee_idx] = clamp_servo(knee_target);
            self.servo_targets[*ankle_idx] = clamp_servo(ankle_target);
        }

        self.apply_yaw_rotation(move_yaw, dt);
    }

    fn reset_leg_targets_to_default(&mut self) {
        for index in LEG_INDEX_RANGE {
            self.servo_targets[index] = DEFAULT_SERVO_POSITIONS[index];
        }
    }

    fn apply_yaw_rotation(&mut self, yaw_input: f32, dt: f32) {
        if yaw_input.abs() < 0.02 {
            return;
        }
        self.orientation.yaw =
            wrap_degrees(self.orientation.yaw + yaw_input * GAIT_YAW_RATE_DEG * dt);
    }

    fn normalized_movement(&self) -> (f32, f32, f32) {
        (
            normalize_axis(self.movement_x),
            normalize_axis(self.movement_y),
            normalize_axis(self.movement_yaw),
        )
    }
}

fn normalize_axis(value: u32) -> f32 {
    (value as f32 - NEUTRAL as f32) / 127.0
}

fn wrap_phase(phase: f32) -> f32 {
    if phase > std::f32::consts::TAU {
        phase - std::f32::consts::TAU
    } else if phase < 0.0 {
        phase + std::f32::consts::TAU
    } else {
        phase
    }
}

fn wrap_degrees(value: f32) -> f32 {
    let mut v = value % 360.0;
    if v > 180.0 {
        v -= 360.0;
    } else if v < -180.0 {
        v += 360.0;
    }
    v
}

fn clamp_servo(value: f32) -> u32 {
    value.round().clamp(0.0, 255.0) as u32
}

fn lerp(min: f32, max: f32, t: f32) -> f32 {
    min + (max - min) * t.clamp(0.0, 1.0)
}

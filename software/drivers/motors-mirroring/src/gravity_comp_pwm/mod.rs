//! Orchestration for the leader-arm PWM (open-loop) gravity compensation
//! control loop - a direct feedforward-torque alternative to
//! `gravity_comp`'s position-offset approximation. Instead of nudging
//! `GoalPosition`, this switches the motor's `Mode` register to open-loop PWM
//! (see `st3215::protocol::EepromRegister::Mode`, value 2) and writes the
//! computed duty cycle straight to the `GoalTime` register every cycle. See
//! `CLAUDE.md` in this directory for the full mechanics, and why this control
//! law needs safety cutoffs the offset-based module didn't.

mod control_pwm;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bytes::Bytes;
use normfs::NormFS;
use parking_lot::RwLock;

use crate::config::{
    clamp_pwm_gravity_comp_duty_gain, clamp_pwm_gravity_comp_max_duty, MotorConfig,
    GRAVITY_COMP_REFRESH_INTERVAL, GRAVITY_COMP_TORQUE_LIMIT_CEILING,
};
use crate::gravity_comp::elrobot_dynamics::{gravity_torques, JOINT_COUNT, JOINT_LIMITS_RAD};
use crate::gravity_comp::control::raw_to_joint_angle;
use crate::gravity_comp::ARM_MOTOR_IDS;
use crate::inference::model::StationState;
use crate::inference::normalize;
use crate::inference::{Inference, MAX_DATA_AGE_NS};
use crate::types::{BusKey, Command, MotorCommand};

/// Per-joint duty-per-Nm gains, indexed the same as `ARM_MOTOR_IDS` (index 0
/// = motor 1, ... index 6 = motor 7).
pub type JointDutyGains = [f64; JOINT_COUNT];

/// A bus's current PWM-gravity-comp tuning: live while running, "staged"
/// (remembered but not yet persisted) while stopped, and what gets written to
/// the `motors_mirroring/pwm_gravity_comp_settings` queue on
/// PGCT_SAVE_SETTINGS. Structurally identical to `gravity_comp::GravitySettings`
/// but a distinct type - the two tunings are not interchangeable (a
/// duty-per-Nm gain and a rad-per-Nm gain aren't the same unit).
#[derive(Clone, Copy, Debug)]
pub struct PwmGravitySettings {
    pub joint_duty_gains: JointDutyGains,
    pub max_duty: u16,
}

fn motor_id_to_index(motor_id: u8) -> Option<usize> {
    ARM_MOTOR_IDS.iter().position(|&id| id == motor_id)
}

struct GravityCompPwmTask {
    stop_flag: Arc<AtomicBool>,
    /// Live-adjustable per-joint duty gains, read by the control loop every
    /// cycle so they can be tuned from the UI without restarting.
    duty_gains: Arc<RwLock<JointDutyGains>>,
    /// Live-adjustable max duty (applies uniformly to all 7 arm motors).
    /// Unlike `gravity_comp`'s `torque_limit`, this is *not* itself a
    /// hardware register - it's a software clamp the control loop applies to
    /// the duty it computes, so updating it never needs to re-send anything;
    /// the next cycle just reads the new value.
    max_duty: Arc<RwLock<u16>>,
    handle: tokio::task::JoinHandle<()>,
}

/// Tracks the running PWM-gravity-comp control-loop task per bus. Owned by
/// `Inference`, alongside (and mutually exclusive with, on the same bus) the
/// offset-based `gravity_comp::GravityComp`.
#[derive(Default)]
pub struct GravityCompPwm {
    tasks: RwLock<HashMap<BusKey, GravityCompPwmTask>>,
}

impl GravityCompPwm {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts the control loop for `bus`. No-op if already running. Callers
    /// (`lib.rs::handle_start_pwm_gravity_comp`) are responsible for first
    /// stopping the offset-based `gravity_comp` task on this bus, if running
    /// - the two write conflicting servo state (`Mode` position vs. open-loop)
    /// and must never run concurrently on the same bus.
    ///
    /// `on_self_stop` is invoked (off the control loop's own task) if the loop
    /// terminates itself for safety reasons - the caller uses this to keep
    /// displayed mode state truthful. `initial_duty_gains`/`initial_max_duty`,
    /// if provided (e.g. from previously-saved settings), override
    /// `config.pwm_gravity_comp`'s defaults as the starting point - either way
    /// they're still hard-clamped and still adjustable afterwards via
    /// `set_duty_gain`/`set_max_duty`.
    pub fn start<F>(
        &self,
        bus: BusKey,
        config: MotorConfig,
        initial_duty_gains: Option<JointDutyGains>,
        initial_max_duty: Option<u16>,
        normfs: Arc<NormFS>,
        on_self_stop: F,
    ) where
        F: Fn(BusKey) + Send + Sync + 'static,
    {
        if self.tasks.read().contains_key(&bus) {
            return;
        }

        let duty_gains_value: JointDutyGains = initial_duty_gains
            .unwrap_or([config.pwm_gravity_comp.duty_per_nm; JOINT_COUNT])
            .map(clamp_pwm_gravity_comp_duty_gain);
        let max_duty_value =
            clamp_pwm_gravity_comp_max_duty(initial_max_duty.unwrap_or(config.pwm_gravity_comp.max_duty));

        // One-shot setup, ahead of the hot loop. Deferred onto its own spawned
        // task for the same reentrancy reason as `gravity_comp::GravityComp::start`
        // (see this crate's `gravity_comp/CLAUDE.md`): this fn is invoked
        // synchronously from within the "commands" normfs queue's own
        // subscription callback, and `send_setup_commands` ultimately calls
        // `normfs.enqueue()` on that same queue.
        {
            let setup_normfs = Arc::clone(&normfs);
            let setup_bus_id = bus.bus_id.clone();
            tokio::spawn(async move {
                Self::send_setup_commands(&setup_normfs, &setup_bus_id);
            });
        }

        let duty_gains = Arc::new(RwLock::new(duty_gains_value));
        let max_duty = Arc::new(RwLock::new(max_duty_value));

        let stop_flag = Arc::new(AtomicBool::new(false));
        let loop_stop_flag = Arc::clone(&stop_flag);
        let loop_duty_gains = Arc::clone(&duty_gains);
        let loop_max_duty = Arc::clone(&max_duty);
        let loop_bus = bus.clone();
        let loop_normfs = Arc::clone(&normfs);

        let handle = tokio::spawn(async move {
            Self::run_control_loop(loop_bus, loop_stop_flag, loop_duty_gains, loop_max_duty, loop_normfs, config, on_self_stop).await;
        });

        self.tasks.write().insert(bus, GravityCompPwmTask { stop_flag, duty_gains, max_duty, handle });
    }

    /// Stops the control loop for `bus` (if running): zeroes PWM output,
    /// disables torque, and restores position mode.
    pub fn stop(&self, bus: &BusKey, normfs: &Arc<NormFS>) {
        if let Some(task) = self.tasks.write().remove(bus) {
            task.stop_flag.store(true, Ordering::SeqCst);
            task.handle.abort();
        }
        let teardown_normfs = Arc::clone(normfs);
        let teardown_bus_id = bus.bus_id.clone();
        tokio::spawn(async move {
            Self::send_teardown_commands(&teardown_normfs, &teardown_bus_id);
        });
    }

    /// Stops every currently-running PWM-gravity-comp task. Called during
    /// graceful process shutdown, alongside `gravity_comp::GravityComp::stop_all`.
    pub fn stop_all(&self, normfs: &Arc<NormFS>) {
        let buses: Vec<BusKey> = self.tasks.read().keys().cloned().collect();
        for bus in buses {
            self.stop(&bus, normfs);
        }
    }

    /// Returns `true` if PWM gravity comp is currently running on `bus`. Used
    /// by `gravity_comp::GravityComp::start` (and vice versa here) to enforce
    /// mutual exclusion between the two control laws on the same bus.
    pub fn is_running(&self, bus: &BusKey) -> bool {
        self.tasks.read().contains_key(bus)
    }

    /// Live-updates the duty gain of one arm joint for a running task,
    /// without restarting it. Returns `false` if `bus` has no running task or
    /// `motor_id` isn't one of the 7 compensated arm joints.
    pub fn set_duty_gain(&self, bus: &BusKey, motor_id: u8, duty_per_nm: f64) -> bool {
        let index = match motor_id_to_index(motor_id) {
            Some(index) => index,
            None => return false,
        };
        let tasks = self.tasks.read();
        match tasks.get(bus) {
            Some(task) => {
                task.duty_gains.write()[index] = clamp_pwm_gravity_comp_duty_gain(duty_per_nm);
                true
            }
            None => false,
        }
    }

    /// Live-updates the max duty (applies to all 7 arm motors) for a running
    /// task, without restarting it. Unlike `gravity_comp::set_torque_limit`,
    /// this never touches hardware directly - `max_duty` is a software clamp
    /// the control loop reads each cycle, not a servo register - so there's
    /// nothing to re-send. Returns `false` if `bus` has no running task.
    pub fn set_max_duty(&self, bus: &BusKey, max_duty: u16) -> bool {
        let clamped = clamp_pwm_gravity_comp_max_duty(max_duty);
        let tasks = self.tasks.read();
        match tasks.get(bus) {
            Some(task) => {
                *task.max_duty.write() = clamped;
                true
            }
            None => false,
        }
    }

    /// Returns the currently active per-joint duty gains for `bus`, or `None`
    /// if PWM gravity comp isn't running on it.
    pub fn get_duty_gains(&self, bus: &BusKey) -> Option<JointDutyGains> {
        self.tasks.read().get(bus).map(|task| *task.duty_gains.read())
    }

    /// Returns the currently active max duty for `bus`, or `None` if PWM
    /// gravity comp isn't running on it.
    pub fn get_max_duty(&self, bus: &BusKey) -> Option<u16> {
        self.tasks.read().get(bus).map(|task| *task.max_duty.read())
    }

    /// Unlocks EEPROM and switches the 7 arm motors to open-loop PWM mode,
    /// then re-locks EEPROM, caps the (largely vestigial in this mode, but
    /// set for defense in depth) hardware `TorqueLimit`, and enables torque.
    /// Split into two `send_st3215_commands` calls because `EepromLock` needs
    /// two different values (0 then 1) in sequence, and a single call can
    /// only carry one value per register per motor - see the ordering
    /// comment in `Inference::send_st3215_commands`.
    fn send_setup_commands(normfs: &Arc<NormFS>, bus_id: &str) {
        let mut unlock_and_mode = Vec::new();
        for &motor_id in &ARM_MOTOR_IDS {
            unlock_and_mode.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::EepromLock(0),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            unlock_and_mode.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::Mode(2),
            });
        }
        Inference::send_st3215_commands(normfs, &Bytes::new(), unlock_and_mode);

        let mut relock_and_enable = Vec::new();
        for &motor_id in &ARM_MOTOR_IDS {
            relock_and_enable.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::EepromLock(1),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            relock_and_enable.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::TorqueLimit(GRAVITY_COMP_TORQUE_LIMIT_CEILING),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            relock_and_enable.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::Torque(1),
            });
        }
        Inference::send_st3215_commands(normfs, &Bytes::new(), relock_and_enable);
    }

    /// Zeroes PWM output *first* - before anything else - then disables
    /// torque and restores position mode. Unlike the offset-based module's
    /// teardown (where a stuck `GoalPosition` just holds a pose), a stuck PWM
    /// command keeps actively driving the motor, so zeroing it is the single
    /// most time-sensitive write this module ever makes.
    fn send_teardown_commands(normfs: &Arc<NormFS>, bus_id: &str) {
        let mut zero_pwm = Vec::new();
        for &motor_id in &ARM_MOTOR_IDS {
            zero_pwm.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::Pwm(0),
            });
        }
        Inference::send_st3215_commands(normfs, &Bytes::new(), zero_pwm);

        let mut restore = Vec::new();
        for &motor_id in &ARM_MOTOR_IDS {
            restore.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::Torque(0),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            restore.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::EepromLock(0),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            restore.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::Mode(0),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            restore.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::EepromLock(1),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            restore.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::TorqueLimit(st3215::presets::DEFAULT_TORQUE_LIMIT),
            });
        }
        Inference::send_st3215_commands(normfs, &Bytes::new(), restore);
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_control_loop<F>(
        bus: BusKey,
        stop_flag: Arc<AtomicBool>,
        duty_gains: Arc<RwLock<JointDutyGains>>,
        max_duty: Arc<RwLock<u16>>,
        normfs: Arc<NormFS>,
        config: MotorConfig,
        on_self_stop: F,
    ) where
        F: Fn(BusKey) + Send + Sync + 'static,
    {
        let mut station_state = StationState::default();
        let mut stale_cycles: u32 = 0;
        let mut overcurrent_cycles: u32 = 0;
        let mut overtemp_cycles: u32 = 0;
        let mut last_debug_log = tokio::time::Instant::now() - std::time::Duration::from_secs(1);

        loop {
            if stop_flag.load(Ordering::SeqCst) {
                return;
            }

            let loop_start = tokio::time::Instant::now();
            let should_log = loop_start.duration_since(last_debug_log) >= std::time::Duration::from_secs(1);
            if should_log {
                last_debug_log = loop_start;
            }

            station_state.update_from_st3215_queue(&normfs).await;

            let now_ns = systime::get_monotonic_stamp_ns();
            let bus_state = station_state.buses.get(&bus);

            let fresh = bus_state
                .map(|b| b.monotonic_stamp_ns > 0 && now_ns.saturating_sub(b.monotonic_stamp_ns) < MAX_DATA_AGE_NS)
                .unwrap_or(false);

            if !fresh {
                stale_cycles += 1;
                if should_log {
                    log::info!(
                        "PWM gravity comp on bus {}: stale data (age_ns={:?}, stale_cycles={}/{})",
                        bus.bus_id,
                        bus_state.map(|b| now_ns.saturating_sub(b.monotonic_stamp_ns)),
                        stale_cycles,
                        config.pwm_gravity_comp.stale_cutoff_cycles
                    );
                }
                if stale_cycles >= config.pwm_gravity_comp.stale_cutoff_cycles {
                    log::warn!(
                        "PWM gravity comp on bus {} stopping: stale data for {} consecutive cycles",
                        bus.bus_id,
                        stale_cycles
                    );
                    Self::send_teardown_commands(&normfs, &bus.bus_id);
                    on_self_stop(bus.clone());
                    return;
                }
                Self::sleep_remaining(loop_start).await;
                continue;
            }
            stale_cycles = 0;

            let bus_state = match bus_state {
                Some(bus_state) => bus_state,
                None => {
                    if should_log {
                        log::info!("PWM gravity comp on bus {}: bus_state unexpectedly None despite fresh=true", bus.bus_id);
                    }
                    Self::sleep_remaining(loop_start).await;
                    continue;
                }
            };

            let mut theta = [0.0f64; JOINT_COUNT];
            let mut over_current = false;
            let mut over_temperature = false;
            let mut have_all_motors = true;
            let mut missing_motor_ids = Vec::new();

            for (i, &motor_id) in ARM_MOTOR_IDS.iter().enumerate() {
                match bus_state.motors.get(&motor_id) {
                    Some(motor) => {
                        let (lower, upper) = JOINT_LIMITS_RAD[i];
                        theta[i] = raw_to_joint_angle(motor.present_position, motor.range_min, motor.range_max, lower, upper, &config);
                        if motor.current >= config.pwm_gravity_comp.current_cutoff {
                            over_current = true;
                        }
                        if motor.temperature >= config.pwm_gravity_comp.temperature_cutoff_celsius {
                            over_temperature = true;
                        }
                    }
                    None => {
                        have_all_motors = false;
                        missing_motor_ids.push(motor_id);
                    }
                }
            }

            if !have_all_motors {
                if should_log {
                    log::info!(
                        "PWM gravity comp on bus {}: waiting on motor data, missing motor ids {:?} (present motor ids: {:?})",
                        bus.bus_id,
                        missing_motor_ids,
                        bus_state.motors.keys().collect::<Vec<_>>()
                    );
                }
                Self::sleep_remaining(loop_start).await;
                continue;
            }

            if over_current {
                overcurrent_cycles += 1;
                if should_log {
                    let currents: Vec<(u8, u16)> = ARM_MOTOR_IDS
                        .iter()
                        .filter_map(|id| bus_state.motors.get(id).map(|m| (*id, m.current)))
                        .collect();
                    log::info!(
                        "PWM gravity comp on bus {}: overcurrent (cutoff={}, overcurrent_cycles={}/{}), currents={:?}",
                        bus.bus_id,
                        config.pwm_gravity_comp.current_cutoff,
                        overcurrent_cycles,
                        config.pwm_gravity_comp.stale_cutoff_cycles,
                        currents
                    );
                }
                if overcurrent_cycles >= config.pwm_gravity_comp.stale_cutoff_cycles {
                    log::warn!(
                        "PWM gravity comp on bus {} stopping: overcurrent for {} consecutive cycles",
                        bus.bus_id,
                        overcurrent_cycles
                    );
                    Self::send_teardown_commands(&normfs, &bus.bus_id);
                    on_self_stop(bus.clone());
                    return;
                }
                // Unlike the offset-based module (which can just hold last
                // cycle's GoalPosition), open-loop PWM has nothing to "hold" -
                // skipping a cycle here would repeat last cycle's torque
                // instead of backing off. Zero every joint's duty this cycle.
                let mut commands = Vec::new();
                for &motor_id in &ARM_MOTOR_IDS {
                    commands.push(Command {
                        target_bus_id: bus.bus_id.clone(),
                        motor_id: motor_id as u32,
                        command: MotorCommand::Pwm(0),
                    });
                }
                Inference::send_st3215_commands(&normfs, &Bytes::new(), commands);
                Self::sleep_remaining(loop_start).await;
                continue;
            }
            overcurrent_cycles = 0;

            if over_temperature {
                overtemp_cycles += 1;
                if should_log {
                    let temperatures: Vec<(u8, u8)> = ARM_MOTOR_IDS
                        .iter()
                        .filter_map(|id| bus_state.motors.get(id).map(|m| (*id, m.temperature)))
                        .collect();
                    log::info!(
                        "PWM gravity comp on bus {}: overtemperature (cutoff={}C, overtemp_cycles={}/{}), temperatures={:?}",
                        bus.bus_id,
                        config.pwm_gravity_comp.temperature_cutoff_celsius,
                        overtemp_cycles,
                        config.pwm_gravity_comp.stale_cutoff_cycles,
                        temperatures
                    );
                }
                if overtemp_cycles >= config.pwm_gravity_comp.stale_cutoff_cycles {
                    log::warn!(
                        "PWM gravity comp on bus {} stopping: overtemperature for {} consecutive cycles",
                        bus.bus_id,
                        overtemp_cycles
                    );
                    Self::send_teardown_commands(&normfs, &bus.bus_id);
                    on_self_stop(bus.clone());
                    return;
                }
                // Same reasoning as the overcurrent branch above: zero every
                // joint's duty rather than skip the cycle, since open-loop
                // PWM has no "hold" to fall back on.
                let mut commands = Vec::new();
                for &motor_id in &ARM_MOTOR_IDS {
                    commands.push(Command {
                        target_bus_id: bus.bus_id.clone(),
                        motor_id: motor_id as u32,
                        command: MotorCommand::Pwm(0),
                    });
                }
                Inference::send_st3215_commands(&normfs, &Bytes::new(), commands);
                Self::sleep_remaining(loop_start).await;
                continue;
            }
            overtemp_cycles = 0;

            let torques = gravity_torques(&theta);
            let current_gains = *duty_gains.read();
            let current_max_duty = *max_duty.read();
            let mut commands = Vec::new();
            let mut debug_rows: Vec<(u8, f64, f64, u16, i16)> = Vec::new();

            for (i, &motor_id) in ARM_MOTOR_IDS.iter().enumerate() {
                let motor = bus_state.motors.get(&motor_id).expect("checked above");

                let range_size = normalize::get_steps_range(motor.range_min, motor.range_max, &config);
                let near_limit = range_size < config.safety_margin * 2
                    || control_pwm::within_limit_margin(motor.present_position, motor.range_min, motor.range_max, config.safety_margin);

                let duty = if near_limit {
                    0
                } else {
                    control_pwm::gravity_torque_to_pwm_duty(torques[i], current_gains[i], current_max_duty)
                };

                if should_log {
                    debug_rows.push((motor_id, current_gains[i], torques[i], motor.present_position, duty));
                }

                commands.push(Command {
                    target_bus_id: bus.bus_id.clone(),
                    motor_id: motor_id as u32,
                    command: MotorCommand::Pwm(duty),
                });
            }

            if should_log {
                log::info!(
                    "PWM gravity comp on bus {}: commands_sent={}, (motor, gain, torque_nm, present, duty)={:?}",
                    bus.bus_id,
                    commands.len(),
                    debug_rows
                );
            }

            Inference::send_st3215_commands(&normfs, &Bytes::new(), commands);

            Self::sleep_remaining(loop_start).await;
        }
    }

    async fn sleep_remaining(loop_start: tokio::time::Instant) {
        let elapsed = loop_start.elapsed();
        if elapsed < GRAVITY_COMP_REFRESH_INTERVAL {
            tokio::time::sleep(GRAVITY_COMP_REFRESH_INTERVAL - elapsed).await;
        }
    }
}

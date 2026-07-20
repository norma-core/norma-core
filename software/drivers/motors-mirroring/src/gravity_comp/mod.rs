//! Orchestration for the leader-arm gravity compensation control loop.
//!
//! ST3215 servos have no native torque/current-setpoint register, only a
//! position loop with a `TorqueLimit` effort clamp - so gravity compensation
//! is approximated by continuously nudging `GoalPosition` around the arm's
//! current pose by an amount proportional to the computed gravity torque,
//! using the servo's internal position gain as an implicit spring. See
//! `elrobot_dynamics` for the torque model and `control` for the offset law.

mod control;
mod elrobot_dynamics;
mod kinematics;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bytes::Bytes;
use normfs::NormFS;
use parking_lot::RwLock;

use crate::config::{clamp_gravity_comp_gain, clamp_gravity_comp_torque_limit, MotorConfig, GRAVITY_COMP_REFRESH_INTERVAL};
use crate::inference::model::StationState;
use crate::inference::normalize;
use crate::inference::{Inference, MAX_DATA_AGE_NS};
use crate::types::{BusKey, Command, MotorCommand};
use elrobot_dynamics::{JOINT_COUNT, JOINT_LIMITS_RAD};

/// ST3215 motor IDs for the 7 compensated arm joints (rev_motor_01..07).
/// Motor 8 (the gripper) is never enabled or commanded by gravity
/// compensation in either direction.
pub const ARM_MOTOR_IDS: [u8; JOINT_COUNT] = [1, 2, 3, 4, 5, 6, 7];

/// Per-joint gains, indexed the same as `ARM_MOTOR_IDS` (index 0 = motor 1,
/// ... index 6 = motor 7).
pub type JointGains = [f64; JOINT_COUNT];

/// A bus's current gravity-comp tuning: live while running, "staged"
/// (remembered but not yet persisted) while stopped, and what gets written
/// to the `motors_mirroring/gravity_comp_settings` queue on GCT_SAVE_SETTINGS.
#[derive(Clone, Copy, Debug)]
pub struct GravitySettings {
    pub joint_gains: JointGains,
    pub torque_limit: u16,
}

fn motor_id_to_index(motor_id: u8) -> Option<usize> {
    ARM_MOTOR_IDS.iter().position(|&id| id == motor_id)
}

struct GravityCompTask {
    stop_flag: Arc<AtomicBool>,
    /// Live-adjustable per-joint gains, read by the control loop every cycle
    /// so they can be tuned from the UI without restarting gravity comp or
    /// the station process.
    gains: Arc<RwLock<JointGains>>,
    /// Live-adjustable torque limit (applies uniformly to all 7 arm motors).
    /// Unlike gain (a pure software multiplier), this is a servo register -
    /// changing it re-sends a TorqueLimit write immediately (see
    /// `GravityComp::set_torque_limit`), it isn't just read by the loop.
    torque_limit: Arc<RwLock<u16>>,
    handle: tokio::task::JoinHandle<()>,
}

/// Tracks the running gravity-comp control-loop task per bus. Owned by
/// `Inference`, which is the only thing that talks to `normfs`/motor state on
/// behalf of gravity comp - this struct is just task lifecycle management.
#[derive(Default)]
pub struct GravityComp {
    tasks: RwLock<HashMap<BusKey, GravityCompTask>>,
}

impl GravityComp {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts the control loop for `bus`. No-op if already running (idempotent,
    /// matching `Inference::start`'s style for mirroring).
    ///
    /// `on_self_stop` is invoked (off the control loop's own task) if the loop
    /// terminates itself for safety reasons (stale data or sustained
    /// overcurrent) - the caller uses this to keep displayed mode state
    /// truthful rather than silently drifting from what's actually running.
    /// `initial_gains`/`initial_torque_limit`, if provided (e.g. from
    /// previously-saved settings), override `config.gravity_comp`'s defaults
    /// as the starting point - either way they're still hard-clamped and
    /// still adjustable afterwards via `set_gain`/`set_torque_limit`.
    pub fn start<F>(
        &self,
        bus: BusKey,
        config: MotorConfig,
        initial_gains: Option<JointGains>,
        initial_torque_limit: Option<u16>,
        normfs: Arc<NormFS>,
        on_self_stop: F,
    ) where
        F: Fn(BusKey) + Send + Sync + 'static,
    {
        if self.tasks.read().contains_key(&bus) {
            return;
        }

        let gains_value: JointGains = initial_gains
            .unwrap_or([config.gravity_comp.gain_rad_per_nm; JOINT_COUNT])
            .map(clamp_gravity_comp_gain);
        let torque_limit_value = clamp_gravity_comp_torque_limit(
            initial_torque_limit.unwrap_or(config.gravity_comp.torque_limit),
        );

        // One-shot setup, ahead of the hot loop: cap TorqueLimit, then enable
        // torque, for the 7 arm motors only. Deferred onto its own spawned
        // task rather than called inline - this fn is invoked synchronously
        // from within the "commands" queue's own subscription callback (see
        // lib.rs::process_command_pack), and send_setup_commands ultimately
        // calls normfs.enqueue() on that *same* queue. Calling it inline
        // would re-enter that queue's enqueue/subscribe machinery from
        // within its own callback stack. Mirroring's Inference::start/stop
        // avoid this exact reentrancy by deferring their equivalent sends
        // the same way - this matches that established, proven-safe pattern.
        {
            let setup_normfs = Arc::clone(&normfs);
            let setup_bus_id = bus.bus_id.clone();
            tokio::spawn(async move {
                Self::send_setup_commands(&setup_normfs, &setup_bus_id, torque_limit_value);
            });
        }

        let gains = Arc::new(RwLock::new(gains_value));
        let torque_limit = Arc::new(RwLock::new(torque_limit_value));

        let stop_flag = Arc::new(AtomicBool::new(false));
        let loop_stop_flag = Arc::clone(&stop_flag);
        let loop_gains = Arc::clone(&gains);
        let loop_bus = bus.clone();
        let loop_normfs = Arc::clone(&normfs);

        let handle = tokio::spawn(async move {
            Self::run_control_loop(loop_bus, loop_stop_flag, loop_gains, loop_normfs, config, on_self_stop).await;
        });

        self.tasks.write().insert(bus, GravityCompTask { stop_flag, gains, torque_limit, handle });
    }

    /// Stops the control loop for `bus` (if running), disables torque, and
    /// restores the default torque limit on the 7 arm motors.
    pub fn stop(&self, bus: &BusKey, normfs: &Arc<NormFS>) {
        if let Some(task) = self.tasks.write().remove(bus) {
            task.stop_flag.store(true, Ordering::SeqCst);
            task.handle.abort();
        }
        // Deferred for the same reentrancy reason as in start() above.
        let teardown_normfs = Arc::clone(normfs);
        let teardown_bus_id = bus.bus_id.clone();
        tokio::spawn(async move {
            Self::send_teardown_commands(&teardown_normfs, &teardown_bus_id);
        });
    }

    /// Stops every currently-running gravity-comp task, disabling torque on
    /// each. Called during graceful process shutdown so an active gravity
    /// comp session doesn't leave a bus's torque state undefined when the
    /// station process exits.
    pub fn stop_all(&self, normfs: &Arc<NormFS>) {
        let buses: Vec<BusKey> = self.tasks.read().keys().cloned().collect();
        for bus in buses {
            self.stop(&bus, normfs);
        }
    }

    /// Live-updates the gain of one arm joint for a running gravity-comp
    /// task, without restarting it. `motor_id` is the raw ST3215 motor ID
    /// (1-7). Returns `false` if `bus` has no running task or `motor_id`
    /// isn't one of the 7 compensated arm joints.
    pub fn set_gain(&self, bus: &BusKey, motor_id: u8, gain: f64) -> bool {
        let index = match motor_id_to_index(motor_id) {
            Some(index) => index,
            None => return false,
        };
        let tasks = self.tasks.read();
        match tasks.get(bus) {
            Some(task) => {
                task.gains.write()[index] = clamp_gravity_comp_gain(gain);
                true
            }
            None => false,
        }
    }

    /// Live-updates the torque limit (applies to all 7 arm motors) for a
    /// running gravity-comp task, without restarting it. Unlike gain, this
    /// immediately re-sends a `TorqueLimit` register write, since it's
    /// hardware state rather than a value the control loop merely reads.
    /// Returns `false` if `bus` has no running task.
    pub fn set_torque_limit(&self, bus: &BusKey, torque_limit: u16, normfs: &Arc<NormFS>) -> bool {
        let clamped = clamp_gravity_comp_torque_limit(torque_limit);
        let updated = {
            let tasks = self.tasks.read();
            match tasks.get(bus) {
                Some(task) => {
                    *task.torque_limit.write() = clamped;
                    true
                }
                None => false,
            }
        };

        if updated {
            let normfs = Arc::clone(normfs);
            let bus_id = bus.bus_id.clone();
            tokio::spawn(async move {
                let mut commands = Vec::new();
                for &motor_id in &ARM_MOTOR_IDS {
                    commands.push(Command {
                        target_bus_id: bus_id.clone(),
                        motor_id: motor_id as u32,
                        command: MotorCommand::TorqueLimit(clamped),
                    });
                }
                Inference::send_st3215_commands(&normfs, &Bytes::new(), commands);
            });
        }

        updated
    }

    /// Returns the currently active per-joint gains for `bus`, or `None` if
    /// gravity comp isn't running on it.
    pub fn get_gains(&self, bus: &BusKey) -> Option<JointGains> {
        self.tasks.read().get(bus).map(|task| *task.gains.read())
    }

    /// Returns the currently active torque limit for `bus`, or `None` if
    /// gravity comp isn't running on it.
    pub fn get_torque_limit(&self, bus: &BusKey) -> Option<u16> {
        self.tasks.read().get(bus).map(|task| *task.torque_limit.read())
    }

    fn send_setup_commands(normfs: &Arc<NormFS>, bus_id: &str, torque_limit: u16) {
        let mut commands = Vec::new();
        for &motor_id in &ARM_MOTOR_IDS {
            commands.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::TorqueLimit(torque_limit),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            commands.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::Torque(1),
            });
        }
        Inference::send_st3215_commands(normfs, &Bytes::new(), commands);
    }

    fn send_teardown_commands(normfs: &Arc<NormFS>, bus_id: &str) {
        let mut commands = Vec::new();
        for &motor_id in &ARM_MOTOR_IDS {
            commands.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::Torque(0),
            });
        }
        for &motor_id in &ARM_MOTOR_IDS {
            commands.push(Command {
                target_bus_id: bus_id.to_string(),
                motor_id: motor_id as u32,
                command: MotorCommand::TorqueLimit(st3215::presets::DEFAULT_TORQUE_LIMIT),
            });
        }
        Inference::send_st3215_commands(normfs, &Bytes::new(), commands);
    }

    async fn run_control_loop<F>(
        bus: BusKey,
        stop_flag: Arc<AtomicBool>,
        gains: Arc<RwLock<JointGains>>,
        normfs: Arc<NormFS>,
        config: MotorConfig,
        on_self_stop: F,
    ) where
        F: Fn(BusKey) + Send + Sync + 'static,
    {
        let mut station_state = StationState::default();
        let mut stale_cycles: u32 = 0;
        let mut overcurrent_cycles: u32 = 0;
        // Rate-limited diagnostic summary - one line/second instead of every
        // 20ms cycle, so the loop's actual behavior (fresh/stale, missing
        // motors, overcurrent, computed torques/offsets, commands sent) is
        // visible in logs without flooding them.
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
                        "Gravity comp on bus {}: stale data (age_ns={:?}, stale_cycles={}/{})",
                        bus.bus_id,
                        bus_state.map(|b| now_ns.saturating_sub(b.monotonic_stamp_ns)),
                        stale_cycles,
                        config.gravity_comp.stale_cutoff_cycles
                    );
                }
                if stale_cycles >= config.gravity_comp.stale_cutoff_cycles {
                    log::warn!(
                        "Gravity comp on bus {} stopping: stale data for {} consecutive cycles",
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
                        log::info!("Gravity comp on bus {}: bus_state unexpectedly None despite fresh=true", bus.bus_id);
                    }
                    Self::sleep_remaining(loop_start).await;
                    continue;
                }
            };

            let mut theta = [0.0f64; JOINT_COUNT];
            let mut over_current = false;
            let mut have_all_motors = true;
            let mut missing_motor_ids = Vec::new();

            for (i, &motor_id) in ARM_MOTOR_IDS.iter().enumerate() {
                match bus_state.motors.get(&motor_id) {
                    Some(motor) => {
                        let (lower, upper) = JOINT_LIMITS_RAD[i];
                        theta[i] = control::raw_to_joint_angle(motor.present_position, motor.range_min, motor.range_max, lower, upper, &config);
                        if motor.current >= config.gravity_comp.current_cutoff {
                            over_current = true;
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
                        "Gravity comp on bus {}: waiting on motor data, missing motor ids {:?} (present motor ids: {:?})",
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
                        "Gravity comp on bus {}: overcurrent (cutoff={}, overcurrent_cycles={}/{}), currents={:?}",
                        bus.bus_id,
                        config.gravity_comp.current_cutoff,
                        overcurrent_cycles,
                        config.gravity_comp.stale_cutoff_cycles,
                        currents
                    );
                }
                if overcurrent_cycles >= config.gravity_comp.stale_cutoff_cycles {
                    log::warn!(
                        "Gravity comp on bus {} stopping: overcurrent for {} consecutive cycles",
                        bus.bus_id,
                        overcurrent_cycles
                    );
                    Self::send_teardown_commands(&normfs, &bus.bus_id);
                    on_self_stop(bus.clone());
                    return;
                }
                // Hold position this cycle rather than commanding a new goal.
                Self::sleep_remaining(loop_start).await;
                continue;
            }
            overcurrent_cycles = 0;

            let torques = elrobot_dynamics::gravity_torques(&theta);
            let current_gains = *gains.read();
            let mut commands = Vec::new();
            let mut debug_rows: Vec<(u8, f64, f64, u16, i32, u16)> = Vec::new();

            for (i, &motor_id) in ARM_MOTOR_IDS.iter().enumerate() {
                let motor = bus_state.motors.get(&motor_id).expect("checked above");
                let (lower, upper) = JOINT_LIMITS_RAD[i];

                let range_size = normalize::get_steps_range(motor.range_min, motor.range_max, &config);
                if range_size < config.safety_margin * 2 {
                    if should_log {
                        log::info!(
                            "Gravity comp on bus {}: motor {} skipped, range too narrow (range_size={}, need >= {})",
                            bus.bus_id,
                            motor_id,
                            range_size,
                            config.safety_margin * 2
                        );
                    }
                    continue; // not calibrated enough to safely offset this motor
                }

                let tpr = control::ticks_per_radian(motor.range_min, motor.range_max, lower, upper, &config);
                let offset = control::gravity_torque_to_goal_offset_ticks(
                    torques[i],
                    current_gains[i],
                    config.gravity_comp.max_offset_ticks,
                    tpr,
                );

                let goal = Self::clamp_goal(motor.present_position, offset, motor.range_min, motor.range_max, config.safety_margin, config.max_steps);

                if should_log {
                    debug_rows.push((motor_id, current_gains[i], torques[i], motor.present_position, offset, goal));
                }

                commands.push(Command {
                    target_bus_id: bus.bus_id.clone(),
                    motor_id: motor_id as u32,
                    command: MotorCommand::Goal(goal),
                });
            }

            if should_log {
                log::info!(
                    "Gravity comp on bus {}: commands_sent={}, (motor, gain, torque_nm, present, offset_ticks, goal)={:?}",
                    bus.bus_id,
                    commands.len(),
                    debug_rows
                );
            }

            if !commands.is_empty() {
                Inference::send_st3215_commands(&normfs, &Bytes::new(), commands);
            }

            Self::sleep_remaining(loop_start).await;
        }
    }

    /// Applies the offset to `present`, wrapping into the servo's tick space,
    /// then clamps into the calibrated range minus a safety margin.
    fn clamp_goal(present: u16, offset: i32, range_min: u16, range_max: u16, margin: u16, max_steps: u16) -> u16 {
        let max_steps_i = max_steps as i32;
        let raw = (present as i32 + offset).rem_euclid(max_steps_i);

        if range_max < range_min {
            // Calibrated range wraps across the 0/max_steps boundary - skip
            // clamping in this rarer case and hold position rather than risk
            // an incorrect wraparound comparison.
            return present;
        }

        let lo = range_min as i32 + margin as i32;
        let hi = range_max as i32 - margin as i32;
        if hi <= lo {
            return present;
        }

        raw.clamp(lo, hi) as u16
    }

    async fn sleep_remaining(loop_start: tokio::time::Instant) {
        let elapsed = loop_start.elapsed();
        if elapsed < GRAVITY_COMP_REFRESH_INTERVAL {
            tokio::time::sleep(GRAVITY_COMP_REFRESH_INTERVAL - elapsed).await;
        }
    }
}

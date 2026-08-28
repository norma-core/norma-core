use std::{collections::HashMap, time::Duration};

pub const MIRRORING_REFRESH_INTERVAL: Duration = Duration::from_millis(20);

/// Gravity compensation runs at the same cadence as mirroring.
pub const GRAVITY_COMP_REFRESH_INTERVAL: Duration = Duration::from_millis(20);

/// Hard ceilings enforced in code regardless of what a config file supplies -
/// a misconfigured value can never push the arm past these.
pub const GRAVITY_COMP_TORQUE_LIMIT_CEILING: u16 = 150;
const GRAVITY_COMP_MAX_OFFSET_TICKS_CEILING: u16 = 200;

/// Clamps a torque limit (config-supplied or live from the UI) to the hard
/// ceiling, independent of source.
pub fn clamp_gravity_comp_torque_limit(value: u16) -> u16 {
    value.min(GRAVITY_COMP_TORQUE_LIMIT_CEILING)
}

/// Hard ceiling on `gain_rad_per_nm`, including when set live from the UI
/// (see `gravity_comp::GravityComp::set_gain`) - independent of any
/// config-file value.
pub const GRAVITY_COMP_GAIN_CEILING: f64 = 1.0;

pub fn clamp_gravity_comp_gain(gain: f64) -> f64 {
    if !gain.is_finite() {
        return 0.0;
    }
    gain.clamp(0.0, GRAVITY_COMP_GAIN_CEILING)
}

/// Hard ceiling on PWM duty cycle (out of the servo's native ±1000 open-loop
/// range), including when set live from the UI - independent of any
/// config-file value. Deliberately more conservative than
/// `GRAVITY_COMP_TORQUE_LIMIT_CEILING`'s ratio (150/1000): this control law is
/// fully open-loop (no position feedback stops a joint at a mechanical limit)
/// and has not been validated on real hardware the way the offset-based
/// `gravity_comp` module was before merge.
pub const PWM_GRAVITY_COMP_MAX_DUTY_CEILING: u16 = 100;

pub fn clamp_pwm_gravity_comp_max_duty(value: u16) -> u16 {
    value.min(PWM_GRAVITY_COMP_MAX_DUTY_CEILING)
}

/// Hard ceiling on `duty_per_nm`, including when set live from the UI (see
/// `gravity_comp_pwm::GravityCompPwm::set_duty_gain`) - independent of any
/// config-file value. `duty_per_nm` has no natural physical ceiling the way
/// `gain_rad_per_nm` does (there's no joint-angle range to overshoot), so this
/// value is chosen generously loose - `PWM_GRAVITY_COMP_MAX_DUTY_CEILING` is
/// the ceiling that actually matters day-to-day.
pub const PWM_GRAVITY_COMP_DUTY_GAIN_CEILING: f64 = 1000.0;

pub fn clamp_pwm_gravity_comp_duty_gain(duty_per_nm: f64) -> f64 {
    if !duty_per_nm.is_finite() {
        return 0.0;
    }
    duty_per_nm.clamp(0.0, PWM_GRAVITY_COMP_DUTY_GAIN_CEILING)
}

/// Hard ceiling on the temperature cutoff (degrees Celsius), including when
/// set via a config file - independent of source. Continuous PWM drive can
/// keep a servo working against gravity indefinitely with no natural
/// "settled and coasting" phase the way position mode has, so this control
/// law is more exposed to sustained heating than the offset-based one -
/// 70C is comfortably below the ~80C range where hobby-servo internal
/// thermal protection typically kicks in, so the software cutoff trips
/// first.
pub const PWM_GRAVITY_COMP_TEMPERATURE_CUTOFF_CEILING: u8 = 70;

pub fn clamp_pwm_gravity_comp_temperature_cutoff(value: u8) -> u8 {
    value.min(PWM_GRAVITY_COMP_TEMPERATURE_CUTOFF_CEILING)
}

#[derive(Clone)]
pub struct MotorConfig {
    pub safety_margin: u16,
    pub deadband: u16,
    pub max_speed: u16,
    pub min_speed: u16,
    pub max_accel: u16,
    pub min_accel: u16,
    pub max_steps: u16,
    /// Default current threshold (in raw units). When target motor's current exceeds this,
    /// set goal to current position to prevent overload.
    /// 0 means disabled.
    pub current_threshold: u16,
    /// Per-motor current threshold overrides. Key is motor_id (0-255).
    /// If a motor_id is in this map, its value overrides the default current_threshold.
    pub per_motor_current_threshold: HashMap<u8, u16>,
    pub gravity_comp: GravityCompConfig,
    pub pwm_gravity_comp: PwmGravityCompConfig,
}

/// Tunables for the leader-arm gravity compensation control loop.
///
/// `gain_rad_per_nm` cannot be derived analytically from the ST3215's internal
/// PID coefficients (they're in undocumented firmware units) - it must be
/// tuned empirically on real hardware, starting near zero and increasing
/// until the arm feels weightless without oscillating.
#[derive(Clone, Copy)]
pub struct GravityCompConfig {
    pub gain_rad_per_nm: f64,
    pub max_offset_ticks: u16,
    pub torque_limit: u16,
    pub current_cutoff: u16,
    pub stale_cutoff_cycles: u32,
}

impl GravityCompConfig {
    /// Clamp user-supplied values to hard safety ceilings - never trust
    /// configured values alone.
    pub fn clamped(mut self) -> Self {
        self.torque_limit = clamp_gravity_comp_torque_limit(self.torque_limit);
        self.max_offset_ticks = self.max_offset_ticks.min(GRAVITY_COMP_MAX_OFFSET_TICKS_CEILING);
        self.gain_rad_per_nm = clamp_gravity_comp_gain(self.gain_rad_per_nm);
        self
    }
}

impl Default for GravityCompConfig {
    fn default() -> Self {
        Self {
            gain_rad_per_nm: 0.05,
            max_offset_ticks: 60,
            torque_limit: 100,
            current_cutoff: 60,
            stale_cutoff_cycles: 5,
        }
        .clamped()
    }
}

/// Tunables for the leader-arm PWM (open-loop) gravity compensation control
/// loop - a direct feedforward-torque alternative to `GravityCompConfig`'s
/// position-offset approximation. See `gravity_comp_pwm::CLAUDE.md` for why
/// this is a fundamentally different (and less proven) control law.
///
/// `duty_per_nm` cannot be derived analytically any more than
/// `gain_rad_per_nm` can - it must be tuned empirically on real hardware.
/// Unlike `gain_rad_per_nm`, it defaults to exactly zero: this control law has
/// never been validated on real hardware, so enabling it should do nothing
/// until an operator deliberately dials it up.
#[derive(Clone, Copy)]
pub struct PwmGravityCompConfig {
    pub duty_per_nm: f64,
    pub max_duty: u16,
    pub current_cutoff: u16,
    /// Hard torque-off if any arm motor's `PresentTemperature` reaches this
    /// many degrees Celsius for `stale_cutoff_cycles` consecutive cycles -
    /// same self-stop path as the staleness/overcurrent cutoffs. See
    /// `PWM_GRAVITY_COMP_TEMPERATURE_CUTOFF_CEILING`.
    pub temperature_cutoff_celsius: u8,
    pub stale_cutoff_cycles: u32,
}

impl PwmGravityCompConfig {
    /// Clamp user-supplied values to hard safety ceilings - never trust
    /// configured values alone.
    pub fn clamped(mut self) -> Self {
        self.max_duty = clamp_pwm_gravity_comp_max_duty(self.max_duty);
        self.duty_per_nm = clamp_pwm_gravity_comp_duty_gain(self.duty_per_nm);
        self.temperature_cutoff_celsius = clamp_pwm_gravity_comp_temperature_cutoff(self.temperature_cutoff_celsius);
        self
    }
}

impl Default for PwmGravityCompConfig {
    fn default() -> Self {
        Self {
            duty_per_nm: 0.0,
            max_duty: 60,
            current_cutoff: 60,
            temperature_cutoff_celsius: 55,
            stale_cutoff_cycles: 5,
        }
        .clamped()
    }
}

impl MotorConfig {
    /// Get the effective current threshold for a specific motor.
    /// Returns the per-motor override if set, otherwise the default threshold.
    pub fn get_current_threshold(&self, motor_id: u8) -> u16 {
        self.per_motor_current_threshold
            .get(&motor_id)
            .copied()
            .unwrap_or(self.current_threshold)
    }

    /// Set a per-motor current threshold override.
    pub fn set_motor_current_threshold(&mut self, motor_id: u8, threshold: u16) {
        self.per_motor_current_threshold.insert(motor_id, threshold);
    }

    /// Clear a per-motor current threshold override, reverting to default.
    pub fn clear_motor_current_threshold(&mut self, motor_id: u8) {
        self.per_motor_current_threshold.remove(&motor_id);
    }
}

impl Default for MotorConfig {
    fn default() -> Self {
        Self {
            safety_margin: 20,
            deadband: 20,
            max_speed: 3300,
            min_speed: 300,
            max_accel: 100,
            min_accel: 5,
            max_steps: 4096,
            current_threshold: 100, // enabled by default with threshold of 100
            per_motor_current_threshold: HashMap::new(),
            gravity_comp: GravityCompConfig::default(),
            pwm_gravity_comp: PwmGravityCompConfig::default(),
        }
    }
}

impl From<&station_iface::config::St3215Config> for MotorConfig {
    fn from(config: &station_iface::config::St3215Config) -> Self {
        let gravity_comp = config
            .gravity_comp
            .as_ref()
            .map(|gc| GravityCompConfig {
                gain_rad_per_nm: gc.gain_rad_per_nm,
                max_offset_ticks: gc.max_offset_ticks,
                torque_limit: gc.torque_limit,
                current_cutoff: gc.current_cutoff,
                stale_cutoff_cycles: gc.stale_cutoff_cycles,
            }.clamped())
            .unwrap_or_default();

        let pwm_gravity_comp = config
            .pwm_gravity_comp
            .as_ref()
            .map(|pgc| PwmGravityCompConfig {
                duty_per_nm: pgc.duty_per_nm,
                max_duty: pgc.max_duty,
                current_cutoff: pgc.current_cutoff,
                temperature_cutoff_celsius: pgc.temperature_cutoff_celsius,
                stale_cutoff_cycles: pgc.stale_cutoff_cycles,
            }.clamped())
            .unwrap_or_default();

        Self {
            current_threshold: config.current_threshold,
            deadband: config.deadband,
            per_motor_current_threshold: config.motor_current_thresholds.clone().unwrap_or_default(),
            gravity_comp,
            pwm_gravity_comp,
            ..Default::default()
        }
    }
}
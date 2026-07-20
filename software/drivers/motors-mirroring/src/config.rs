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

        Self {
            current_threshold: config.current_threshold,
            deadband: config.deadband,
            per_motor_current_threshold: config.motor_current_thresholds.clone().unwrap_or_default(),
            gravity_comp,
            ..Default::default()
        }
    }
}
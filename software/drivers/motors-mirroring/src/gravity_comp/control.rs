//! Control law converting a computed gravity torque (Nm) into a servo
//! `GoalPosition` offset, using the ST3215's position loop as an implicit
//! spring (the servo has no native torque/current setpoint register).

use crate::config::MotorConfig;
use crate::inference::normalize;

/// Ticks per radian for a given motor's *live calibrated* range, derived
/// from its known URDF joint angle limits rather than a fixed global
/// constant - the calibrated range on a real unit rarely matches the servo's
/// full 4096-tick sweep exactly.
pub fn ticks_per_radian(range_min: u16, range_max: u16, joint_lower: f64, joint_upper: f64, config: &MotorConfig) -> f64 {
    let angular_range = (joint_upper - joint_lower).abs();
    if angular_range < 1e-9 {
        return 0.0;
    }
    let range_size = normalize::get_steps_range(range_min, range_max, config) as f64;
    range_size / angular_range
}

/// Raw present-position ticks -> joint angle (radians), mirroring the exact
/// convention the frontend uses in `devices/elrobot/config.ts`'s
/// `resolveElrobotJointValue`: normalize into the calibrated range, map
/// through the URDF joint limits, then flip (`upper - position`).
pub fn raw_to_joint_angle(
    present_position: u16,
    range_min: u16,
    range_max: u16,
    joint_lower: f64,
    joint_upper: f64,
    config: &MotorConfig,
) -> f64 {
    let normalized = normalize::normalize_position(present_position, range_min, range_max, config) / 100.0;
    let joint_position = joint_lower + normalized * (joint_upper - joint_lower);
    joint_upper - joint_position
}

/// Converts a computed gravity torque into a clamped `GoalPosition` tick
/// offset to add to `present_position`.
///
/// The offset is a small bias in the direction gravity is pulling the joint,
/// proportional to how hard it's pulling: the servo's internal position loop
/// then supplies a restoring torque proportional to that bias, approximating
/// the needed holding torque. Sign is flipped to match the same
/// `upper - joint_position` inversion used by `raw_to_joint_angle`.
pub fn gravity_torque_to_goal_offset_ticks(tau_nm: f64, gain_rad_per_nm: f64, max_offset_ticks: u16, ticks_per_radian: f64) -> i32 {
    let delta_theta_rad = gain_rad_per_nm * tau_nm;
    let delta_ticks = -(delta_theta_rad * ticks_per_radian);
    let max = max_offset_ticks as f64;
    delta_ticks.clamp(-max, max).round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> MotorConfig {
        MotorConfig::default()
    }

    #[test]
    fn zero_torque_produces_zero_offset() {
        let tpr = ticks_per_radian(0, 4000, -1.5, 1.5, &test_config());
        assert_eq!(gravity_torque_to_goal_offset_ticks(0.0, 0.05, 60, tpr), 0);
    }

    #[test]
    fn offset_is_clamped_to_max() {
        let tpr = ticks_per_radian(0, 4000, -1.5, 1.5, &test_config());
        let offset = gravity_torque_to_goal_offset_ticks(1000.0, 0.05, 60, tpr);
        assert_eq!(offset.unsigned_abs(), 60);
    }

    #[test]
    fn raw_to_joint_angle_matches_endpoints() {
        let config = test_config();
        // present_position == range_min -> normalized 0 -> joint_position ==
        // joint_lower -> angle == upper - lower.
        let angle_at_min = raw_to_joint_angle(1000, 1000, 3000, -1.0, 1.0, &config);
        assert!((angle_at_min - 2.0).abs() < 1e-9);

        // present_position == range_max -> normalized 100 -> joint_position ==
        // joint_upper -> angle == 0.
        let angle_at_max = raw_to_joint_angle(3000, 1000, 3000, -1.0, 1.0, &config);
        assert!(angle_at_max.abs() < 1e-9);
    }
}

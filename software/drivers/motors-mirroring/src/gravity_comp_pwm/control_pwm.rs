//! Control law converting a computed gravity torque (Nm) directly into a
//! servo PWM duty-cycle command - true feedforward torque, not routed through
//! a position setpoint the way `gravity_comp::control` is. See this module's
//! parent `CLAUDE.md` for why that also means it needs a safety primitive
//! (`within_limit_margin`) the offset-based module got for free from
//! `clamp_goal`'s range clamping.

/// Converts a computed gravity torque into a clamped PWM duty-cycle command
/// (native range roughly ±1000, further capped by `max_duty`). No
/// position-offset math at all: `duty_per_nm` is a direct torque-to-duty
/// proportionality constant, tuned empirically per joint exactly like
/// `gravity_comp::control::gravity_torque_to_goal_offset_ticks`'s
/// `gain_rad_per_nm`, but with no implicit spring from a position loop -
/// this *is* the output, not a bias added to one.
pub fn gravity_torque_to_pwm_duty(tau_nm: f64, duty_per_nm: f64, max_duty: u16) -> i16 {
    let duty = duty_per_nm * tau_nm;
    let max = max_duty as f64;
    duty.clamp(-max, max).round() as i16
}

/// True if `present` is within `margin` ticks of either end of the
/// calibrated `[range_min, range_max]` range. The offset-based module never
/// needed this: `clamp_goal` always confines `GoalPosition` inside the
/// calibrated range, so the servo's own position loop physically cannot
/// drive a joint past it. Open-loop PWM has no such backstop - a nonzero
/// duty keeps being applied even if the joint is already at (or past) its
/// mechanical limit - so the control loop must zero a joint's duty near its
/// limit itself, regardless of which direction the computed torque points.
pub fn within_limit_margin(present: u16, range_min: u16, range_max: u16, margin: u16) -> bool {
    if range_max < range_min {
        // Calibrated range wraps across the 0/max_steps boundary - treat as
        // "at the limit" (skip driving this joint) rather than risk an
        // incorrect wraparound comparison, matching `clamp_goal`'s stance.
        return true;
    }
    let lo = range_min as i32 + margin as i32;
    let hi = range_max as i32 - margin as i32;
    if hi <= lo {
        return true;
    }
    (present as i32) <= lo || (present as i32) >= hi
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_torque_produces_zero_duty() {
        assert_eq!(gravity_torque_to_pwm_duty(0.0, 5.0, 60), 0);
    }

    #[test]
    fn duty_is_clamped_to_max() {
        assert_eq!(gravity_torque_to_pwm_duty(1000.0, 5.0, 60), 60);
        assert_eq!(gravity_torque_to_pwm_duty(-1000.0, 5.0, 60), -60);
    }

    #[test]
    fn duty_scales_with_gain_and_torque() {
        assert_eq!(gravity_torque_to_pwm_duty(2.0, 10.0, 100), 20);
        assert_eq!(gravity_torque_to_pwm_duty(-2.0, 10.0, 100), -20);
    }

    #[test]
    fn within_limit_margin_detects_both_edges() {
        // range [1000, 3000], margin 20
        assert!(within_limit_margin(1000, 1000, 3000, 20)); // at min
        assert!(within_limit_margin(1015, 1000, 3000, 20)); // inside margin of min
        assert!(within_limit_margin(3000, 1000, 3000, 20)); // at max
        assert!(within_limit_margin(2985, 1000, 3000, 20)); // inside margin of max
        assert!(!within_limit_margin(2000, 1000, 3000, 20)); // mid-range, clear
    }

    #[test]
    fn within_limit_margin_treats_wrapped_range_as_at_limit() {
        assert!(within_limit_margin(2000, 3000, 1000, 20));
    }

    #[test]
    fn within_limit_margin_treats_degenerate_range_as_at_limit() {
        // margin*2 >= range size -> nowhere is safely "clear"
        assert!(within_limit_margin(1010, 1000, 1020, 20));
    }
}

use super::memory::RamRegister;

pub const MAX_ANGLE_STEP: u16 = 4095;
const SIGN_BIT_MASK: u16 = 0x8000;

/// Encodes a signed magnitude using Feetech's "direction bit" convention, used
/// by Speed/Load/PWM-style 16-bit registers (distinct from `PresentPosition`'s
/// bit-15 sign-extension handled by `normal_position` above): bits
/// `0..bit_pos` hold the magnitude, and `bit_pos` itself is the sign (1 =
/// negative). `magnitude` is clamped to what fits below `bit_pos` before
/// encoding, so an out-of-range caller can't corrupt the sign bit or bits
/// above it.
pub fn encode_direction_bit(value: i16, bit_pos: u8) -> u16 {
    let max_magnitude = (1u16 << bit_pos) - 1;
    let magnitude = (value.unsigned_abs()).min(max_magnitude);
    if value < 0 {
        magnitude | (1u16 << bit_pos)
    } else {
        magnitude
    }
}

pub fn normal_position(position: u16) -> u16 {
    if position & SIGN_BIT_MASK != 0 {
        let magnitude = position & MAX_ANGLE_STEP;
        (MAX_ANGLE_STEP + 1 - magnitude) & MAX_ANGLE_STEP
    } else {
        position & MAX_ANGLE_STEP
    }
}

/// Extract motor position from state bytes
pub fn get_motor_position(state: &[u8]) -> u16 {
    let addr = RamRegister::PresentPosition.address() as usize;
    if state.len() < addr + 2 {
        return 0;
    }
    normal_position(u16::from_le_bytes([state[addr], state[addr + 1]]))
}

/// Extract motor goal position from state bytes
pub fn get_motor_goal_position(state: &[u8]) -> u16 {
    let addr = RamRegister::GoalPosition.address() as usize;
    if state.len() < addr + 2 {
        return 0;
    }
    normal_position(u16::from_le_bytes([state[addr], state[addr + 1]]))
}

/// Extract motor current from state bytes (in milliamps)
pub fn get_motor_current(state: &[u8]) -> u16 {
    let addr = RamRegister::PresentCurrent.address() as usize;
    if state.len() < addr + 2 {
        return 0;
    }
    u16::from_le_bytes([state[addr], state[addr + 1]])
}

/// Extract motor velocity from state bytes
pub fn get_motor_velocity(state: &[u8]) -> u16 {
    let addr = RamRegister::PresentSpeed.address() as usize;
    if state.len() < addr + 2 {
        return 0;
    }
    u16::from_le_bytes([state[addr], state[addr + 1]])
}

/// Normalize motor position to [0.0, 1.0] range
pub fn normalize_motor_position(value: u16, min: u16, max: u16) -> f32 {
    if min == max {
        return 0.0;
    }

    let motor_range = if max > min {
        (max - min) as f32
    } else {
        (4096 + max - min) as f32
    };

    let threshold = motor_range * 0.04;

    // Check if out of bounds
    if max > min {
        if value < min {
            let delta = (min - value) as f32;
            if delta < threshold {
                return 0.0;
            }
        } else if value > max {
            let delta = (value - max) as f32;
            if delta < threshold {
                return 1.0;
            }
        }
    } else if value > max && value < min {
        let delta_to_max = (value - max) as f32;
        let delta_to_min = (min - value) as f32;
        if delta_to_min <= delta_to_max && delta_to_min < threshold {
            return 0.0;
        }
        if delta_to_max < delta_to_min && delta_to_max < threshold {
            return 1.0;
        }
    }

    // Normal position calculation
    let pos = if max > min || value >= min {
        (value - min) as f32
    } else {
        (4096 + value - min) as f32
    };

    pos / motor_range
}

/// Check if motor is in error state
pub fn is_motor_error(state: &[u8]) -> bool {
    let addr = RamRegister::Status.address() as usize;
    if state.len() < addr + 1 {
        return true; // Insufficient data is also an error
    }
    state[addr] != 0
}

/// Check if motor has torque enabled
pub fn is_torque_enabled(state: &[u8]) -> bool {
    let addr = RamRegister::TorqueEnable.address() as usize;
    if state.len() < addr + 1 {
        return false;
    }
    state[addr] != 0
}

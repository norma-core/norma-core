#![allow(clippy::collapsible_if)]

use super::normalize;
use crate::{
    config::MotorConfig,
    inference::model::{MotorProtectionState, MotorState, MovementDirection, ProtectionKey},
    r#types::{Command, MotorCommand},
};
use std::collections::HashMap;

fn calculate_shortest_distance(pos1: u16, pos2: u16, config: &MotorConfig) -> u16 {
    let half_max_steps = config.max_steps / 2;
    let distance = pos1.abs_diff(pos2);

    if distance > half_max_steps {
        config.max_steps - distance
    } else {
        distance
    }
}

fn get_speed_and_accel_by_distance(
    target_bus_id: &str,
    motor_id: u16,
    distance: u16,
    state: &MotorState,
    config: &MotorConfig,
    commands: &mut Vec<Command>,
) {
    let share = distance as f64 / (config.max_steps / 2) as f64;
    let speed = (share * (config.max_speed - config.min_speed) as f64) as u16 + config.min_speed;
    let accel = (share * (config.max_accel - config.min_accel) as f64) as u16 + config.min_accel;

    if speed == state.goal_speed && (accel as u8) == state.goal_accel {
        return;
    }

    commands.extend_from_slice(&[
        Command {
            target_bus_id: target_bus_id.to_string(),
            motor_id: motor_id as u32,
            command: MotorCommand::Speed(speed),
        },
        Command {
            target_bus_id: target_bus_id.to_string(),
            motor_id: motor_id as u32,
            command: MotorCommand::Accel(accel),
        },
    ]);
}

pub fn get_movement_sequence_with_goal(
    target_bus_id: &str,
    motor_id: u16,
    source: &MotorState,
    target: &MotorState,
    config: &MotorConfig,
    protection_states: &mut HashMap<ProtectionKey, MotorProtectionState>,
    commands: &mut Vec<Command>,
) {
    let source_percent = normalize::normalize_position(
        source.present_position,
        source.range_min,
        source.range_max,
        config,
    );

    // Voltage faults on the leader are common (rail dips under load) and shouldn't
    // stop mirroring — mask bit 0 before gating.
    const MIRRORING_IGNORED_BITS: u8 = 0x01; // Voltage
    let blocking_source = source.error_status & !MIRRORING_IGNORED_BITS;
    if blocking_source != 0 {
        let source_errors = st3215::protocol::ServoError::from_bits(source.error_status);
        let target_errors = st3215::protocol::ServoError::from_bits(target.error_status);
        log::warn!(
            "Skipping mirroring for motor {} on bus {} due to error state [source=0x{:02X} {:?}, target=0x{:02X} {:?}], curr = {}, limit = {}",
            motor_id,
            target_bus_id,
            source.error_status,
            source_errors,
            target.error_status,
            target_errors,
            source.current,
            source.current_limit
        );
        return;
    }
    if source.present_position == 0 || target.present_position == 0 {
        // just skip for now
        log::warn!(
            "Skipping mirroring for motor {} on bus {} due to zero position [source={}, target={}]",
            motor_id,
            target_bus_id,
            source.present_position,
            target.present_position
        );
        return;
    }

    let target_range_size = normalize::get_steps_range(target.range_min, target.range_max, config);
    if target_range_size < config.safety_margin * 2 {
        log::warn!(
            "Skipping mirroring for motor {} on bus {} due to insufficient range size",
            motor_id,
            target_bus_id
        );
        return;
    }
    let target_range_size = target_range_size - config.safety_margin * 2;

    let goal_offset =
        (source_percent / 100.0 * target_range_size as f64) as u16 + config.safety_margin;
    let goal_position =
        ((target.range_min as u32 + goal_offset as u32) & (config.max_steps - 1) as u32) as u16;

    // Get or create protection state for this motor
    let protection_key = (target_bus_id.to_string(), motor_id as u8);
    let protection_state = protection_states.entry(protection_key).or_default();

    // Determine what direction the leader is commanding
    let leader_direction = if goal_position > target.present_position {
        Some(MovementDirection::Positive)
    } else if goal_position < target.present_position {
        Some(MovementDirection::Negative)
    } else {
        None // No movement needed
    };

    // Current protection: track direction that causes high current and block it
    let current_threshold = config.get_current_threshold(motor_id as u8);
    if current_threshold > 0 {
        if target.current >= current_threshold {
            // Current is high - determine which direction caused it if not already known
            if protection_state.blocked_direction.is_none()
                && protection_state.previous_position != target.present_position
            {
                let movement_direction =
                    if target.present_position > protection_state.previous_position {
                        MovementDirection::Positive
                    } else {
                        MovementDirection::Negative
                    };

                protection_state.blocked_direction = Some(movement_direction);
                log::warn!(
                    "Motor {} on bus {} current {} exceeds threshold {}, blocking {:?} direction",
                    motor_id,
                    target_bus_id,
                    target.current,
                    current_threshold,
                    movement_direction
                );
            }

            // Hold current position when current is high
            if target.target_position.abs_diff(target.present_position) > config.deadband {
                let goal_cmd = Command {
                    target_bus_id: target_bus_id.to_string(),
                    motor_id: motor_id as u32,
                    command: MotorCommand::Goal(target.present_position),
                };
                commands.push(goal_cmd);
            }
            return;
        } else {
            // Current is normal - only clear blocked direction if leader is commanding opposite movement
            if let Some(blocked_dir) = protection_state.blocked_direction {
                if let Some(leader_dir) = leader_direction {
                    if leader_dir != blocked_dir {
                        // Leader wants to move in opposite direction - safe to clear protection
                        log::info!(
                            "Motor {} on bus {} current {} back to normal and leader commanding opposite direction, clearing protection",
                            motor_id,
                            target_bus_id,
                            target.current
                        );
                        protection_state.blocked_direction = None;
                    } else {
                        // Leader still wants to move in blocked direction - keep protection active
                        log::warn!(
                            "Motor {} on bus {} current normal but leader still commanding blocked {:?} direction, maintaining protection",
                            motor_id,
                            target_bus_id,
                            blocked_dir
                        );
                    }
                }
            }
        }
    }

    // Check if intended movement is in blocked direction
    if let Some(blocked_dir) = protection_state.blocked_direction {
        if let Some(intended_direction) = leader_direction {
            if intended_direction == blocked_dir {
                log::warn!(
                    "Motor {} on bus {} blocking {:?} movement (would increase current)",
                    motor_id,
                    target_bus_id,
                    blocked_dir
                );
                protection_state.previous_position = target.present_position;
                return;
            } else {
                log::info!(
                    "Motor {} on bus {} allowing {:?} movement (opposite to blocked {:?}, may relieve current)",
                    motor_id,
                    target_bus_id,
                    intended_direction,
                    blocked_dir
                );
            }
        } else {
            // No movement needed
            protection_state.previous_position = target.present_position;
            return;
        }
    }

    let distance = calculate_shortest_distance(target.present_position, goal_position, config);

    if distance <= config.deadband {
        return;
    }
    if target.target_position.abs_diff(goal_position) <= config.deadband {
        return;
    }

    get_speed_and_accel_by_distance(target_bus_id, motor_id, distance, target, config, commands);

    let goal_cmd = Command {
        target_bus_id: target_bus_id.to_string(),
        motor_id: motor_id as u32,
        command: MotorCommand::Goal(goal_position),
    };

    commands.push(goal_cmd);

    // Update previous position for next iteration's direction tracking
    let protection_key = (target_bus_id.to_string(), motor_id as u8);
    if let Some(protection_state) = protection_states.get_mut(&protection_key) {
        protection_state.previous_position = target.present_position;
    }
}

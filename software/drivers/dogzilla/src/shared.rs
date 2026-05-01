use crate::dogzilla_proto::{
    Command, DogzillaDevice, DogzillaSignalType, DogzillaStatus, ImuOrientation, RxEnvelope,
    servo_speed_command,
};
use crate::protocol;
use crate::state::DogzillaCommunicator;
use log::warn;
use systime;

pub(crate) const SERVO_COUNT: usize = 15;
pub(crate) const DEFAULT_SERVO_POSITIONS: [u32; SERVO_COUNT] = [
    128, 200, 110, 128, 200, 110, 128, 200, 110, 128, 200, 110, 0, 255, 0,
];

#[derive(Debug, Clone)]
pub(crate) struct ServoWrite {
    pub servo_id: u32,
    pub register: u8,
    pub position: u8,
    pub index: usize,
}

#[derive(Debug, Default)]
pub(crate) struct CommandEffect {
    pub servo_writes: Vec<ServoWrite>,
    pub leg_servo_speed: Option<u32>,
    pub arm_servo_speed: Option<u32>,
}

/// Maps a servo ID (11-13, 21-23, 31-33, 41-43, 51-53) to its register address
fn servo_id_to_register(servo_id: u32) -> Option<u8> {
    match servo_id {
        // Leg 1 (Front Right)
        11 => Some(protocol::REG_SERVO_11),
        12 => Some(protocol::REG_SERVO_12),
        13 => Some(protocol::REG_SERVO_13),
        // Leg 2 (Front Left)
        21 => Some(protocol::REG_SERVO_21),
        22 => Some(protocol::REG_SERVO_22),
        23 => Some(protocol::REG_SERVO_23),
        // Leg 3 (Rear Left)
        31 => Some(protocol::REG_SERVO_31),
        32 => Some(protocol::REG_SERVO_32),
        33 => Some(protocol::REG_SERVO_33),
        // Leg 4 (Rear Right)
        41 => Some(protocol::REG_SERVO_41),
        42 => Some(protocol::REG_SERVO_42),
        43 => Some(protocol::REG_SERVO_43),
        // Arm servos
        51 => Some(protocol::REG_GRIPPER_STATUS), // Gripper
        52 => Some(protocol::REG_SERVO_ARM_52),   // Shoulder
        53 => Some(protocol::REG_SERVO_ARM_53),   // Base
        _ => None,
    }
}

fn servo_id_to_index(servo_id: u32) -> Option<usize> {
    match servo_id {
        11 => Some(0),
        12 => Some(1),
        13 => Some(2),
        21 => Some(3),
        22 => Some(4),
        23 => Some(5),
        31 => Some(6),
        32 => Some(7),
        33 => Some(8),
        41 => Some(9),
        42 => Some(10),
        43 => Some(11),
        51 => Some(12),
        52 => Some(13),
        53 => Some(14),
        _ => None,
    }
}

pub(crate) fn compute_command_effect(command: &Command) -> CommandEffect {
    let mut effect = CommandEffect::default();

    if let Some(servo) = &command.servo {
        let position = servo.position.clamp(0, 255) as u8;
        match (
            servo_id_to_register(servo.servo_id),
            servo_id_to_index(servo.servo_id),
        ) {
            (Some(register), Some(index)) => {
                effect.servo_writes.push(ServoWrite {
                    servo_id: servo.servo_id,
                    register,
                    position,
                    index,
                });
            }
            _ => warn!("Unknown servo ID: {}", servo.servo_id),
        }
    }

    if let Some(speed) = &command.servo_speed {
        if let Some(body_speed) = speed.body_speed.as_ref() {
            if let servo_speed_command::BodySpeed::BodyServoSpeed(body_speed_val) = body_speed {
                effect.leg_servo_speed = Some((*body_speed_val).clamp(0, 255) as u32);
            }
        }
        if let Some(arm_speed) = speed.arm_speed.as_ref() {
            if let servo_speed_command::ArmSpeed::ArmServoSpeed(arm_speed_val) = arm_speed {
                effect.arm_servo_speed = Some((*arm_speed_val).clamp(0, 255) as u32);
            }
        }
    }

    effect
}

pub(crate) fn build_status(
    device_info: &DogzillaDevice,
    servo_positions: Vec<u32>,
    leg_servo_speed: u32,
    arm_servo_speed: u32,
    battery_level: u32,
    orientation: ImuOrientation,
) -> DogzillaStatus {
    let servo_angles: Vec<f32> = servo_positions
        .iter()
        .enumerate()
        .map(|(i, &raw)| {
            let limit = protocol::get_servo_limit_lite(i);
            let raw_u8 = raw.min(255) as u8;
            protocol::servo_position_to_angle(raw_u8, limit)
        })
        .collect();

    DogzillaStatus {
        battery_level,
        model: device_info.model,
        firmware_version: device_info.firmware_version.clone(),
        servo_positions,
        servo_angles,
        leg_servo_speed,
        arm_servo_speed,
        orientation: Some(orientation),
        acceleration: None,
    }
}

pub(crate) fn send_status_update(
    comm: &DogzillaCommunicator,
    device_info: &DogzillaDevice,
    status: DogzillaStatus,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: DogzillaSignalType::DogzillaStatusUpdate as i32,
        device: Some(device_info.clone()),
        status: Some(status),
        ..Default::default()
    };

    if let Err(e) = comm.send_rx(&envelope) {
        warn!("Failed to send status: {}", e);
    }
}

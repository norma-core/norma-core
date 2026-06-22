use crate::yahboom_dogzilla_lite_proto::{
    Command, YahboomDogzillaLiteDevice, YahboomDogzillaLiteSignalType, YahboomDogzillaLiteStatus, ImuOrientation, RxEnvelope,
    TxEnvelope, servo_speed_command,
};
use crate::protocol;
use crate::state::YahboomDogzillaLiteCommunicator;
use log::warn;

pub(crate) const SERVO_COUNT: usize = 15;
pub(crate) const DEFAULT_SERVO_POSITIONS: [u32; SERVO_COUNT] = [
    128, 200, 110, 128, 200, 110, 128, 200, 110, 128, 200, 110, 0, 255, 0,
];

const SERVO_MAP: [(u32, u8, usize); SERVO_COUNT] = [
    (11, protocol::REG_SERVO_11, 0),
    (12, protocol::REG_SERVO_12, 1),
    (13, protocol::REG_SERVO_13, 2),
    (21, protocol::REG_SERVO_21, 3),
    (22, protocol::REG_SERVO_22, 4),
    (23, protocol::REG_SERVO_23, 5),
    (31, protocol::REG_SERVO_31, 6),
    (32, protocol::REG_SERVO_32, 7),
    (33, protocol::REG_SERVO_33, 8),
    (41, protocol::REG_SERVO_41, 9),
    (42, protocol::REG_SERVO_42, 10),
    (43, protocol::REG_SERVO_43, 11),
    (51, protocol::REG_GRIPPER_STATUS, 12),
    (52, protocol::REG_SERVO_ARM_52, 13),
    (53, protocol::REG_SERVO_ARM_53, 14),
];

#[derive(Debug)]
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

pub(crate) fn compute_command_effect(command: &Command) -> CommandEffect {
    let mut effect = CommandEffect::default();

    if let Some(servo) = &command.servo {
        match servo_meta(servo.servo_id) {
            Some((register, index)) => {
                effect.servo_writes.push(ServoWrite {
                    servo_id: servo.servo_id,
                    register,
                    position: command_byte(servo.position),
                    index,
                });
            }
            None => warn!("Unknown servo ID: {}", servo.servo_id),
        }
    }

    if let Some(speed) = &command.servo_speed {
        if let Some(servo_speed_command::BodySpeed::BodyServoSpeed(value)) =
            speed.body_speed.as_ref()
        {
            effect.leg_servo_speed = Some((*value).clamp(0, 255));
        }
        if let Some(servo_speed_command::ArmSpeed::ArmServoSpeed(value)) = speed.arm_speed.as_ref()
        {
            effect.arm_servo_speed = Some((*value).clamp(0, 255));
        }
    }

    effect
}

pub(crate) fn build_status(
    device_info: &YahboomDogzillaLiteDevice,
    servo_positions: Vec<u32>,
    leg_servo_speed: u32,
    arm_servo_speed: u32,
    battery_level: u32,
    orientation: ImuOrientation,
) -> YahboomDogzillaLiteStatus {
    let servo_angles = servo_positions
        .iter()
        .enumerate()
        .map(|(i, &raw)| {
            let limit = protocol::get_servo_limit_lite(i);
            protocol::servo_position_to_angle(command_byte(raw), limit)
        })
        .collect();

    YahboomDogzillaLiteStatus {
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

pub(crate) fn command_byte(value: u32) -> u8 {
    value.min(255) as u8
}

pub(crate) fn target_matches(target_serial: &str, device_serial: &str) -> bool {
    target_serial.is_empty() || target_serial == device_serial
}

pub(crate) fn unsupported_command_message(command: &Command) -> Option<String> {
    let mut fields = Vec::new();
    if command.calibration.is_some() {
        fields.push("calibration");
    }
    if command.arm.is_some() {
        fields.push("arm");
    }
    if command.io.is_some() {
        fields.push("io");
    }
    if command.config.is_some() {
        fields.push("config");
    }
    if command.led.is_some() {
        fields.push("led");
    }

    (!fields.is_empty())
        .then(|| format!("Unsupported YAHBOOM_DOGZILLA_LITE command fields: {}", fields.join(", ")))
}

pub(crate) fn should_report_command_success(command: &Command) -> bool {
    command.action.is_some()
        || command.calibration.is_some()
        || command.arm.is_some()
        || command.io.is_some()
        || command.config.is_some()
        || command.led.is_some()
}

pub(crate) fn send_status_update(
    comm: &YahboomDogzillaLiteCommunicator,
    device_info: &YahboomDogzillaLiteDevice,
    status: YahboomDogzillaLiteStatus,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: YahboomDogzillaLiteSignalType::YahboomDogzillaLiteStatusUpdate as i32,
        device: Some(device_info.clone()),
        status: Some(status),
        ..Default::default()
    };

    if let Err(e) = comm.send_rx(&envelope) {
        warn!("Failed to send status: {}", e);
    }
}

pub(crate) fn send_command_result(
    comm: &YahboomDogzillaLiteCommunicator,
    device_info: &YahboomDogzillaLiteDevice,
    command: &TxEnvelope,
    signal_type: YahboomDogzillaLiteSignalType,
    error_message: Option<String>,
) {
    let envelope = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        device: Some(device_info.clone()),
        command: Some(command.clone()),
        error_message: error_message.unwrap_or_default(),
        ..Default::default()
    };

    if let Err(e) = comm.send_rx(&envelope) {
        warn!("Failed to send command result: {}", e);
    }
}

fn servo_meta(servo_id: u32) -> Option<(u8, usize)> {
    SERVO_MAP
        .iter()
        .find_map(|&(id, register, index)| (id == servo_id).then_some((register, index)))
}

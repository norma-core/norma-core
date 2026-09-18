use std::sync::Arc;

use bytes::Bytes;

use super::state::ST3215BusCommunicator;
use crate::protocol;
use crate::st3215_proto::{RxEnvelope, St3215Bus, St3215Error, St3215SignalType, st3215_error};

pub fn convert_error(error: &protocol::Error) -> St3215Error {
    match error {
        protocol::Error::Io {
            error: io_err,
            source_packet,
        } => St3215Error {
            kind: st3215_error::St3215ErrorKind::SekIo as i32,
            command_packet: source_packet.clone(),
            response_packet: Bytes::new(),
            description: io_err.to_string(),
            servo: vec![],
        },
        protocol::Error::InvalidHeader {
            header,
            source_packet,
            reply_packet,
        } => St3215Error {
            kind: st3215_error::St3215ErrorKind::SekInvalidHeader as i32,
            command_packet: source_packet.clone(),
            response_packet: reply_packet.clone(),
            description: format!("Invalid header: {:?}", header),
            servo: vec![],
        },
        protocol::Error::ChecksumError {
            source_packet,
            reply_packet,
        } => St3215Error {
            kind: st3215_error::St3215ErrorKind::SekInvalidChecksum as i32,
            command_packet: source_packet.clone(),
            response_packet: reply_packet.clone(),
            description: "Checksum error".to_string(),
            servo: vec![],
        },
        protocol::Error::Servo {
            errors,
            source_packet,
            response_data,
            ..
        } => {
            let servo_errors: Vec<i32> = errors
                .iter()
                .map(|e| match e {
                    protocol::ServoError::Instruction => {
                        st3215_error::ServoErrorType::SetInstruction as i32
                    }
                    protocol::ServoError::Overload => {
                        st3215_error::ServoErrorType::SetOverload as i32
                    }
                    protocol::ServoError::Checksum => {
                        st3215_error::ServoErrorType::SetChecksum as i32
                    }
                    protocol::ServoError::Range => st3215_error::ServoErrorType::SetRange as i32,
                    protocol::ServoError::Overheat => {
                        st3215_error::ServoErrorType::SetOverheat as i32
                    }
                    protocol::ServoError::AngleLimit => {
                        st3215_error::ServoErrorType::SetAngleLimit as i32
                    }
                    protocol::ServoError::Voltage => {
                        st3215_error::ServoErrorType::SetVoltage as i32
                    }
                })
                .collect();

            St3215Error {
                kind: st3215_error::St3215ErrorKind::SekServoError as i32,
                command_packet: source_packet.clone(),
                response_packet: response_data.clone(),
                description: format!("Servo errors: {:?}", errors),
                servo: servo_errors,
            }
        }
        protocol::Error::MotorIdMismatch {
            expected,
            got,
            source_packet,
            reply_packet,
        } => St3215Error {
            kind: st3215_error::St3215ErrorKind::SekMotorIdError as i32,
            command_packet: source_packet.clone(),
            response_packet: reply_packet.clone(),
            description: format!("Motor ID mismatch: expected {}, got {}", expected, got),
            servo: vec![],
        },
        protocol::Error::InvalidData {
            msg,
            source_packet,
            reply_packet,
        } => St3215Error {
            kind: st3215_error::St3215ErrorKind::SekInvalidData as i32,
            command_packet: source_packet.clone(),
            response_packet: reply_packet.clone(),
            description: format!("Invalid data: {}", msg),
            servo: vec![],
        },
        protocol::Error::Timeout {
            source_packet,
            reply_packet,
        } => St3215Error {
            kind: st3215_error::St3215ErrorKind::SekTimeout as i32,
            command_packet: source_packet.clone(),
            response_packet: reply_packet.clone(),
            description: "Response timeout".to_string(),
            servo: vec![],
        },
    }
}

pub async fn enqueue_error(
    com: &Arc<ST3215BusCommunicator>,
    bus: &St3215Bus,
    servo_id: u16,
    error: &protocol::Error,
) {
    // Convert the error using the convert_error function
    let converted_error = convert_error(error);

    // Extract data from Servo error variant if present
    let data = match error {
        protocol::Error::Servo { data, .. } => data.clone(),
        _ => Bytes::new(),
    };

    let err = RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: St3215SignalType::St3215Error as i32,
        bus: Some(bus.clone()),
        motor_id: servo_id as u32,

        data,
        command: None,

        error: Some(converted_error),
    };

    if let Err(e) = com.send_rx(&err).await {
        log::error!("Failed to enqueue ST3215 error: {}", e);
    }
}

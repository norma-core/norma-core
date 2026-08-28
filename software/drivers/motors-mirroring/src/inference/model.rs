use std::{collections::HashMap, sync::Arc};

use bytes::Bytes;
use log::warn;
use prost::Message;
use st3215::protocol::{RamRegister, get_motor_position, get_motor_goal_position, get_motor_current};

use crate::{proto::mirroring, types::BusKey};

#[derive(Default)]
pub struct State {
    pub from_to: HashMap<BusKey, Vec<BusKey>>,
    pub to_from: HashMap<BusKey, BusKey>,
}

#[derive(Default)]
pub struct BusState {
    pub motors: HashMap<u8, MotorState>,
    pub monotonic_stamp_ns: u64, // Timestamp when this bus data was published
}

#[derive(Default)]
pub struct MotorState {
    pub present_position: u16,
    pub target_position: u16,
    pub range_min: u16,
    pub range_max: u16,
    pub range_freezed: bool,
    pub error: bool,
    pub error_status: u8,
    pub current: u16,
    pub current_limit: u16,
    /// Present temperature in degrees Celsius (`RamRegister::PresentTemperature`,
    /// a raw single-byte register - same convention the frontend already
    /// reads directly for display in `motor-parser.ts::getMotorTemperature`).
    pub temperature: u8,

    pub goal_speed: u16,
    pub goal_accel: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MovementDirection {
    Positive,  // Increasing position values
    Negative,  // Decreasing position values
}

#[derive(Clone, Debug, Default)]
pub struct MotorProtectionState {
    pub blocked_direction: Option<MovementDirection>,
    pub previous_position: u16,
}

// Key for protection state: (bus_id, motor_id)
pub type ProtectionKey = (String, u8);

#[derive(Default)]
pub struct StationState {
    pub buses: HashMap<BusKey, BusState>,
    pub id: Bytes,
}

impl StationState {
    pub async fn update_from_st3215_queue(&mut self, normfs: &Arc<normfs::NormFS>) {
        const ST3215_INFERENCE_QUEUE: &str = "st3215/inference";

        // Resolve queue ID
        let queue_id = normfs.resolve(ST3215_INFERENCE_QUEUE);

        // Read the last entry using backward read with offset 1, limit 1
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        let offset = normfs::UintN::from(1u64);
        let read_result = normfs.read(
            &queue_id,
            normfs::ReadPosition::ShiftFromTail(offset),
            1,
            1,
            tx,
        ).await;

        if let Err(e) = read_result {
            log::error!("Failed to read from st3215/inference queue: {:?}", e);
            return;
        }

        // Get the data from the channel
        if let Some(entry) = rx.recv().await {
            // Decode as InferenceState directly
            let inference_state = match st3215::st3215_proto::InferenceState::decode(entry.data.as_ref()) {
                Ok(state) => state,
                Err(e) => {
                    warn!("Failed to decode ST3215 inference state: {}", e);
                    return;
                }
            };

            // Use the entry ID as state_id
            let state_id = entry.id.value_to_bytes();
            self.update_from_st3215_inference_state(&state_id, inference_state);
        }
    }

    fn update_from_st3215_inference_state(&mut self, state_id: &Bytes, inference_state: st3215::st3215_proto::InferenceState) {
        const STATUS_REGISTER: u8 = RamRegister::Status.address();
        const SPEED_REGISTER: u8 = RamRegister::GoalSpeed.address();
        const ACCEL_REGISTER: u8 = RamRegister::Acc.address();
        const TORQUE_REGISTER: u8 = RamRegister::TorqueEnable.address();
        const TEMPERATURE_REGISTER: u8 = RamRegister::PresentTemperature.address();

        self.id = state_id.clone();

        for bus in inference_state.buses {
            let bus_serial = bus.bus.as_ref().map(|b| b.serial_number.clone()).unwrap_or_default();
            if bus_serial.is_empty() {
                continue;
            }

            let bus_key = BusKey {
                bus_id: bus_serial,
                bus_type: mirroring::BusType::MbtSt3215,
            };
            let bus_state = self.buses.entry(bus_key.clone()).or_default();

            // Store the bus timestamp
            bus_state.monotonic_stamp_ns = bus.monotonic_stamp_ns;

            for motor in bus.motors {
                let motor_state = bus_state.motors.entry(motor.id as u8).or_default();

                let state_bytes = &motor.state;

                // Check minimum size for status register
                if state_bytes.len() < STATUS_REGISTER as usize + 1 {
                    continue;
                }

                let status = state_bytes[STATUS_REGISTER as usize];
                motor_state.error = status != 0;
                motor_state.error_status = status;

                // Use helper functions from st3215
                motor_state.present_position = get_motor_position(state_bytes);

                let torque_enabled = state_bytes.len() > TORQUE_REGISTER as usize &&
                                     state_bytes[TORQUE_REGISTER as usize] != 0;
                if torque_enabled {
                    motor_state.target_position = get_motor_goal_position(state_bytes);
                } else {
                    motor_state.target_position = motor_state.present_position;
                }

                motor_state.range_min = motor.range_min as u16;
                motor_state.range_max = motor.range_max as u16;
                motor_state.range_freezed = motor.range_freezed;

                if state_bytes.len() >= SPEED_REGISTER as usize + 2 {
                    motor_state.goal_speed = u16::from_le_bytes([
                        state_bytes[SPEED_REGISTER as usize],
                        state_bytes[SPEED_REGISTER as usize + 1],
                    ]);
                }

                if state_bytes.len() > ACCEL_REGISTER as usize {
                    motor_state.goal_accel = state_bytes[ACCEL_REGISTER as usize];
                }

                motor_state.current = get_motor_current(state_bytes);

                if state_bytes.len() > TEMPERATURE_REGISTER as usize {
                    motor_state.temperature = state_bytes[TEMPERATURE_REGISTER as usize];
                }

                // Current limit is stored in motor metadata, not state bytes
                // Keep existing value or use default
            }
        }
    }
}
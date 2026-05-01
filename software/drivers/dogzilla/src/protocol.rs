use crate::errors::DogzillaError;
use std::fs;

/// Frame format: Header(2) + Length(1) + Command(1) + Address(1) + Data(N) + Checksum(1) + Tail(2)
pub const HEADER_BYTE_1: u8 = 0x55;
pub const HEADER_BYTE_2: u8 = 0x00;
pub const TAIL_BYTE_1: u8 = 0x00;
pub const TAIL_BYTE_2: u8 = 0xAA;
pub const FEEDBACK_PACKET_SIZE: usize = 44;
pub const FEEDBACK_HEADER_BYTE_1: u8 = 0x55;
pub const FEEDBACK_HEADER_BYTE_2: u8 = 0x00;
pub const FEEDBACK_TAIL_BYTE_1: u8 = 0x00;
pub const FEEDBACK_TAIL_BYTE_2: u8 = 0xAA;

pub const BAUD_RATE: u32 = 115200;

// Raspberry Pi built-in UART port
pub const RPI_UART_PORT: &str = "/dev/ttyAMA0";

// Command types
pub const CMD_WRITE: u8 = 0x00;
pub const CMD_READ: u8 = 0x02;

// Register addresses from the command interface table
// Range 0x00-0x13: Basic configuration and control
pub const REG_WORKING_STATUS: u8 = 0x00;
pub const REG_BATTERY_POWER: u8 = 0x01;
pub const REG_XGO_VERSION: u8 = 0x02;
pub const REG_PERFORMANCE_MODE: u8 = 0x03;
pub const REG_CALIBRATION_MODE: u8 = 0x04;
pub const REG_UPDATE_FIRMWARE: u8 = 0x05;
pub const REG_SET_ORIGIN: u8 = 0x06;
pub const REG_FIRMWARE_VERSION: u8 = 0x07;
pub const REG_ENABLE_FEEDBACK: u8 = 0x08;
pub const REG_GAIT: u8 = 0x09;
pub const REG_BLUETOOTH_NAME: u8 = 0x13;
pub const REG_ACTION: u8 = 0x3E;

// Range 0x30-0x32: Movement registers
pub const REG_MOVE_X: u8 = 0x30;
pub const REG_MOVE_Y: u8 = 0x31;
pub const REG_MOVE_YAW: u8 = 0x32;
pub const MOVEMENT_NEUTRAL: u8 = 0x80;

// Range 0x50-0x5F: Servo position registers
pub const REG_SERVO_11: u8 = 0x50;
pub const REG_SERVO_12: u8 = 0x51;
pub const REG_SERVO_13: u8 = 0x52;
pub const REG_SERVO_21: u8 = 0x53;
pub const REG_SERVO_22: u8 = 0x54;
pub const REG_SERVO_23: u8 = 0x55;
pub const REG_SERVO_31: u8 = 0x56;
pub const REG_SERVO_32: u8 = 0x57;
pub const REG_SERVO_33: u8 = 0x58;
pub const REG_SERVO_41: u8 = 0x59;
pub const REG_SERVO_42: u8 = 0x5A;
pub const REG_SERVO_43: u8 = 0x5B;
pub const REG_SERVO_SPEED: u8 = 0x5C;
pub const REG_SERVO_ARM_52: u8 = 0x5D;
pub const REG_SERVO_ARM_53: u8 = 0x5E;
pub const REG_SERVO_CENTERING: u8 = 0x5F;
pub const REG_IMU_STABILIZATION: u8 = 0x61;

// Range 0x71-0x77: Arm/Gripper registers
pub const REG_GRIPPER_STATUS: u8 = 0x71;
pub const REG_ROBOT_STABILITY_MODE: u8 = 0x72;
pub const REG_GRIPPER_X: u8 = 0x73;
pub const REG_GRIPPER_Z: u8 = 0x74;
pub const REG_SERVO_ARM_SPEED: u8 = 0x75;
pub const REG_POLAR_ANGLE: u8 = 0x76;
pub const REG_POLAR_RADIUS: u8 = 0x77;

// Range 0x80-0x83: LED registers
pub const REG_LED_0: u8 = 0x80;
pub const REG_LED_1: u8 = 0x81;
pub const REG_LED_2: u8 = 0x82;
pub const REG_LED_3: u8 = 0x83;

// Range 0x90-0x93: IO registers
pub const REG_POWER_5V: u8 = 0x90;
pub const REG_DIGITAL_IO: u8 = 0x91;
pub const REG_ANALOG_READ: u8 = 0x92;
pub const REG_DIGITAL_READ: u8 = 0x93;

// Servo angle limits for Dogzilla Lite [min, max] in degrees
// Index 0-2: lower/middle/upper servos for each leg (used for servos 11-43 via i % 3)
// Index 3-5: arm servos (used for servos 51-53 via i - 9)
pub const SERVO_LIMIT_LITE: [[f32; 2]; 6] = [
    [-70.0, 50.0],  // Lower servo (x1)
    [-70.0, 90.0],  // Middle servo (x2)
    [-30.0, 30.0],  // Upper servo (x3)
    [-65.0, 65.0],  // Gripper (51)
    [-115.0, 70.0], // Arm shoulder (52)
    [-85.0, 100.0], // Arm base (53)
];

/// Convert raw servo position byte to angle in degrees (rounded to nearest integer)
/// Formula: angle = round(raw_byte / 255.0 * (max - min) + min)
pub fn servo_position_to_angle(raw: u8, limit: [f32; 2]) -> f32 {
    let [min, max] = limit;
    ((raw as f32 / 255.0) * (max - min) + min).round()
}

/// Get servo limit for a given servo index (0-14)
/// For leg servos (0-11): uses index % 3 to get lower/middle/upper limit
/// For arm servos (12-14): uses index - 9 to get arm limits (indices 3-5)
pub fn get_servo_limit_lite(index: usize) -> [f32; 2] {
    if index < 12 {
        SERVO_LIMIT_LITE[index % 3]
    } else {
        SERVO_LIMIT_LITE[index - 9]
    }
}

#[derive(Debug, Clone)]
pub struct FeedbackPacket {
    pub battery: u8,
    pub servo_positions: [u8; 15],
    pub pitch: f32,
    pub roll: f32,
    pub yaw: f32,
    pub accel_x: f32,
    pub accel_y: f32,
    pub accel_z: f32,
}

impl FeedbackPacket {
    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.len() != FEEDBACK_PACKET_SIZE {
            return None;
        }

        if data[0] != FEEDBACK_HEADER_BYTE_1 || data[1] != FEEDBACK_HEADER_BYTE_2 {
            return None;
        }

        if data[FEEDBACK_PACKET_SIZE - 2] != FEEDBACK_TAIL_BYTE_1
            || data[FEEDBACK_PACKET_SIZE - 1] != FEEDBACK_TAIL_BYTE_2
        {
            return None;
        }

        let servo_positions: [u8; 15] = data[3..18].try_into().ok()?;
        // Feedback protocol encodes roll before pitch.
        let roll = f32::from_le_bytes(data[18..22].try_into().ok()?);
        let pitch = f32::from_le_bytes(data[22..26].try_into().ok()?);
        let yaw = f32::from_le_bytes(data[26..30].try_into().ok()?);
        let accel_x = f32::from_le_bytes(data[30..34].try_into().ok()?);
        let accel_y = f32::from_le_bytes(data[34..38].try_into().ok()?);
        let accel_z = f32::from_le_bytes(data[38..42].try_into().ok()?);

        Some(Self {
            battery: data[2],
            servo_positions,
            pitch,
            roll,
            yaw,
            accel_x,
            accel_y,
            accel_z,
        })
    }
}

/// Represents a DOGZILLA command frame
#[derive(Debug, Clone)]
pub struct Frame {
    pub command: u8,
    pub address: u8,
    pub data: Vec<u8>,
}

impl Frame {
    /// Create a new write frame
    pub fn write(address: u8, data: Vec<u8>) -> Self {
        Frame {
            command: CMD_WRITE,
            address,
            data,
        }
    }

    /// Create a new read frame
    pub fn read(address: u8, read_length: u8) -> Self {
        Frame {
            command: CMD_READ,
            address,
            data: vec![read_length],
        }
    }

    /// Encode the frame into bytes
    pub fn encode(&self) -> Vec<u8> {
        let length = (self.data.len() + 8) as u8;

        // checksum = 255 - ((length + mode + address + sum(data)) % 256)
        let sum = (length as u16)
            + (self.command as u16)
            + (self.address as u16)
            + self.data.iter().map(|&b| b as u16).sum::<u16>();
        let checksum = (255u16.wrapping_sub(sum % 256)) as u8;

        let mut frame = Vec::new();
        frame.push(HEADER_BYTE_1); // 0x55
        frame.push(HEADER_BYTE_2); // 0x00
        frame.push(length);
        frame.push(self.command);
        frame.push(self.address);
        frame.extend_from_slice(&self.data);
        frame.push(checksum);
        frame.push(TAIL_BYTE_1); // 0x00
        frame.push(TAIL_BYTE_2); // 0xAA

        frame
    }

    /// Decode a frame from bytes, scanning for header
    pub fn decode(bytes: &[u8]) -> Result<Self, DogzillaError> {
        // Find header position
        let start = bytes
            .windows(2)
            .position(|w| w[0] == HEADER_BYTE_1 && w[1] == HEADER_BYTE_2)
            .ok_or(DogzillaError::InvalidHeader)?;

        let bytes = &bytes[start..];

        if bytes.len() < 9 {
            return Err(DogzillaError::InvalidFrame);
        }

        let length = bytes[2] as usize;
        if bytes.len() < length {
            return Err(DogzillaError::InvalidFrame);
        }

        // Check tail
        if bytes[length - 2] != TAIL_BYTE_1 || bytes[length - 1] != TAIL_BYTE_2 {
            return Err(DogzillaError::InvalidFrame);
        }

        let command = bytes[3];
        let address = bytes[4];
        let data = bytes[5..length - 3].to_vec();

        // Verify checksum: 255 - ((length + mode + address + sum(data)) % 256)
        let sum = (length as u16)
            + (command as u16)
            + (address as u16)
            + data.iter().map(|&b| b as u16).sum::<u16>();
        let expected_checksum = (255u16.wrapping_sub(sum % 256)) as u8;

        if expected_checksum != bytes[length - 3] {
            return Err(DogzillaError::InvalidChecksum);
        }

        Ok(Frame {
            command,
            address,
            data,
        })
    }
}

/// Read Raspberry Pi CPU Serial from /proc/cpuinfo
/// Returns the serial number or None if not available (e.g., not running on RPi)
pub fn read_rpi_cpu_serial() -> Option<String> {
    let cpuinfo = fs::read_to_string("/proc/cpuinfo").ok()?;
    for line in cpuinfo.lines() {
        if line.starts_with("Serial") {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() == 2 {
                return Some(parts[1].trim().to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frame_encode_decode() {
        let frame = Frame::write(REG_BATTERY_POWER, vec![0x64]);
        let encoded = frame.encode();
        let decoded = Frame::decode(&encoded).unwrap();

        assert_eq!(decoded.command, CMD_WRITE);
        assert_eq!(decoded.address, REG_BATTERY_POWER);
        assert_eq!(decoded.data, vec![0x64]);
    }

    #[test]
    fn test_read_frame() {
        let frame = Frame::read(REG_BATTERY_POWER, 1);
        let encoded = frame.encode();

        assert_eq!(encoded[0], HEADER_BYTE_1);
        assert_eq!(encoded[1], HEADER_BYTE_2);
        assert_eq!(encoded[3], CMD_READ);
        assert_eq!(encoded[4], REG_BATTERY_POWER);
    }
}

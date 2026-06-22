use crate::errors::YahboomDogzillaLiteError;

pub(crate) const PACKET_HEADER: [u8; 2] = [0x55, 0x00];
pub(crate) const PACKET_TAIL: [u8; 2] = [0x00, 0xAA];
pub(crate) const FEEDBACK_PACKET_SIZE: usize = 44;
pub(crate) const BAUD_RATE: u32 = 115200;
pub(crate) const RPI_UART_PORT: &str = "/dev/ttyAMA0";

const CMD_WRITE: u8 = 0x00;
const CMD_READ: u8 = 0x02;

pub(crate) const REG_FIRMWARE_VERSION: u8 = 0x07;
pub(crate) const REG_ENABLE_FEEDBACK: u8 = 0x08;
pub(crate) const REG_ACTION: u8 = 0x3E;
pub(crate) const REG_MOVE_X: u8 = 0x30;
pub(crate) const REG_MOVE_Y: u8 = 0x31;
pub(crate) const REG_MOVE_YAW: u8 = 0x32;
pub(crate) const REG_SERVO_11: u8 = 0x50;
pub(crate) const REG_SERVO_12: u8 = 0x51;
pub(crate) const REG_SERVO_13: u8 = 0x52;
pub(crate) const REG_SERVO_21: u8 = 0x53;
pub(crate) const REG_SERVO_22: u8 = 0x54;
pub(crate) const REG_SERVO_23: u8 = 0x55;
pub(crate) const REG_SERVO_31: u8 = 0x56;
pub(crate) const REG_SERVO_32: u8 = 0x57;
pub(crate) const REG_SERVO_33: u8 = 0x58;
pub(crate) const REG_SERVO_41: u8 = 0x59;
pub(crate) const REG_SERVO_42: u8 = 0x5A;
pub(crate) const REG_SERVO_43: u8 = 0x5B;
pub(crate) const REG_SERVO_SPEED: u8 = 0x5C;
pub(crate) const REG_SERVO_ARM_52: u8 = 0x5D;
pub(crate) const REG_SERVO_ARM_53: u8 = 0x5E;
pub(crate) const REG_IMU_STABILIZATION: u8 = 0x61;
pub(crate) const REG_GRIPPER_STATUS: u8 = 0x71;
pub(crate) const REG_SERVO_ARM_SPEED: u8 = 0x75;

const SERVO_LIMIT_LITE: [[f32; 2]; 6] = [
    [-70.0, 50.0],
    [-70.0, 90.0],
    [-30.0, 30.0],
    [-65.0, 65.0],
    [-115.0, 70.0],
    [-85.0, 100.0],
];

pub(crate) fn servo_position_to_angle(raw: u8, limit: [f32; 2]) -> f32 {
    let [min, max] = limit;
    ((raw as f32 / 255.0) * (max - min) + min).round()
}

pub(crate) fn get_servo_limit_lite(index: usize) -> [f32; 2] {
    if index < 12 {
        SERVO_LIMIT_LITE[index % 3]
    } else {
        SERVO_LIMIT_LITE[index - 9]
    }
}

#[derive(Debug, Clone)]
pub(crate) struct FeedbackPacket {
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
    pub(crate) fn parse(data: &[u8]) -> Option<Self> {
        if data.len() != FEEDBACK_PACKET_SIZE {
            return None;
        }

        if data[..2] != PACKET_HEADER || data[FEEDBACK_PACKET_SIZE - 2..] != PACKET_TAIL {
            return None;
        }

        let servo_positions = data[3..18].try_into().ok()?;
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

#[derive(Debug, Clone)]
pub(crate) struct Frame {
    pub command: u8,
    pub address: u8,
    pub data: Vec<u8>,
}

impl Frame {
    pub(crate) fn write(address: u8, data: Vec<u8>) -> Self {
        Self {
            command: CMD_WRITE,
            address,
            data,
        }
    }

    pub(crate) fn read(address: u8, read_length: u8) -> Self {
        Self {
            command: CMD_READ,
            address,
            data: vec![read_length],
        }
    }

    pub(crate) fn encode(&self) -> Vec<u8> {
        let length = (self.data.len() + 8) as u8;
        let checksum = checksum(length, self.command, self.address, &self.data);
        let mut frame = Vec::with_capacity(length as usize);

        frame.extend_from_slice(&PACKET_HEADER);
        frame.extend_from_slice(&[length, self.command, self.address]);
        frame.extend_from_slice(&self.data);
        frame.push(checksum);
        frame.extend_from_slice(&PACKET_TAIL);

        frame
    }

    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, YahboomDogzillaLiteError> {
        let start = bytes
            .windows(2)
            .position(|window| window == PACKET_HEADER)
            .ok_or(YahboomDogzillaLiteError::InvalidHeader)?;
        let bytes = &bytes[start..];

        if bytes.len() < 9 {
            return Err(YahboomDogzillaLiteError::InvalidFrame);
        }

        let length = bytes[2] as usize;
        if length < 8 || bytes.len() < length {
            return Err(YahboomDogzillaLiteError::InvalidFrame);
        }

        if bytes[length - 2..length] != PACKET_TAIL {
            return Err(YahboomDogzillaLiteError::InvalidFrame);
        }

        let command = bytes[3];
        let address = bytes[4];
        let data = bytes[5..length - 3].to_vec();
        let expected_checksum = checksum(length as u8, command, address, &data);

        if expected_checksum != bytes[length - 3] {
            return Err(YahboomDogzillaLiteError::InvalidChecksum);
        }

        Ok(Self {
            command,
            address,
            data,
        })
    }
}

fn checksum(length: u8, command: u8, address: u8, data: &[u8]) -> u8 {
    let sum = (length as u16)
        + (command as u16)
        + (address as u16)
        + data.iter().map(|&byte| byte as u16).sum::<u16>();
    (255u16.wrapping_sub(sum % 256)) as u8
}

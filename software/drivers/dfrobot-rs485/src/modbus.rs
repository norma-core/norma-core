use bytes::Bytes;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_serial::SerialStream;

pub const FUNCTION_READ_HOLDING: u8 = 0x03;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModbusError {
    Timeout,
    Io(String),
    CrcMismatch,
    BadEcho,
    Exception(u8),
}

impl std::fmt::Display for ModbusError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModbusError::Timeout => write!(f, "timeout waiting for response"),
            ModbusError::Io(error) => write!(f, "serial i/o error: {error}"),
            ModbusError::CrcMismatch => write!(f, "CRC mismatch in response"),
            ModbusError::BadEcho => write!(f, "malformed response header"),
            ModbusError::Exception(code) => write!(f, "modbus exception 0x{code:02x}"),
        }
    }
}

impl std::error::Error for ModbusError {}

pub fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= byte as u16;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    crc
}

pub fn build_read_request(id: u8, start: u16, count: u16) -> [u8; 8] {
    let mut frame = [
        id,
        FUNCTION_READ_HOLDING,
        (start >> 8) as u8,
        (start & 0xFF) as u8,
        (count >> 8) as u8,
        (count & 0xFF) as u8,
        0,
        0,
    ];
    let crc = crc16(&frame[..6]);
    frame[6] = (crc & 0xFF) as u8;
    frame[7] = (crc >> 8) as u8;
    frame
}

/// Validates a complete response frame and returns the register payload
/// (2 * count bytes, big-endian words, exactly as on the wire).
pub fn parse_read_response(id: u8, count: u16, response: &[u8]) -> Result<Bytes, ModbusError> {
    if response.len() >= 5 && response[0] == id && response[1] == (FUNCTION_READ_HOLDING | 0x80) {
        check_crc(&response[..5])?;
        return Err(ModbusError::Exception(response[2]));
    }

    let expected_len = 5 + 2 * count as usize;
    if response.len() != expected_len
        || response[0] != id
        || response[1] != FUNCTION_READ_HOLDING
        || response[2] as usize != 2 * count as usize
    {
        return Err(ModbusError::BadEcho);
    }
    check_crc(response)?;

    Ok(Bytes::copy_from_slice(&response[3..3 + 2 * count as usize]))
}

fn check_crc(frame: &[u8]) -> Result<(), ModbusError> {
    let body_len = frame.len() - 2;
    let expected = crc16(&frame[..body_len]);
    let received = frame[body_len] as u16 | ((frame[body_len + 1] as u16) << 8);
    if expected != received {
        return Err(ModbusError::CrcMismatch);
    }
    Ok(())
}

/// One half-duplex transaction: flush stale input, write the request,
/// read the exact expected response length (or an exception frame),
/// validate, return the payload.
pub async fn transact(
    port: &mut SerialStream,
    id: u8,
    start: u16,
    count: u16,
    timeout: Duration,
) -> Result<Bytes, ModbusError> {
    use tokio_serial::SerialPort;

    // Cheap adapters leave garbage in the input buffer; drop it before we send.
    let _ = port.clear(tokio_serial::ClearBuffer::Input);

    let request = build_read_request(id, start, count);

    let expected_len = 5 + 2 * count as usize;
    let mut response = vec![0u8; expected_len];
    let mut filled = 0usize;

    let result = tokio::time::timeout(timeout, async {
        port.write_all(&request)
            .await
            .map_err(|error| ModbusError::Io(error.to_string()))?;
        port.flush()
            .await
            .map_err(|error| ModbusError::Io(error.to_string()))?;

        // Read the 3-byte header first so an exception frame (5 bytes total)
        // doesn't stall waiting for a full-length response that never comes.
        while filled < 3 {
            let n = port
                .read(&mut response[filled..])
                .await
                .map_err(|error| ModbusError::Io(error.to_string()))?;
            if n == 0 {
                return Err(ModbusError::Io("port closed".to_string()));
            }
            filled += n;
        }
        let total = if response[1] & 0x80 != 0 {
            5
        } else {
            expected_len
        };
        while filled < total {
            let n = port
                .read(&mut response[filled..total])
                .await
                .map_err(|error| ModbusError::Io(error.to_string()))?;
            if n == 0 {
                return Err(ModbusError::Io("port closed".to_string()));
            }
            filled += n;
        }
        Ok(total)
    })
    .await;

    let total = match result {
        Ok(Ok(total)) => total,
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err(ModbusError::Timeout),
    };

    parse_read_response(id, count, &response[..total])
}

#[cfg(test)]
mod tests {
    use super::*;

    // Known-good frames from the DFRobot reference docs
    // (~/projects/study/tmp/dfrobot/dfrobot-rs485-sensors.md):
    //   read 1 reg @0x0000 from id 1:  01 03 00 00 00 01 84 0A
    //   read 2 regs @0x0002 from id 1: 01 03 00 02 00 02 65 CB
    //   read 1 reg @0x0001 from id 1:  01 03 00 01 00 01 D5 CA

    #[test]
    fn crc16_matches_known_frames() {
        assert_eq!(crc16(&[0x01, 0x03, 0x00, 0x00, 0x00, 0x01]), 0x0A84);
        assert_eq!(crc16(&[0x01, 0x03, 0x00, 0x02, 0x00, 0x02]), 0xCB65);
        assert_eq!(crc16(&[0x01, 0x03, 0x00, 0x01, 0x00, 0x01]), 0xCAD5);
    }

    #[test]
    fn builds_known_good_requests() {
        assert_eq!(
            build_read_request(1, 0x0000, 1),
            [0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0A]
        );
        assert_eq!(
            build_read_request(1, 0x0002, 2),
            [0x01, 0x03, 0x00, 0x02, 0x00, 0x02, 0x65, 0xCB]
        );
    }

    fn valid_response(id: u8, data: &[u8]) -> Vec<u8> {
        let mut frame = vec![id, 0x03, data.len() as u8];
        frame.extend_from_slice(data);
        let crc = crc16(&frame);
        frame.push((crc & 0xFF) as u8);
        frame.push((crc >> 8) as u8);
        frame
    }

    #[test]
    fn parses_valid_response() {
        let frame = valid_response(1, &[0x00, 0x08]);
        let payload = parse_read_response(1, 1, &frame).unwrap();
        assert_eq!(payload.as_ref(), &[0x00, 0x08]);
    }

    #[test]
    fn rejects_bad_crc() {
        let mut frame = valid_response(1, &[0x00, 0x08]);
        let last = frame.len() - 1;
        frame[last] ^= 0xFF;
        assert!(matches!(
            parse_read_response(1, 1, &frame),
            Err(ModbusError::CrcMismatch)
        ));
    }

    #[test]
    fn rejects_wrong_slave_id_echo() {
        let frame = valid_response(2, &[0x00, 0x08]);
        assert!(matches!(
            parse_read_response(1, 1, &frame),
            Err(ModbusError::BadEcho)
        ));
    }

    #[test]
    fn rejects_short_frame() {
        let frame = valid_response(1, &[0x00, 0x08]);
        assert!(matches!(
            parse_read_response(1, 1, &frame[..4]),
            Err(ModbusError::BadEcho)
        ));
    }

    #[test]
    fn surfaces_modbus_exception() {
        // Exception frame: id, fc|0x80, exception code, crc
        let mut frame = vec![0x01, 0x83, 0x02];
        let crc = crc16(&frame);
        frame.push((crc & 0xFF) as u8);
        frame.push((crc >> 8) as u8);
        assert!(matches!(
            parse_read_response(1, 1, &frame),
            Err(ModbusError::Exception(0x02))
        ));
    }
}

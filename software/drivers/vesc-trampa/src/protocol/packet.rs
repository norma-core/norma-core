use bytes::{BufMut, Bytes, BytesMut};
use std::fmt;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const SHORT_PACKET_START: u8 = 2;
pub const LONG_PACKET_START: u8 = 3;
pub const EXTENDED_PACKET_START: u8 = 4;
pub const PACKET_END: u8 = 3;

pub const SHORT_PAYLOAD_MAX_LEN: usize = u8::MAX as usize;
pub const LONG_PAYLOAD_MAX_LEN: usize = u16::MAX as usize;
pub const EXTENDED_PAYLOAD_MAX_LEN: usize = 0xFF_FFFF;

pub const MAX_PAYLOAD_LEN: usize = EXTENDED_PAYLOAD_MAX_LEN;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PacketError {
    Timeout,
    PayloadTooLarge {
        len: usize,
        max_len: usize,
    },
    InvalidStartByte {
        byte: u8,
    },
    InvalidEndByte {
        byte: u8,
    },
    IncompleteFrame {
        expected_len: usize,
        actual_len: usize,
    },
    InvalidFrameLength {
        expected_len: usize,
        actual_len: usize,
    },
    InvalidPayloadLength {
        len: usize,
        max_len: usize,
    },
    InvalidChecksum {
        expected: u16,
        actual: u16,
    },
}

impl fmt::Display for PacketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Timeout => write!(f, "VESC packet operation timed out"),
            Self::PayloadTooLarge { len, max_len } => {
                write!(
                    f,
                    "VESC payload is too large: {len} bytes > {max_len} bytes"
                )
            }
            Self::InvalidStartByte { byte } => {
                write!(f, "invalid VESC packet start byte: {byte:#04x}")
            }
            Self::InvalidEndByte { byte } => {
                write!(f, "invalid VESC packet end byte: {byte:#04x}")
            }
            Self::IncompleteFrame {
                expected_len,
                actual_len,
            } => write!(
                f,
                "incomplete VESC packet frame: expected {expected_len} bytes, got {actual_len}"
            ),
            Self::InvalidFrameLength {
                expected_len,
                actual_len,
            } => write!(
                f,
                "invalid VESC packet frame length: expected {expected_len} bytes, got {actual_len}"
            ),
            Self::InvalidPayloadLength { len, max_len } => {
                write!(
                    f,
                    "invalid VESC payload length: {len} bytes > {max_len} bytes"
                )
            }
            Self::InvalidChecksum { expected, actual } => write!(
                f,
                "invalid VESC packet checksum: expected {expected:#06x}, got {actual:#06x}"
            ),
        }
    }
}

impl std::error::Error for PacketError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommPacket {
    pub payload: Bytes,
    start_byte: u8,
    crc: u16,
    end_byte: u8,
}

impl CommPacket {
    pub fn new(payload: Bytes) -> Result<Self, PacketError> {
        if payload.len() > MAX_PAYLOAD_LEN {
            return Err(PacketError::PayloadTooLarge {
                len: payload.len(),
                max_len: MAX_PAYLOAD_LEN,
            });
        }

        let start_byte = start_byte_for_payload_len(payload.len());
        let crc = crc16(payload.as_ref());

        Ok(Self {
            payload,
            start_byte,
            crc,
            end_byte: PACKET_END,
        })
    }

    pub fn len(&self) -> usize {
        self.payload.len()
    }

    pub fn is_empty(&self) -> bool {
        self.payload.is_empty()
    }

    pub fn into_payload(self) -> Bytes {
        self.payload
    }

    pub fn payload(&self) -> &Bytes {
        &self.payload
    }

    pub fn start_byte(&self) -> u8 {
        self.start_byte
    }

    pub fn payload_len(&self) -> usize {
        self.payload.len()
    }

    pub fn command_id(&self) -> Option<u32> {
        self.payload.first().map(|command_id| *command_id as u32)
    }

    pub fn crc(&self) -> u16 {
        self.crc
    }

    pub fn crc16(&self) -> u16 {
        self.crc
    }

    pub fn end_byte(&self) -> u8 {
        self.end_byte
    }

    pub fn encode(&self) -> Bytes {
        let payload_len = self.payload.len();
        let mut frame =
            BytesMut::with_capacity(encoded_len_for_start_byte(self.start_byte, payload_len));

        if self.start_byte == SHORT_PACKET_START {
            frame.put_u8(SHORT_PACKET_START);
            frame.put_u8(payload_len as u8);
        } else if self.start_byte == LONG_PACKET_START {
            frame.put_u8(LONG_PACKET_START);
            frame.put_u16(payload_len as u16);
        } else {
            frame.put_u8(EXTENDED_PACKET_START);
            frame.put_u8((payload_len >> 16) as u8);
            frame.put_u8((payload_len >> 8) as u8);
            frame.put_u8(payload_len as u8);
        }

        frame.extend_from_slice(self.payload.as_ref());
        frame.put_u16(self.crc);
        frame.put_u8(self.end_byte);
        frame.freeze()
    }

    pub fn decode(frame: &[u8]) -> Result<Self, PacketError> {
        if frame.is_empty() {
            return Err(PacketError::IncompleteFrame {
                expected_len: 1,
                actual_len: 0,
            });
        }

        let (header_len, payload_len) = match frame[0] {
            SHORT_PACKET_START => {
                require_len(frame, 2)?;
                (2, frame[1] as usize)
            }
            LONG_PACKET_START => {
                require_len(frame, 3)?;
                (3, ((frame[1] as usize) << 8) | frame[2] as usize)
            }
            EXTENDED_PACKET_START => {
                require_len(frame, 4)?;
                (
                    4,
                    ((frame[1] as usize) << 16) | ((frame[2] as usize) << 8) | frame[3] as usize,
                )
            }
            byte => return Err(PacketError::InvalidStartByte { byte }),
        };

        if payload_len > MAX_PAYLOAD_LEN {
            return Err(PacketError::InvalidPayloadLength {
                len: payload_len,
                max_len: MAX_PAYLOAD_LEN,
            });
        }

        let expected_len = header_len + payload_len + 3;
        require_len(frame, expected_len)?;
        if frame.len() != expected_len {
            return Err(PacketError::InvalidFrameLength {
                expected_len,
                actual_len: frame.len(),
            });
        }

        let end_byte = frame[expected_len - 1];
        if end_byte != PACKET_END {
            return Err(PacketError::InvalidEndByte { byte: end_byte });
        }

        let payload_start = header_len;
        let payload_end = payload_start + payload_len;
        let payload = &frame[payload_start..payload_end];
        let expected_crc = crc16(payload);
        let actual_crc = ((frame[payload_end] as u16) << 8) | frame[payload_end + 1] as u16;

        if actual_crc != expected_crc {
            return Err(PacketError::InvalidChecksum {
                expected: expected_crc,
                actual: actual_crc,
            });
        }

        Ok(Self {
            payload: Bytes::copy_from_slice(payload),
            start_byte: frame[0],
            crc: actual_crc,
            end_byte,
        })
    }

    pub async fn async_write<W: AsyncWrite + Unpin>(
        &self,
        writer: &mut W,
        timeout_ms: u64,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let frame = self.encode();

        tokio::time::timeout(Duration::from_millis(timeout_ms), async {
            writer.write_all(&frame).await?;
            writer.flush().await
        })
        .await
        .map_err(|_| PacketError::Timeout)??;

        Ok(())
    }

    pub async fn async_read<R: AsyncRead + Unpin>(
        reader: &mut R,
        timeout_ms: u64,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let frame = tokio::time::timeout(Duration::from_millis(timeout_ms), async {
            let mut frame = BytesMut::new();
            let start = loop {
                let byte = reader.read_u8().await?;
                if matches!(
                    byte,
                    SHORT_PACKET_START | LONG_PACKET_START | EXTENDED_PACKET_START
                ) {
                    break byte;
                }
            };
            frame.put_u8(start);

            let payload_len = match start {
                SHORT_PACKET_START => {
                    let len = reader.read_u8().await?;
                    frame.put_u8(len);
                    len as usize
                }
                LONG_PACKET_START => {
                    let len_high = reader.read_u8().await?;
                    let len_low = reader.read_u8().await?;
                    frame.put_u8(len_high);
                    frame.put_u8(len_low);
                    ((len_high as usize) << 8) | len_low as usize
                }
                EXTENDED_PACKET_START => {
                    let len_high = reader.read_u8().await?;
                    let len_mid = reader.read_u8().await?;
                    let len_low = reader.read_u8().await?;
                    frame.put_u8(len_high);
                    frame.put_u8(len_mid);
                    frame.put_u8(len_low);
                    ((len_high as usize) << 16) | ((len_mid as usize) << 8) | len_low as usize
                }
                _ => unreachable!(),
            };

            let remaining_len = payload_len + 3;
            frame.resize(frame.len() + remaining_len, 0);
            let payload_crc_end_start = frame.len() - remaining_len;
            reader
                .read_exact(&mut frame[payload_crc_end_start..])
                .await?;

            Ok::<Bytes, std::io::Error>(frame.freeze())
        })
        .await
        .map_err(|_| PacketError::Timeout)??;

        Ok(Self::decode(frame.as_ref())?)
    }
}

pub fn crc16(payload: &[u8]) -> u16 {
    let mut crc = 0u16;

    for byte in payload {
        crc ^= (*byte as u16) << 8;

        for _ in 0..8 {
            if (crc & 0x8000) != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }

    crc
}

fn start_byte_for_payload_len(payload_len: usize) -> u8 {
    if payload_len <= SHORT_PAYLOAD_MAX_LEN {
        SHORT_PACKET_START
    } else if payload_len <= LONG_PAYLOAD_MAX_LEN {
        LONG_PACKET_START
    } else {
        EXTENDED_PACKET_START
    }
}

fn encoded_len_for_start_byte(start_byte: u8, payload_len: usize) -> usize {
    let header_len = match start_byte {
        SHORT_PACKET_START => 2,
        LONG_PACKET_START => 3,
        EXTENDED_PACKET_START => 4,
        _ => unreachable!(),
    };

    header_len + payload_len + 3
}

fn require_len(frame: &[u8], expected_len: usize) -> Result<(), PacketError> {
    if frame.len() < expected_len {
        return Err(PacketError::IncompleteFrame {
            expected_len,
            actual_len: frame.len(),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_payload_bytes() {
        let payload = Bytes::from_static(&[0x00, 0x01, 0x02]);
        let packet = CommPacket::new(payload.clone()).unwrap();

        assert_eq!(packet.len(), 3);
        assert!(!packet.is_empty());
        assert_eq!(packet.into_payload(), payload);
    }

    #[test]
    fn rejects_payloads_above_extended_packet_limit() {
        let payload = Bytes::from(vec![0u8; MAX_PAYLOAD_LEN + 1]);

        assert_eq!(
            CommPacket::new(payload),
            Err(PacketError::PayloadTooLarge {
                len: MAX_PAYLOAD_LEN + 1,
                max_len: MAX_PAYLOAD_LEN,
            })
        );
    }

    #[test]
    fn accepts_payloads_above_long_packet_limit() {
        let payload = Bytes::from(vec![0u8; LONG_PAYLOAD_MAX_LEN + 1]);
        let packet = CommPacket::new(payload).unwrap();

        assert_eq!(packet.len(), LONG_PAYLOAD_MAX_LEN + 1);
    }

    #[test]
    fn computes_vesc_crc16() {
        assert_eq!(crc16(&[]), 0x0000);
        assert_eq!(crc16(&[0x00]), 0x0000);
        assert_eq!(crc16(&[0x01]), 0x1021);
        assert_eq!(crc16(b"123456789"), 0x31c3);
    }

    #[test]
    fn encodes_short_frame() {
        let packet = CommPacket::new(Bytes::from_static(&[0x01])).unwrap();

        assert_eq!(
            packet.encode().as_ref(),
            &[SHORT_PACKET_START, 1, 0x01, 0x10, 0x21, PACKET_END]
        );
    }

    #[test]
    fn encodes_long_frame() {
        let payload = Bytes::from(vec![0x55; SHORT_PAYLOAD_MAX_LEN + 1]);
        let frame = CommPacket::new(payload).unwrap().encode();

        assert_eq!(frame[0], LONG_PACKET_START);
        assert_eq!(frame[1], 0x01);
        assert_eq!(frame[2], 0x00);
        assert_eq!(frame.len(), 3 + SHORT_PAYLOAD_MAX_LEN + 1 + 3);
        assert_eq!(frame[frame.len() - 1], PACKET_END);
    }

    #[test]
    fn encodes_extended_frame() {
        let payload = Bytes::from(vec![0x55; LONG_PAYLOAD_MAX_LEN + 1]);
        let frame = CommPacket::new(payload).unwrap().encode();

        assert_eq!(frame[0], EXTENDED_PACKET_START);
        assert_eq!(frame[1], 0x01);
        assert_eq!(frame[2], 0x00);
        assert_eq!(frame[3], 0x00);
        assert_eq!(frame.len(), 4 + LONG_PAYLOAD_MAX_LEN + 1 + 3);
        assert_eq!(frame[frame.len() - 1], PACKET_END);
    }

    #[test]
    fn decodes_encoded_frame() {
        let packet = CommPacket::new(Bytes::from_static(&[0x04, 0x01, 0x02])).unwrap();
        let frame = packet.encode();

        assert_eq!(CommPacket::decode(frame.as_ref()).unwrap(), packet);
    }

    #[test]
    fn rejects_frame_with_invalid_checksum() {
        let packet = CommPacket::new(Bytes::from_static(&[0x01])).unwrap();
        let mut frame = packet.encode().to_vec();
        frame[3] ^= 0x01;

        assert_eq!(
            CommPacket::decode(&frame),
            Err(PacketError::InvalidChecksum {
                expected: 0x1021,
                actual: 0x1121,
            })
        );
    }

    #[test]
    fn rejects_frame_with_trailing_bytes() {
        let packet = CommPacket::new(Bytes::from_static(&[0x01])).unwrap();
        let mut frame = packet.encode().to_vec();
        frame.push(0x00);

        assert_eq!(
            CommPacket::decode(&frame),
            Err(PacketError::InvalidFrameLength {
                expected_len: 6,
                actual_len: 7,
            })
        );
    }
}

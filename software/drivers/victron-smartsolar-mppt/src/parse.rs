const CHECKSUM_LABEL: &[u8] = b"Checksum";
const MAX_BLOCK_BYTES: usize = 4096;
const MAX_HEX_BYTES: usize = 512;
const MAX_NAME_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Idle,
    RecordBegin,
    RecordName,
    RecordValue,
    Checksum,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DemuxEvent {
    TextBlock(Vec<u8>),
    TextBlockBad,
    HexFrame(Vec<u8>),
    HexFrameBad,
}

pub struct VeDirectDemux {
    state: State,
    in_hex: bool,
    checksum: u8,
    raw: Vec<u8>,
    name: Vec<u8>,
    hex: Vec<u8>,
}

impl Default for VeDirectDemux {
    fn default() -> Self {
        Self {
            state: State::Idle,
            in_hex: false,
            checksum: 0,
            raw: Vec::with_capacity(512),
            name: Vec::with_capacity(MAX_NAME_BYTES),
            hex: Vec::with_capacity(64),
        }
    }
}

impl VeDirectDemux {
    pub fn new() -> Self {
        Self::default()
    }

    fn reset_text(&mut self) {
        self.state = State::Idle;
        self.checksum = 0;
        self.raw.clear();
        self.name.clear();
    }

    pub fn push(&mut self, byte: u8) -> Option<DemuxEvent> {
        if self.in_hex {
            if byte == b'\n' {
                let frame = std::mem::take(&mut self.hex);
                self.in_hex = false;
                return Some(if crate::hex::validate_frame(&frame) {
                    DemuxEvent::HexFrame(frame)
                } else {
                    DemuxEvent::HexFrameBad
                });
            }
            self.hex.push(byte);
            if self.hex.len() > MAX_HEX_BYTES {
                self.hex.clear();
                self.in_hex = false;
                return Some(DemuxEvent::HexFrameBad);
            }
            return None;
        }

        if byte == b':' && self.state != State::Checksum {
            self.in_hex = true;
            self.hex.clear();
            self.hex.push(byte);
            return None;
        }

        self.checksum = self.checksum.wrapping_add(byte);
        self.raw.push(byte);
        if self.raw.len() > MAX_BLOCK_BYTES {
            self.reset_text();
            return Some(DemuxEvent::TextBlockBad);
        }

        match self.state {
            State::Idle => {
                if byte == b'\n' {
                    self.state = State::RecordBegin;
                }
                None
            }
            State::RecordBegin => {
                self.name.clear();
                self.name.push(byte);
                self.state = State::RecordName;
                None
            }
            State::RecordName => {
                if byte == b'\t' {
                    self.state = if self.name == CHECKSUM_LABEL {
                        State::Checksum
                    } else {
                        State::RecordValue
                    };
                } else if self.name.len() < MAX_NAME_BYTES {
                    self.name.push(byte);
                }
                None
            }
            State::RecordValue => {
                if byte == b'\n' {
                    self.state = State::RecordBegin;
                }
                None
            }
            State::Checksum => {
                let valid = self.checksum == 0;
                let block = std::mem::take(&mut self.raw);
                self.checksum = 0;
                self.name.clear();
                self.state = State::Idle;
                Some(if valid {
                    DemuxEvent::TextBlock(block)
                } else {
                    DemuxEvent::TextBlockBad
                })
            }
        }
    }
}

fn strip_cr(record: &[u8]) -> &[u8] {
    match record.last() {
        Some(b'\r') => &record[..record.len() - 1],
        _ => record,
    }
}

pub fn parse_hex_u16(value: &str) -> Option<u16> {
    let trimmed = value.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    u16::from_str_radix(hex, 16).ok()
}

pub fn text_field<'a>(block: &'a [u8], label: &str) -> Option<&'a str> {
    let label = label.as_bytes();
    for record in block.split(|&b| b == b'\n').map(strip_cr) {
        if let Some(tab) = record.iter().position(|&b| b == b'\t') {
            if &record[..tab] == label {
                return std::str::from_utf8(&record[tab + 1..]).ok();
            }
        }
    }
    None
}

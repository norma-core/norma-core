#[derive(Debug, Clone)]
pub struct ParsedRecord {
    pub seq: u64,
    pub priority: u8,
    pub facility: u8,
    pub monotonic_us: u64,
    pub message: String,
    pub subsystem: String,
    pub device: String,
}

pub fn parse_record(bytes: &[u8]) -> Option<ParsedRecord> {
    let text = std::str::from_utf8(bytes).ok()?;
    let (header, body) = text.split_once(';')?;

    let mut fields = header.split(',');
    let prefix: u32 = fields.next()?.trim().parse().ok()?;
    let seq: u64 = fields.next()?.trim().parse().ok()?;
    let monotonic_us: u64 = fields.next()?.trim().parse().ok()?;

    let mut lines = body.split('\n');
    let message = unescape(lines.next()?);

    let mut subsystem = String::new();
    let mut device = String::new();

    for line in lines {
        let Some(entry) = line.strip_prefix(' ') else {
            continue;
        };

        if let Some(value) = entry.strip_prefix("SUBSYSTEM=") {
            subsystem = unescape(value);
        } else if let Some(value) = entry.strip_prefix("DEVICE=") {
            device = unescape(value);
        }
    }

    Some(ParsedRecord {
        seq,
        priority: (prefix & 7) as u8,
        facility: (prefix >> 3) as u8,
        monotonic_us,
        message,
        subsystem,
        device,
    })
}

fn unescape(value: &str) -> String {
    if !value.contains("\\x") {
        return value.to_string();
    }

    let source = value.as_bytes();
    let mut decoded: Vec<u8> = Vec::with_capacity(source.len());
    let mut index = 0;

    while index < source.len() {
        if source[index] == b'\\'
            && index + 3 < source.len()
            && source[index + 1] == b'x'
            && let (Some(high), Some(low)) =
                (hex_digit(source[index + 2]), hex_digit(source[index + 3]))
        {
            decoded.push((high << 4) | low);
            index += 4;
            continue;
        }

        decoded.push(source[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

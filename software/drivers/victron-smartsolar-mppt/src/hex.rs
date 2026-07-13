pub const CMD_GET: u8 = 7;

const HEX: &[u8; 16] = b"0123456789ABCDEF";

pub fn checksum(cmd_nibble: u8, data: &[u8]) -> u8 {
    let sum = data
        .iter()
        .fold(cmd_nibble, |acc, byte| acc.wrapping_add(*byte));
    0x55u8.wrapping_sub(sum)
}

fn push_hex_byte(out: &mut Vec<u8>, byte: u8) {
    out.push(HEX[(byte >> 4) as usize]);
    out.push(HEX[(byte & 0x0F) as usize]);
}

pub fn make_command(cmd_nibble: u8, data: &[u8]) -> Vec<u8> {
    let check = checksum(cmd_nibble, data);
    let mut frame = Vec::with_capacity(4 + data.len() * 2);
    frame.push(b':');
    frame.push(HEX[(cmd_nibble & 0x0F) as usize]);
    for byte in data {
        push_hex_byte(&mut frame, *byte);
    }
    push_hex_byte(&mut frame, check);
    frame.push(b'\n');
    frame
}

pub fn make_get(register: u16) -> Vec<u8> {
    let data = [register as u8, (register >> 8) as u8, 0x00];
    make_command(CMD_GET, &data)
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'A'..=b'F' => Some(c - b'A' + 10),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    }
}

pub fn validate_frame(frame: &[u8]) -> bool {
    let Some(body) = frame.strip_prefix(b":") else {
        return false;
    };
    if body.len() < 3 || body.len() % 2 == 0 {
        return false;
    }
    let Some(mut sum) = hex_val(body[0]) else {
        return false;
    };
    let mut i = 1;
    while i < body.len() {
        let (Some(hi), Some(lo)) = (hex_val(body[i]), hex_val(body[i + 1])) else {
            return false;
        };
        sum = sum.wrapping_add((hi << 4) | lo);
        i += 2;
    }
    sum == 0x55
}

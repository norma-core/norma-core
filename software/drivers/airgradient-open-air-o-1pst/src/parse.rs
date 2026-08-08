pub fn has_json_object(line: &str) -> bool {
    json_object(line).is_some()
}

pub fn json_object(line: &str) -> Option<&str> {
    let start = line.find('{')?;
    let end = line.rfind('}')?;
    if end > start {
        Some(&line[start..=end])
    } else {
        None
    }
}

pub fn json_string_field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let json = json_object(line)?;
    let needle = format!("\"{key}\"");
    let after_key = &json[json.find(&needle)? + needle.len()..];
    let after_colon = after_key.trim_start().strip_prefix(':')?.trim_start();
    let rest = after_colon.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(&rest[..end])
}

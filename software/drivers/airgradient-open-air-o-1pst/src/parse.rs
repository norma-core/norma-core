pub fn has_json_object(line: &str) -> bool {
    match (line.find('{'), line.rfind('}')) {
        (Some(start), Some(end)) => end > start,
        _ => false,
    }
}

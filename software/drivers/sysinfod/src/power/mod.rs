use crate::sysinfo_proto::sysinfo::{PowerSource, PowerSourceAttribute};

#[cfg(target_os = "linux")]
mod bq24190;

pub async fn collect_power_sources() -> Vec<PowerSource> {
    collect_power_sources_impl().await
}

#[cfg(target_os = "linux")]
async fn collect_power_sources_impl() -> Vec<PowerSource> {
    use std::fs;
    use std::path::Path;

    let power_supply_path = Path::new("/sys/class/power_supply");
    let Ok(entries) = fs::read_dir(power_supply_path) else {
        return Vec::new();
    };

    let entries = entries
        .filter_map(Result::ok)
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            (name, path)
        })
        .collect::<Vec<_>>();

    let mut sources = Vec::with_capacity(entries.len());
    for (name, path) in entries {
        let mut attributes = collect_power_source_attributes(&path);
        bq24190::append_attributes(&name, &path, &mut attributes).await;
        attributes.sort_by(|a, b| a.key.cmp(&b.key));

        sources.push(PowerSource { name, attributes });
    }

    sources.sort_by(|a, b| a.name.cmp(&b.name));
    sources
}

#[cfg(not(target_os = "linux"))]
async fn collect_power_sources_impl() -> Vec<PowerSource> {
    Vec::new()
}

#[cfg(target_os = "linux")]
fn collect_power_source_attributes(path: &std::path::Path) -> Vec<PowerSourceAttribute> {
    let Ok(entries) = std::fs::read_dir(path) else {
        return Vec::new();
    };

    let mut attributes: Vec<PowerSourceAttribute> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let Ok(file_type) = entry.file_type() else {
                return None;
            };

            if !file_type.is_file() {
                return None;
            }

            let key = entry.file_name().to_string_lossy().into_owned();
            let value = std::fs::read_to_string(entry.path()).ok()?;

            Some(PowerSourceAttribute {
                key,
                value: value
                    .trim_end_matches(|c| c == '\n' || c == '\r')
                    .to_string(),
            })
        })
        .collect();

    attributes.sort_by(|a, b| a.key.cmp(&b.key));
    attributes
}

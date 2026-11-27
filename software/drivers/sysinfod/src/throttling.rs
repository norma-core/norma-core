use crate::sysinfo_proto::sysinfo::ThrottlingState;

pub fn collect_throttling_state() -> Option<ThrottlingState> {
    collect_throttling_state_impl()
}

#[cfg(target_os = "linux")]
fn collect_throttling_state_impl() -> Option<ThrottlingState> {
    let rpi = collect_rpi_throttling();
    let cooling_devices = collect_cooling_devices();
    let cpufreq_policies = collect_cpufreq_policies();

    if rpi.is_none() && cooling_devices.is_empty() && cpufreq_policies.is_empty() {
        return None;
    }

    let thermally_throttled = cooling_devices
        .iter()
        .any(|device| device.cur_state > 0 && device.r#type.contains("cpufreq"));

    Some(ThrottlingState {
        rpi,
        thermally_throttled,
        cooling_devices,
        cpufreq_policies,
    })
}

#[cfg(not(target_os = "linux"))]
fn collect_throttling_state_impl() -> Option<ThrottlingState> {
    None
}

#[cfg(target_os = "linux")]
const GET_THROTTLED_SYSFS: &str = "/sys/devices/platform/soc/soc:firmware/get_throttled";

#[cfg(target_os = "linux")]
const VCGENCMD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

#[cfg(target_os = "linux")]
fn collect_rpi_throttling() -> Option<crate::sysinfo_proto::sysinfo::RpiThrottling> {
    let raw = std::fs::read_to_string(GET_THROTTLED_SYSFS)
        .ok()
        .and_then(|value| parse_get_throttled(&value))
        .or_else(|| run_vcgencmd().and_then(|value| parse_get_throttled(&value)))?;

    Some(rpi_throttling(raw))
}

#[cfg(target_os = "linux")]
fn rpi_throttling(raw: u32) -> crate::sysinfo_proto::sysinfo::RpiThrottling {
    crate::sysinfo_proto::sysinfo::RpiThrottling {
        raw,
        under_voltage: raw & 0x1 != 0,
        arm_frequency_capped: raw & 0x2 != 0,
        throttled: raw & 0x4 != 0,
        soft_temp_limit: raw & 0x8 != 0,
        under_voltage_since_boot: raw & 0x1_0000 != 0,
        arm_frequency_capped_since_boot: raw & 0x2_0000 != 0,
        throttled_since_boot: raw & 0x4_0000 != 0,
        soft_temp_limit_since_boot: raw & 0x8_0000 != 0,
    }
}

#[cfg(target_os = "linux")]
fn parse_get_throttled(value: &str) -> Option<u32> {
    let value = value.trim();
    let value = value.strip_prefix("throttled=").unwrap_or(value);
    let value = value.strip_prefix("0x").unwrap_or(value);

    u32::from_str_radix(value, 16).ok()
}

#[cfg(target_os = "linux")]
fn run_vcgencmd() -> Option<String> {
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::Instant;

    let mut child = Command::new("vcgencmd")
        .arg("get_throttled")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child.wait_with_output().ok()?;
                if !output.status.success() {
                    return None;
                }

                return Some(String::from_utf8_lossy(&output.stdout).into_owned());
            }
            Ok(None) => {}
            Err(_) => return None,
        }

        if started.elapsed() >= VCGENCMD_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }

        thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[cfg(target_os = "linux")]
fn collect_cooling_devices() -> Vec<crate::sysinfo_proto::sysinfo::CoolingDevice> {
    let Ok(entries) = std::fs::read_dir("/sys/class/thermal") else {
        return Vec::new();
    };

    let mut devices: Vec<crate::sysinfo_proto::sysinfo::CoolingDevice> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("cooling_device") {
                return None;
            }

            let path = entry.path();

            Some(crate::sysinfo_proto::sysinfo::CoolingDevice {
                name,
                r#type: read_sysfs_string(&path.join("type")),
                cur_state: read_sysfs_u64(&path.join("cur_state")),
                max_state: read_sysfs_u64(&path.join("max_state")),
            })
        })
        .collect();

    devices.sort_by(|a, b| a.name.cmp(&b.name));
    devices
}

#[cfg(target_os = "linux")]
fn collect_cpufreq_policies() -> Vec<crate::sysinfo_proto::sysinfo::CpuFreqPolicy> {
    let Ok(entries) = std::fs::read_dir("/sys/devices/system/cpu/cpufreq") else {
        return Vec::new();
    };

    let mut policies: Vec<crate::sysinfo_proto::sysinfo::CpuFreqPolicy> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("policy") {
                return None;
            }

            let path = entry.path();

            Some(crate::sysinfo_proto::sysinfo::CpuFreqPolicy {
                name,
                scaling_governor: read_sysfs_string(&path.join("scaling_governor")),
                scaling_cur_freq_khz: read_sysfs_u64(&path.join("scaling_cur_freq")),
                scaling_min_freq_khz: read_sysfs_u64(&path.join("scaling_min_freq")),
                scaling_max_freq_khz: read_sysfs_u64(&path.join("scaling_max_freq")),
                cpuinfo_min_freq_khz: read_sysfs_u64(&path.join("cpuinfo_min_freq")),
                cpuinfo_max_freq_khz: read_sysfs_u64(&path.join("cpuinfo_max_freq")),
            })
        })
        .collect();

    policies.sort_by(|a, b| a.name.cmp(&b.name));
    policies
}

#[cfg(target_os = "linux")]
fn read_sysfs_string(path: &std::path::Path) -> String {
    std::fs::read_to_string(path)
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn read_sysfs_u64(path: &std::path::Path) -> u64 {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0)
}

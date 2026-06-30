use crate::sysinfo_proto::sysinfo::{
    CellularAttribute, CellularBearer, CellularError, CellularIpConfig, CellularModem,
    CellularSignal,
};
use std::collections::BTreeMap;
use std::io;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const MMCLI_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy)]
struct Timestamp {
    monotonic_stamp_ns: u64,
    local_stamp_ns: u64,
    app_start_id: u64,
}

#[derive(Debug)]
struct MmcliOutput {
    stdout: String,
    stderr: String,
    exit_code: i32,
    success: bool,
    timed_out: bool,
}

pub fn collect_cellular_modems() -> Vec<CellularModem> {
    let Ok(output) = run_mmcli(&["-L", "-K"], MMCLI_TIMEOUT) else {
        return Vec::new();
    };

    if !output.success {
        return Vec::new();
    }

    let mut modem_paths = parse_modem_paths(&parse_key_values(&output.stdout));
    modem_paths.sort();
    modem_paths.dedup();

    modem_paths
        .into_iter()
        .map(|path| collect_modem(&path))
        .collect()
}

fn collect_modem(path: &str) -> CellularModem {
    let modem_id = object_id(path);
    let stamp = timestamp_now();
    let mut modem = CellularModem {
        monotonic_stamp_ns: stamp.monotonic_stamp_ns,
        local_stamp_ns: stamp.local_stamp_ns,
        app_start_id: stamp.app_start_id,
        path: path.to_string(),
        modem_id: modem_id.clone(),
        ..Default::default()
    };

    let details = match run_mmcli(&["-m", &modem_id, "-K"], MMCLI_TIMEOUT) {
        Ok(output) if output.success => parse_key_values(&output.stdout),
        Ok(output) => {
            modem.errors.push(mmcli_error(
                "modem.details",
                path,
                &output,
                "failed to read modem details",
            ));
            return modem;
        }
        Err(err) => {
            modem.errors.push(spawn_error("modem.details", path, err));
            return modem;
        }
    };

    fill_modem_fields(&mut modem, &details);
    modem.attributes = attributes_from_entries(&details);

    if let Ok(signal_output) = run_mmcli(&["-m", &modem_id, "--signal-get", "-K"], MMCLI_TIMEOUT) {
        if signal_output.success {
            let signal_details = parse_key_values(&signal_output.stdout);
            modem
                .attributes
                .extend(attributes_from_entries(&signal_details));
            modem.signals = collect_signal_metrics(&signal_details, timestamp_now());
        }
    }

    modem.bearers = collect_bearers(&details, &mut modem.errors);
    modem.attributes.sort_by(|a, b| a.key.cmp(&b.key));
    modem
        .attributes
        .dedup_by(|a, b| a.key == b.key && a.value == b.value);
    modem
        .errors
        .sort_by(|a, b| a.scope.cmp(&b.scope).then(a.path.cmp(&b.path)));
    modem
}

fn collect_bearers(
    details: &[(String, String)],
    errors: &mut Vec<CellularError>,
) -> Vec<CellularBearer> {
    let mut bearer_paths = details
        .iter()
        .filter_map(|(key, value)| {
            if key.starts_with("modem.generic.bearers.value[") && value.contains("/Bearer/") {
                Some(clean_value(value))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    bearer_paths.sort();
    bearer_paths.dedup();

    bearer_paths
        .into_iter()
        .map(|path| collect_bearer(&path, errors))
        .collect()
}

fn collect_bearer(path: &str, errors: &mut Vec<CellularError>) -> CellularBearer {
    let bearer_id = object_id(path);
    let stamp = timestamp_now();
    let mut bearer = CellularBearer {
        monotonic_stamp_ns: stamp.monotonic_stamp_ns,
        local_stamp_ns: stamp.local_stamp_ns,
        app_start_id: stamp.app_start_id,
        path: path.to_string(),
        bearer_id: bearer_id.clone(),
        ..Default::default()
    };

    let details = match run_mmcli(&["-b", &bearer_id, "-K"], MMCLI_TIMEOUT) {
        Ok(output) if output.success => parse_key_values(&output.stdout),
        Ok(output) => {
            errors.push(mmcli_error(
                "bearer.details",
                path,
                &output,
                "failed to read bearer details",
            ));
            return bearer;
        }
        Err(err) => {
            errors.push(spawn_error("bearer.details", path, err));
            return bearer;
        }
    };

    bearer.r#type = first_value(&details, &["bearer.generic.type", "bearer.type"]);
    bearer.connected = first_bool(&details, &["bearer.status.connected"]);
    bearer.suspended = first_bool(&details, &["bearer.status.suspended"]);
    bearer.multiplexed = first_bool(&details, &["bearer.status.multiplexed"]);
    bearer.interface = first_value(&details, &["bearer.status.interface"]);
    bearer.ip_timeout_seconds = first_u32(&details, &["bearer.status.ip-timeout"]);
    bearer.profile_id = first_i32(
        &details,
        &["bearer.status.profile-id", "bearer.properties.profile-id"],
    );
    bearer.apn = first_value(&details, &["bearer.properties.apn"]);
    bearer.apn_type = first_value(&details, &["bearer.properties.apn-type"]);
    bearer.roaming = first_value(
        &details,
        &[
            "bearer.properties.roaming",
            "bearer.properties.roaming-allowance",
        ],
    );
    bearer.ip = collect_ip_configs(&details);
    bearer.attributes = attributes_from_entries(&details);
    bearer
}

fn fill_modem_fields(modem: &mut CellularModem, details: &[(String, String)]) {
    let modem_path = first_value(details, &["modem.generic.dbus-path"]);
    if !modem_path.is_empty() {
        modem.path = modem_path;
    }
    modem.manufacturer = first_value(details, &["modem.generic.manufacturer"]);
    modem.model = first_value(details, &["modem.generic.model"]);
    modem.firmware_revision = first_value(
        details,
        &["modem.generic.revision", "modem.generic.firmware-revision"],
    );
    modem.hardware_revision = first_value(details, &["modem.generic.hardware-revision"]);
    modem.carrier_config = first_value(details, &["modem.generic.carrier-configuration"]);
    modem.equipment_id = first_value(details, &["modem.generic.equipment-id"]);
    modem.device_id = first_value(details, &["modem.generic.device-id"]);

    modem.device = first_value(details, &["modem.generic.device"]);
    modem.physdev = first_value(details, &["modem.generic.physdev"]);
    modem.drivers = first_value(details, &["modem.generic.drivers"]);
    modem.plugin = first_value(details, &["modem.generic.plugin"]);
    modem.primary_port = first_value(details, &["modem.generic.primary-port"]);
    modem.ports = first_value(details, &["modem.generic.ports"]);

    modem.state = first_value(details, &["modem.generic.state"]);
    modem.failed_reason = first_value(details, &["modem.generic.failed-reason"]);
    modem.power_state = first_value(details, &["modem.generic.power-state"]);
    modem.access_tech = first_value(
        details,
        &[
            "modem.generic.access-technologies",
            "modem.generic.access-tech",
        ],
    );
    modem.signal_quality_percent = parse_signal_quality_percent(details);
    modem.signal_quality_recent = parse_signal_quality_recent(details);

    modem.imei = first_value(details, &["modem.3gpp.imei"]);
    modem.operator_id = first_value(
        details,
        &["modem.3gpp.operator-code", "modem.3gpp.operator-id"],
    );
    modem.operator_name = first_value(details, &["modem.3gpp.operator-name"]);
    modem.registration = first_value(
        details,
        &["modem.3gpp.registration-state", "modem.3gpp.registration"],
    );
    modem.packet_service_state = first_value(details, &["modem.3gpp.packet-service-state"]);
    modem.primary_sim_path = first_value(
        details,
        &["modem.generic.sim", "modem.generic.primary-sim-path"],
    );
    modem.own_numbers = first_value(details, &["modem.generic.own-numbers"]);
}

fn collect_ip_configs(details: &[(String, String)]) -> Vec<CellularIpConfig> {
    ["ipv4", "ipv6"]
        .into_iter()
        .filter_map(|family| collect_ip_config(details, family))
        .collect()
}

fn collect_ip_config(details: &[(String, String)], family: &str) -> Option<CellularIpConfig> {
    let prefix = format!("bearer.{family}-config.");
    let family_entries = details
        .iter()
        .filter(|(key, _)| key.starts_with(&prefix))
        .cloned()
        .collect::<Vec<_>>();

    if family_entries.is_empty() {
        return None;
    }

    let method_key = format!("bearer.{family}-config.method");
    let address_key = format!("bearer.{family}-config.address");
    let prefix_key = format!("bearer.{family}-config.prefix");
    let gateway_key = format!("bearer.{family}-config.gateway");

    Some(CellularIpConfig {
        family: family.to_string(),
        method: first_value(&family_entries, &[method_key.as_str()]),
        address: first_value(&family_entries, &[address_key.as_str()]),
        prefix: first_u32(&family_entries, &[prefix_key.as_str()]),
        gateway: first_value(&family_entries, &[gateway_key.as_str()]),
        dns: collect_dns_values(&family_entries),
        attributes: attributes_from_entries(&family_entries),
    })
}

fn collect_signal_metrics(details: &[(String, String)], stamp: Timestamp) -> Vec<CellularSignal> {
    let mut by_tech: BTreeMap<String, Vec<CellularAttribute>> = BTreeMap::new();

    for (key, value) in details {
        let Some(rest) = key.strip_prefix("modem.signal.") else {
            continue;
        };

        let mut parts = rest.splitn(2, '.');
        let Some(tech) = parts.next() else {
            continue;
        };
        let Some(metric) = parts.next() else {
            continue;
        };

        if tech.is_empty() || metric.is_empty() {
            continue;
        }

        by_tech
            .entry(tech.to_string())
            .or_default()
            .push(CellularAttribute {
                key: metric.to_string(),
                value: clean_value(value),
            });
    }

    by_tech
        .into_iter()
        .map(|(access_tech, mut metrics)| {
            metrics.sort_by(|a, b| a.key.cmp(&b.key));
            CellularSignal {
                monotonic_stamp_ns: stamp.monotonic_stamp_ns,
                local_stamp_ns: stamp.local_stamp_ns,
                app_start_id: stamp.app_start_id,
                access_tech,
                metrics,
            }
        })
        .collect()
}

fn collect_dns_values(details: &[(String, String)]) -> Vec<String> {
    let mut dns = Vec::new();

    for (key, value) in details {
        if !key.contains(".dns") {
            continue;
        }

        for item in clean_value(value).split(',') {
            let item = item.trim();
            if !item.is_empty() {
                dns.push(item.to_string());
            }
        }
    }

    dns.sort();
    dns.dedup();
    dns
}

fn parse_modem_paths(entries: &[(String, String)]) -> Vec<String> {
    entries
        .iter()
        .filter_map(|(key, value)| {
            if key.starts_with("modem-list.value[") && value.contains("/Modem/") {
                Some(clean_value(value))
            } else {
                None
            }
        })
        .collect()
}

fn parse_key_values(stdout: &str) -> Vec<(String, String)> {
    stdout
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            let key = key.trim();
            if key.is_empty() {
                return None;
            }

            Some((key.to_string(), clean_value(value)))
        })
        .collect()
}

fn attributes_from_entries(entries: &[(String, String)]) -> Vec<CellularAttribute> {
    let mut attributes = entries
        .iter()
        .map(|(key, value)| CellularAttribute {
            key: key.clone(),
            value: value.clone(),
        })
        .collect::<Vec<_>>();

    attributes.sort_by(|a, b| a.key.cmp(&b.key));
    attributes
}

fn first_value(entries: &[(String, String)], keys: &[&str]) -> String {
    keys.iter()
        .find_map(|wanted| {
            entries
                .iter()
                .find(|(key, value)| key == wanted && !value.is_empty())
                .map(|(_, value)| value.clone())
        })
        .unwrap_or_default()
}

fn first_bool(entries: &[(String, String)], keys: &[&str]) -> bool {
    parse_bool(&first_value(entries, keys))
}

fn first_u32(entries: &[(String, String)], keys: &[&str]) -> u32 {
    first_value(entries, keys).parse::<u32>().unwrap_or(0)
}

fn first_i32(entries: &[(String, String)], keys: &[&str]) -> i32 {
    first_value(entries, keys).parse::<i32>().unwrap_or(0)
}

fn parse_signal_quality_percent(entries: &[(String, String)]) -> u32 {
    let value = first_value(
        entries,
        &[
            "modem.generic.signal-quality.value",
            "modem.generic.signal-quality",
        ],
    );

    let digits = value
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>();
    digits.parse::<u32>().unwrap_or(0)
}

fn parse_signal_quality_recent(entries: &[(String, String)]) -> bool {
    let recent = first_value(entries, &["modem.generic.signal-quality.recent"]);
    if !recent.is_empty() {
        return parse_bool(&recent);
    }

    first_value(entries, &["modem.generic.signal-quality"])
        .to_ascii_lowercase()
        .contains("recent")
}

fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "enabled" | "on"
    )
}

fn clean_value(value: &str) -> String {
    let value = value.trim();
    if value == "--" {
        String::new()
    } else {
        value.to_string()
    }
}

fn object_id(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn run_mmcli(args: &[&str], timeout: Duration) -> io::Result<MmcliOutput> {
    let mut child = Command::new("mmcli")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            let output = child.wait_with_output()?;
            let exit_code = output.status.code().unwrap_or(-1);
            return Ok(MmcliOutput {
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                exit_code,
                success: output.status.success(),
                timed_out: false,
            });
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let output = child.wait_with_output()?;
            return Ok(MmcliOutput {
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                exit_code: output.status.code().unwrap_or(-1),
                success: false,
                timed_out: true,
            });
        }

        thread::sleep(Duration::from_millis(20));
    }
}

fn mmcli_error(scope: &str, path: &str, output: &MmcliOutput, fallback: &str) -> CellularError {
    let message = if output.stderr.trim().is_empty() {
        fallback.to_string()
    } else {
        output.stderr.trim().to_string()
    };

    let stamp = timestamp_now();
    CellularError {
        monotonic_stamp_ns: stamp.monotonic_stamp_ns,
        local_stamp_ns: stamp.local_stamp_ns,
        app_start_id: stamp.app_start_id,
        scope: scope.to_string(),
        path: path.to_string(),
        message,
        exit_code: output.exit_code,
        timed_out: output.timed_out,
    }
}

fn spawn_error(scope: &str, path: &str, err: io::Error) -> CellularError {
    let stamp = timestamp_now();
    CellularError {
        monotonic_stamp_ns: stamp.monotonic_stamp_ns,
        local_stamp_ns: stamp.local_stamp_ns,
        app_start_id: stamp.app_start_id,
        scope: scope.to_string(),
        path: path.to_string(),
        message: err.to_string(),
        exit_code: -1,
        timed_out: false,
    }
}

fn timestamp_now() -> Timestamp {
    Timestamp {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
    }
}

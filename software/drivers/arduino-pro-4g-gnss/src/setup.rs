//! GNSS engine setup over a spare AT port.
//!
//! The primary AT interface is held by ModemManager, so setup talks to the
//! secondary one (USB interface 3). Verified on the EG25-G: `fixfreq` is
//! NV-backed and survives power cycles, but `AT+QGPS=1` (engine on) is not
//! and must be re-issued every time the modem powers up. `fixfreq` can only
//! be changed while the engine is off.

use std::time::Duration;

use log::{debug, info};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_serial::{SerialPortBuilderExt, SerialStream};

use crate::discovery::ModemPorts;

const AT_BAUD: u32 = 115_200;
const AT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(2);
/// The 27 KB assistance upload takes a moment to checksum and store.
const UPLOAD_RESULT_TIMEOUT: Duration = Duration::from_secs(10);

/// A fresh gpsOneXTRA injection performed during setup, so the driver can
/// record what assistance data the modem is running on.
pub struct XtraInjection {
    pub file: Vec<u8>,
    pub validity_minutes: u32,
}

pub struct SetupOutcome {
    pub at_port: String,
    pub xtra: Option<XtraInjection>,
}

/// Brings the GNSS engine up at the target rate over the first AT port
/// that answers. The NMEA stream may be alive even when this fails (e.g.
/// ModemManager already enabled the engine), so callers should still try
/// to read.
pub async fn ensure_gnss_enabled(
    ports: &ModemPorts,
    target_fixfreq_hz: u32,
    assistance: bool,
) -> Result<SetupOutcome, String> {
    let mut errors = Vec::new();
    for candidate in &ports.at_candidates {
        let path = candidate.display().to_string();
        match try_setup_on_port(&path, target_fixfreq_hz, assistance).await {
            Ok(xtra) => return Ok(SetupOutcome { at_port: path, xtra }),
            Err(error) => errors.push(format!("{path}: {error}")),
        }
    }
    if errors.is_empty() {
        errors.push("no AT port candidates found".to_string());
    }
    Err(errors.join("; "))
}

async fn try_setup_on_port(
    path: &str,
    target_fixfreq_hz: u32,
    assistance: bool,
) -> Result<Option<XtraInjection>, String> {
    let port = tokio_serial::new(path, AT_BAUD)
        .open_native_async()
        .map_err(|e| format!("open: {e}"))?;
    let mut port = BufReader::new(port);

    let mut engine_on = at_command(&mut port, "AT+QGPS?")
        .await?
        .iter()
        .find_map(|line| parse_qgps_state(line))
        .ok_or("AT+QGPS? gave no state")?;
    let current_fixfreq = at_command(&mut port, "AT+QGPSCFG=\"fixfreq\"")
        .await?
        .iter()
        .find_map(|line| parse_fixfreq(line));

    let mut injected = None;
    if assistance {
        // Assistance failures are never fatal — the engine still works
        // standalone, just with slower cold starts.
        let validity = crate::xtra::query_validity_minutes(&mut port).await;
        if crate::xtra::validity_is_sufficient(validity) {
            log::debug!("XTRA assistance still valid for {validity} minutes");
        } else {
            match crate::xtra::download_xtra_file().await {
                Ok(file) => {
                    if engine_on {
                        at_command(&mut port, "AT+QGPSEND").await?;
                        engine_on = false;
                    }
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    match crate::xtra::inject(&mut port, &file, now).await {
                        Ok(validity_minutes) => {
                            injected = Some(XtraInjection { file, validity_minutes });
                        }
                        Err(error) => log::warn!("XTRA injection failed: {error}"),
                    }
                }
                Err(error) => {
                    log::warn!("XTRA download failed, continuing without assistance: {error}");
                }
            }
        }
    }

    let commands = plan_setup_commands(engine_on, current_fixfreq, target_fixfreq_hz);
    if commands.is_empty() {
        debug!("GNSS engine already on at {target_fixfreq_hz} Hz");
        return Ok(injected);
    }

    for command in &commands {
        if let Err(error) = at_command(&mut port, command).await {
            // 504: session already open — a benign race on AT+QGPS=1.
            if command == "AT+QGPS=1" && error.contains("504") {
                continue;
            }
            return Err(format!("{command}: {error}"));
        }
    }
    info!("GNSS engine configured at {target_fixfreq_hz} Hz via {path}");
    Ok(injected)
}

/// Sends a file-upload command (`AT+QFUPL=...`), waits for the modem's
/// CONNECT prompt, streams the raw payload, and waits for the final OK.
pub(crate) async fn at_upload(
    port: &mut BufReader<SerialStream>,
    command: &str,
    payload: &[u8],
) -> Result<(), String> {
    port.get_mut()
        .write_all(format!("{command}\r").as_bytes())
        .await
        .map_err(|e| format!("write: {e}"))?;

    let mut line = String::new();
    loop {
        line.clear();
        let read = tokio::time::timeout(AT_RESPONSE_TIMEOUT, port.read_line(&mut line))
            .await
            .map_err(|_| format!("timeout waiting for CONNECT after {command}"))?
            .map_err(|e| format!("read: {e}"))?;
        if read == 0 {
            return Err("AT port closed".to_string());
        }
        if line.trim() == "CONNECT" {
            break;
        }
        if let AtResult::Error(error) = classify_at_line(&line) {
            return Err(error);
        }
    }

    port.get_mut()
        .write_all(payload)
        .await
        .map_err(|e| format!("write payload: {e}"))?;

    loop {
        line.clear();
        let read = tokio::time::timeout(UPLOAD_RESULT_TIMEOUT, port.read_line(&mut line))
            .await
            .map_err(|_| format!("timeout waiting for result of {command}"))?
            .map_err(|e| format!("read: {e}"))?;
        if read == 0 {
            return Err("AT port closed".to_string());
        }
        match classify_at_line(&line) {
            AtResult::Ok => return Ok(()),
            AtResult::Error(error) => return Err(error),
            AtResult::Pending => {}
        }
    }
}

/// Sends one AT command and collects information lines until the final
/// OK/ERROR, which is an Err here so callers propagate it directly.
pub(crate) async fn at_command(
    port: &mut BufReader<SerialStream>,
    command: &str,
) -> Result<Vec<String>, String> {
    port.get_mut()
        .write_all(format!("{command}\r").as_bytes())
        .await
        .map_err(|e| format!("write: {e}"))?;

    let mut info_lines = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        let read = tokio::time::timeout(AT_RESPONSE_TIMEOUT, port.read_line(&mut line))
            .await
            .map_err(|_| format!("timeout waiting for response to {command}"))?
            .map_err(|e| format!("read: {e}"))?;
        if read == 0 {
            return Err("AT port closed".to_string());
        }
        match classify_at_line(&line) {
            AtResult::Ok => return Ok(info_lines),
            AtResult::Error(error) => return Err(error),
            AtResult::Pending => {
                let trimmed = line.trim();
                // Skip echoes and blank separators.
                if !trimmed.is_empty() && !trimmed.starts_with("AT") {
                    info_lines.push(trimmed.to_string());
                }
            }
        }
    }
}

/// Parses the `+QGPS: <n>` line of an `AT+QGPS?` response into
/// "engine is on".
pub fn parse_qgps_state(response: &str) -> Option<bool> {
    match response.trim().strip_prefix("+QGPS: ")?.trim() {
        "0" => Some(false),
        "1" => Some(true),
        _ => None,
    }
}

/// Parses the `+QGPSCFG: "fixfreq",<n>` line of an
/// `AT+QGPSCFG="fixfreq"` response.
pub fn parse_fixfreq(response: &str) -> Option<u32> {
    response
        .trim()
        .strip_prefix("+QGPSCFG: \"fixfreq\",")?
        .trim()
        .parse()
        .ok()
}

/// Classifies one response line as a final AT result.
#[derive(Debug, PartialEq, Eq)]
pub enum AtResult {
    Ok,
    Error(String),
    /// Not a final result line (echo, URC, information response).
    Pending,
}

pub fn classify_at_line(line: &str) -> AtResult {
    let line = line.trim();
    if line == "OK" {
        AtResult::Ok
    } else if line == "ERROR"
        || line.starts_with("+CME ERROR")
        || line.starts_with("+CMS ERROR")
    {
        AtResult::Error(line.to_string())
    } else {
        AtResult::Pending
    }
}

/// The AT commands needed to bring the GNSS engine into the desired state,
/// in order. Empty when the engine is already on at the right rate.
pub fn plan_setup_commands(
    engine_on: bool,
    current_fixfreq_hz: Option<u32>,
    target_fixfreq_hz: u32,
) -> Vec<String> {
    let rate_ok = current_fixfreq_hz == Some(target_fixfreq_hz);
    if engine_on && rate_ok {
        return Vec::new();
    }

    let mut commands = Vec::new();
    if engine_on {
        commands.push("AT+QGPSEND".to_string());
    }
    if !rate_ok {
        commands.push(format!("AT+QGPSCFG=\"fixfreq\",{target_fixfreq_hz}"));
    }
    // Per-constellation NMEA output is off by default (only GPS sentences);
    // enable everything so recordings carry the full satellite picture.
    commands.push("AT+QGPSCFG=\"glonassnmeatype\",7".to_string());
    commands.push("AT+QGPSCFG=\"galileonmeatype\",1".to_string());
    commands.push("AT+QGPSCFG=\"beidounmeatype\",3".to_string());
    commands.push("AT+QGPS=1".to_string());
    commands
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_qgps_state_lines() {
        assert_eq!(parse_qgps_state("+QGPS: 0"), Some(false));
        assert_eq!(parse_qgps_state("+QGPS: 1"), Some(true));
        assert_eq!(parse_qgps_state("\r\n+QGPS: 1\r\n"), Some(true));
        assert_eq!(parse_qgps_state("OK"), None);
    }

    #[test]
    fn parses_fixfreq_lines() {
        assert_eq!(parse_fixfreq("+QGPSCFG: \"fixfreq\",10"), Some(10));
        assert_eq!(parse_fixfreq("\r\n+QGPSCFG: \"fixfreq\",1\r\n"), Some(1));
        assert_eq!(parse_fixfreq("+QGPSCFG: \"gnssconfig\",1"), None);
        assert_eq!(parse_fixfreq("ERROR"), None);
    }

    #[test]
    fn classifies_final_result_lines() {
        assert_eq!(classify_at_line("OK"), AtResult::Ok);
        assert_eq!(
            classify_at_line("+CME ERROR: 504"),
            AtResult::Error("+CME ERROR: 504".to_string())
        );
        assert_eq!(
            classify_at_line("ERROR"),
            AtResult::Error("ERROR".to_string())
        );
        assert_eq!(classify_at_line("+QGPS: 1"), AtResult::Pending);
        assert_eq!(classify_at_line(""), AtResult::Pending);
    }

    #[test]
    fn engine_on_at_target_rate_needs_no_commands() {
        assert_eq!(plan_setup_commands(true, Some(10), 10), Vec::<String>::new());
    }

    #[test]
    fn engine_off_at_target_rate_only_starts_engine() {
        let commands = plan_setup_commands(false, Some(10), 10);
        assert_eq!(commands.last().map(String::as_str), Some("AT+QGPS=1"));
        assert!(!commands.iter().any(|c| c == "AT+QGPSEND"));
        assert!(!commands.iter().any(|c| c.contains("fixfreq")));
    }

    #[test]
    fn engine_on_at_wrong_rate_restarts_engine_around_fixfreq() {
        let commands = plan_setup_commands(true, Some(1), 10);
        let end = commands
            .iter()
            .position(|c| c == "AT+QGPSEND")
            .expect("engine must stop before fixfreq changes");
        let freq = commands
            .iter()
            .position(|c| c == "AT+QGPSCFG=\"fixfreq\",10")
            .expect("fixfreq must be set");
        let start = commands
            .iter()
            .position(|c| c == "AT+QGPS=1")
            .expect("engine must start again");
        assert!(end < freq && freq < start);
    }

    #[test]
    fn engine_start_always_enables_all_constellation_sentences() {
        let commands = plan_setup_commands(false, Some(10), 10);
        assert!(commands.contains(&"AT+QGPSCFG=\"glonassnmeatype\",7".to_string()));
        assert!(commands.contains(&"AT+QGPSCFG=\"galileonmeatype\",1".to_string()));
        assert!(commands.contains(&"AT+QGPSCFG=\"beidounmeatype\",3".to_string()));
    }

    #[test]
    fn unknown_fixfreq_is_treated_as_wrong() {
        let commands = plan_setup_commands(true, None, 10);
        assert!(commands.contains(&"AT+QGPSCFG=\"fixfreq\",10".to_string()));
    }
}

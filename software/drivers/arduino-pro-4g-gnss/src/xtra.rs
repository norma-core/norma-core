//! gpsOneXTRA assistance: predicted ephemeris injection.
//!
//! Verified on EG25-G firmware R07: the modem needs the XTRA3 file
//! (`xtra3grc.bin`, ~27 KB) — xtra2.bin uploads fine but the injection
//! silently registers zero validity. Flow: `AT+QGPSXTRA=1` (idempotent, no
//! reboot needed), engine off, `AT+QGPSXTRATIME` with host UTC,
//! `AT+QFUPL="RAM:..."` (CONNECT handshake, raw bytes), then
//! `AT+QGPSXTRADATA="RAM:..."`. A good injection reports 10080 minutes
//! (7 days) of validity.

use std::time::Duration;

use log::{info, warn};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio_serial::SerialStream;

use crate::setup::{at_command, at_upload};

const XTRA_HOSTS: [&str; 3] = [
    "xtrapath1.izatcloud.net",
    "xtrapath2.izatcloud.net",
    "xtrapath3.izatcloud.net",
];
const XTRA_FILE: &str = "xtra3grc.bin";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20);
/// Re-inject when less than this much validity remains (the file carries
/// 7 days; half a day of margin keeps reconnects cheap).
const MIN_VALIDITY_MINUTES: u32 = 720;

/// Remaining assistance validity in minutes (0 when XTRA is off or empty).
pub async fn query_validity_minutes(port: &mut BufReader<SerialStream>) -> u32 {
    let enabled = match at_command(port, "AT+QGPSXTRA?").await {
        Ok(lines) => lines.iter().find_map(|l| parse_xtra_enabled(l)).unwrap_or(false),
        Err(_) => false,
    };
    if !enabled {
        return 0;
    }
    match at_command(port, "AT+QGPSXTRADATA?").await {
        Ok(lines) => lines
            .iter()
            .find_map(|l| parse_xtradata_validity_minutes(l))
            .unwrap_or(0),
        Err(_) => 0,
    }
}

/// True when the assistance data is fresh enough to skip injection.
pub fn validity_is_sufficient(minutes: u32) -> bool {
    minutes >= MIN_VALIDITY_MINUTES
}

/// Downloads the XTRA3 file over plain HTTP from the first responding host.
pub async fn download_xtra_file() -> Result<Vec<u8>, String> {
    let mut errors = Vec::new();
    for host in XTRA_HOSTS {
        match tokio::time::timeout(DOWNLOAD_TIMEOUT, fetch_from_host(host)).await {
            Ok(Ok(body)) => {
                info!("Downloaded {XTRA_FILE} from {host} ({} bytes)", body.len());
                return Ok(body);
            }
            Ok(Err(error)) => errors.push(format!("{host}: {error}")),
            Err(_) => errors.push(format!("{host}: timeout")),
        }
    }
    Err(errors.join("; "))
}

async fn fetch_from_host(host: &str) -> Result<Vec<u8>, String> {
    let mut stream = tokio::net::TcpStream::connect((host, 80))
        .await
        .map_err(|e| format!("connect: {e}"))?;
    let request =
        format!("GET /{XTRA_FILE} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("send request: {e}"))?;
    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .await
        .map_err(|e| format!("read response: {e}"))?;
    parse_http_response(&raw)
}

/// Injects host UTC time and the XTRA3 file, returning the validity in
/// minutes the modem reported. The GNSS engine must be off; the caller
/// re-enables it afterwards.
pub async fn inject(
    port: &mut BufReader<SerialStream>,
    file: &[u8],
    unix_now_secs: u64,
) -> Result<u32, String> {
    at_command(port, "AT+QGPSXTRA=1").await?;
    // The XTRA subsystem needs a moment after being switched on before it
    // accepts an injection; without this the data lands but registers zero
    // validity.
    tokio::time::sleep(Duration::from_secs(1)).await;
    at_command(port, &format_xtratime_command(unix_now_secs)).await?;
    // Stale uploads from interrupted runs would make QFUPL fail with
    // "file already existed"; deletion errors are expected on a clean start.
    let delete = format!("AT+QFDEL=\"RAM:{XTRA_FILE}\"");
    if let Err(error) = at_command(port, &delete).await {
        log::debug!("pre-upload {delete}: {error}");
    }
    let upload = format!("AT+QFUPL=\"RAM:{XTRA_FILE}\",{},60", file.len());
    at_upload(port, &upload, file).await?;
    at_command(port, &format!("AT+QGPSXTRADATA=\"RAM:{XTRA_FILE}\"")).await?;

    // The file is processed asynchronously; poll until validity registers.
    let mut validity = 0;
    for _ in 0..6 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        validity = query_validity_minutes(port).await;
        if validity > 0 {
            break;
        }
    }
    if let Err(error) = at_command(port, &delete).await {
        warn!("post-inject {delete}: {error}");
    }
    if validity == 0 {
        return Err("injection accepted but validity is still zero".to_string());
    }
    info!("XTRA assistance injected, valid for {validity} minutes");
    Ok(validity)
}

/// Parses `+QGPSXTRA: <n>` into "XTRA function enabled".
pub fn parse_xtra_enabled(line: &str) -> Option<bool> {
    match line.trim().strip_prefix("+QGPSXTRA: ")?.trim() {
        "0" => Some(false),
        "1" => Some(true),
        _ => None,
    }
}

/// Parses the remaining validity in minutes from
/// `+QGPSXTRADATA: <minutes>,"<injected-at>"`.
pub fn parse_xtradata_validity_minutes(line: &str) -> Option<u32> {
    line.trim()
        .strip_prefix("+QGPSXTRADATA: ")?
        .split(',')
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Formats the UTC time-injection command from a unix timestamp.
pub fn format_xtratime_command(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let secs_of_day = unix_secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "AT+QGPSXTRATIME=0,\"{year:04}/{month:02}/{day:02},{:02}:{:02}:{:02}\",1,1,3500",
        secs_of_day / 3600,
        (secs_of_day / 60) % 60,
        secs_of_day % 60,
    )
}

/// Days since 1970-01-01 to (year, month, day) — Howard Hinnant's
/// civil_from_days algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Splits a raw HTTP/1.0 response into its body, checking for a 200 status.
pub fn parse_http_response(raw: &[u8]) -> Result<Vec<u8>, String> {
    let header_end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("no HTTP header terminator in response")?;
    let status_line = raw[..header_end]
        .split(|&b| b == b'\r')
        .next()
        .and_then(|line| std::str::from_utf8(line).ok())
        .ok_or("unreadable HTTP status line")?;
    let mut parts = status_line.split_whitespace();
    let version = parts.next().unwrap_or_default();
    let status = parts.next().unwrap_or_default();
    if !version.starts_with("HTTP/") {
        return Err(format!("not an HTTP response: {status_line}"));
    }
    if status != "200" {
        return Err(format!("HTTP status {status}"));
    }
    Ok(raw[header_end + 4..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_xtra_enabled_state() {
        assert_eq!(parse_xtra_enabled("+QGPSXTRA: 0"), Some(false));
        assert_eq!(parse_xtra_enabled("\r\n+QGPSXTRA: 1\r\n"), Some(true));
        assert_eq!(parse_xtra_enabled("OK"), None);
    }

    #[test]
    fn parses_xtradata_validity() {
        // Captured verbatim from the EG25-G after a good XTRA3 injection.
        assert_eq!(
            parse_xtradata_validity_minutes("+QGPSXTRADATA: 10080,\"1980/01/05,19:00:00\""),
            Some(10080)
        );
        assert_eq!(
            parse_xtradata_validity_minutes("+QGPSXTRADATA: 0,\"1980/01/05,19:00:00\""),
            Some(0)
        );
        assert_eq!(parse_xtradata_validity_minutes("+CME ERROR: 509"), None);
    }

    #[test]
    fn formats_xtratime_from_unix_timestamp() {
        // 2026-08-16 18:20:30 UTC.
        assert_eq!(
            format_xtratime_command(1786904430),
            "AT+QGPSXTRATIME=0,\"2026/08/16,18:20:30\",1,1,3500"
        );
        // Epoch, leap-year sanity: 2024-02-29 00:00:00 UTC.
        assert_eq!(
            format_xtratime_command(1709164800),
            "AT+QGPSXTRATIME=0,\"2024/02/29,00:00:00\",1,1,3500"
        );
    }

    #[test]
    fn extracts_body_from_http_200() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n\r\n\x01\x02\x03";
        assert_eq!(parse_http_response(raw).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn rejects_non_200_http_responses() {
        let raw = b"HTTP/1.1 404 Not Found\r\n\r\nnope";
        assert!(parse_http_response(raw).is_err());
        assert!(parse_http_response(b"garbage").is_err());
    }
}

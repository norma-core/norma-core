use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use log::{error, info, warn};
use normfs::{NormFS, QueueId, UintN};
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::task::JoinHandle;
use tokio_serial::SerialPortBuilderExt;

use crate::arduino_pro_4g_gnss_proto::{
    ArduinoPro4gGnssDevice, ArduinoPro4gGnssSignalType, RxEnvelope,
};
use crate::discovery::discover_modem_ports;
use crate::nmea::{EpochBatcher, validate_nmea_sentence};
use crate::power;
use crate::setup;

pub const QUEUE_ID: &str = "arduino-pro-4g-gnss/rx";
pub const USB_VID: u16 = 0x2c7c;
pub const USB_PID: u16 = 0x0125;

const SYSFS_TTY_CLASS: &str = "/sys/class/tty";
const SYSFS_PWM_CLASS: &str = "/sys/class/pwm";
const DEV_DIR: &str = "/dev";

/// Baud is nominal — the ports are USB CDC and ignore it.
const SERIAL_BAUD: u32 = 115_200;
const SCAN_INTERVAL: Duration = Duration::from_secs(3);
/// One epoch arrives every 100 ms at 10 Hz (1 s in the mmcli 1 Hz
/// fallback); anything past 3 s means the stream stalled.
const NMEA_READ_TIMEOUT: Duration = Duration::from_secs(3);
/// Consecutive read timeouts before the connection is considered lost and
/// setup re-runs (the engine switches off whenever the modem reboots).
const STALLED_READS_BEFORE_RECONNECT: u32 = 3;
/// A long-lived NMEA stream never re-runs setup on its own, so break out
/// of the read loop this often to let setup re-check XTRA assistance age
/// (capped at one day; the check itself is two quick AT queries).
const XTRA_REVALIDATE_INTERVAL: Duration = Duration::from_secs(6 * 3600);

type DriverResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone)]
pub struct ArduinoPro4gGnssDriverConfig {
    /// NMEA fix rate in Hz applied via AT+QGPSCFG="fixfreq" (1, 2, 5 or 10).
    pub fix_frequency_hz: u32,
    /// Keep gpsOneXTRA predicted-ephemeris assistance fresh (faster fixes
    /// in weak signal; downloads ~27 KB from izatcloud.net when stale).
    pub assistance: bool,
}

impl Default for ArduinoPro4gGnssDriverConfig {
    fn default() -> Self {
        ArduinoPro4gGnssDriverConfig {
            fix_frequency_hz: 10,
            assistance: true,
        }
    }
}

pub struct ArduinoPro4gGnssDriver {
    _tasks: Vec<JoinHandle<()>>,
}

impl ArduinoPro4gGnssDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        config: ArduinoPro4gGnssDriverConfig,
    ) -> DriverResult<Self> {
        let rx_queue_id = normfs.resolve(QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        station_engine.register_queue(&rx_queue_id, QueueDataType::QdtArduinoPro4gGnssRx, vec![]);

        let fix_frequency_hz = match config.fix_frequency_hz {
            f @ (1 | 2 | 5 | 10) => f,
            other => {
                warn!("Arduino Pro 4G GNSS fix-frequency {other} Hz is not one of 1/2/5/10, using 10");
                10
            }
        };

        let task = tokio::spawn(run_worker(normfs, rx_queue_id, fix_frequency_hz, config.assistance));
        info!("Started Arduino Pro 4G GNSS driver ({fix_frequency_hz} Hz)");

        Ok(Self { _tasks: vec![task] })
    }
}

pub async fn start_arduino_pro_4g_gnss_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: ArduinoPro4gGnssDriverConfig,
) -> DriverResult<Arc<ArduinoPro4gGnssDriver>> {
    let driver = ArduinoPro4gGnssDriver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

struct WorkerState {
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    fix_frequency_hz: u32,
    connected: bool,
    last_error: Option<String>,
    nmea_port: String,
    at_port: String,
    /// When this process last injected XTRA assistance; authoritative for
    /// the freshness check because the modem stamp resolves lazily.
    last_xtra_injection_unix: Option<u64>,
}

impl WorkerState {
    fn device_proto(&self) -> ArduinoPro4gGnssDevice {
        ArduinoPro4gGnssDevice {
            id: "usb".to_string(),
            nmea_port: self.nmea_port.clone(),
            at_port: self.at_port.clone(),
            usb_vid: USB_VID as u32,
            usb_pid: USB_PID as u32,
            fix_frequency_hz: self.fix_frequency_hz,
            xtra_injected_at_unix: self.last_xtra_injection_unix.unwrap_or(0),
        }
    }

    fn send_signal(
        &self,
        signal_type: ArduinoPro4gGnssSignalType,
        data: Option<Bytes>,
        error_message: Option<String>,
    ) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: signal_type as i32,
            device: Some(self.device_proto()),
            data: data.unwrap_or_default(),
            xtra_validity_minutes: 0,
            error: error_message.unwrap_or_default(),
        };
        if let Err(error) = send_proto(&self.normfs, &self.rx_queue_id, &envelope) {
            error!("Failed to send Arduino Pro 4G GNSS {signal_type:?} signal: {error}");
        }
    }

    fn publish_epoch(&mut self, sentences: Vec<String>) {
        if !self.connected {
            self.send_signal(ArduinoPro4gGnssSignalType::ArduinoPro4gGnssConnected, None, None);
            self.connected = true;
            self.last_error = None;
        }
        let batch = sentences.join("\n");
        self.send_signal(
            ArduinoPro4gGnssSignalType::ArduinoPro4gGnssNmeaBatch,
            Some(Bytes::from(batch)),
            None,
        );
    }

    fn publish_xtra_injection(&self, injection: setup::XtraInjection) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: ArduinoPro4gGnssSignalType::ArduinoPro4gGnssXtraInjected as i32,
            device: Some(self.device_proto()),
            data: Bytes::from(injection.file),
            xtra_validity_minutes: injection.validity_minutes,
            error: String::new(),
        };
        if let Err(error) = send_proto(&self.normfs, &self.rx_queue_id, &envelope) {
            error!("Failed to record Arduino Pro 4G GNSS XTRA injection: {error}");
        }
    }

    fn note_disconnect(&mut self, error: String) {
        if self.connected {
            self.send_signal(
                ArduinoPro4gGnssSignalType::ArduinoPro4gGnssDisconnected,
                None,
                Some(error.clone()),
            );
            self.connected = false;
        }
        if self.last_error.as_deref() != Some(error.as_str()) {
            self.send_signal(
                ArduinoPro4gGnssSignalType::ArduinoPro4gGnssError,
                None,
                Some(error.clone()),
            );
            self.last_error = Some(error);
        }
    }
}

async fn run_worker(
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    fix_frequency_hz: u32,
    assistance: bool,
) {
    let mut state = WorkerState {
        normfs,
        rx_queue_id,
        fix_frequency_hz,
        connected: false,
        last_error: None,
        nmea_port: String::new(),
        at_port: String::new(),
        last_xtra_injection_unix: None,
    };

    loop {
        let ports = discover_modem_ports(Path::new(SYSFS_TTY_CLASS), Path::new(DEV_DIR));
        let Some(nmea_port) = ports.nmea.clone() else {
            ensure_modem_power(&mut state);
            tokio::time::sleep(SCAN_INTERVAL).await;
            continue;
        };
        state.nmea_port = nmea_port.display().to_string();

        match setup::ensure_gnss_enabled(
            &ports,
            fix_frequency_hz,
            assistance,
            state.last_xtra_injection_unix,
        )
        .await
        {
            Ok(outcome) => {
                state.at_port = outcome.at_port;
                if let Some(injection) = outcome.xtra {
                    state.last_xtra_injection_unix = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .ok();
                    state.publish_xtra_injection(injection);
                }
            }
            Err(error) => {
                // The NMEA stream may still be live (e.g. someone else
                // enabled the engine), so read anyway but surface the error.
                state.at_port = String::new();
                warn!("Arduino Pro 4G GNSS setup failed: {error}");
            }
        }

        match tokio::time::timeout(XTRA_REVALIDATE_INTERVAL, read_nmea_stream(&mut state)).await {
            Ok(Err(error)) => {
                state.note_disconnect(error);
                tokio::time::sleep(SCAN_INTERVAL).await;
            }
            Ok(Ok(())) => tokio::time::sleep(SCAN_INTERVAL).await,
            // Interval elapsed with a healthy stream: loop straight back
            // into setup so stale XTRA assistance gets re-injected.
            Err(_) => {}
        }
    }
}

/// When the modem is missing from USB the usual cause on the Max Carrier is
/// the EN_3V3_PCIE rail being off after a cold power cycle; assert it and
/// let the modem enumerate (takes ~10 s).
fn ensure_modem_power(state: &mut WorkerState) {
    let Some(chip) = power::find_x8h7_pwmchip(Path::new(SYSFS_PWM_CLASS)) else {
        state.note_disconnect("modem not enumerated on USB".to_string());
        return;
    };
    match power::assert_pcie_rail(&chip) {
        Ok(()) => {
            state.note_disconnect(
                "modem not enumerated on USB; asserted EN_3V3_PCIE rail, waiting for it to boot"
                    .to_string(),
            );
        }
        Err(error) => {
            state.note_disconnect(format!(
                "modem not enumerated on USB and EN_3V3_PCIE assert failed: {error}"
            ));
        }
    }
}

async fn read_nmea_stream(state: &mut WorkerState) -> Result<(), String> {
    let port = tokio_serial::new(&state.nmea_port, SERIAL_BAUD)
        .open_native_async()
        .map_err(|e| format!("open {}: {e}", state.nmea_port))?;
    let mut reader = BufReader::new(port);
    let mut line = String::new();
    let mut batcher = EpochBatcher::new();
    let mut stalled_reads = 0u32;

    loop {
        line.clear();
        match tokio::time::timeout(NMEA_READ_TIMEOUT, reader.read_line(&mut line)).await {
            Ok(Ok(0)) => return Err(format!("{}: NMEA port closed", state.nmea_port)),
            Ok(Ok(_)) => {
                stalled_reads = 0;
                let sentence = line.trim();
                if sentence.is_empty() {
                    continue;
                }
                if !validate_nmea_sentence(sentence) {
                    continue;
                }
                if let Some(epoch) = batcher.push(sentence) {
                    state.publish_epoch(epoch);
                }
            }
            Ok(Err(error)) => return Err(format!("read {}: {error}", state.nmea_port)),
            Err(_) => {
                if let Some(epoch) = batcher.flush() {
                    state.publish_epoch(epoch);
                }
                stalled_reads += 1;
                if stalled_reads >= STALLED_READS_BEFORE_RECONNECT {
                    return Err(format!(
                        "{}: no NMEA sentences for {:?}",
                        state.nmea_port,
                        NMEA_READ_TIMEOUT * stalled_reads
                    ));
                }
            }
        }
    }
}

fn send_proto<M: Message>(normfs: &NormFS, queue_id: &QueueId, envelope: &M) -> DriverResult<UintN> {
    let mut buffer = Vec::new();
    envelope.encode(&mut buffer)?;
    Ok(normfs.enqueue(queue_id, Bytes::from(buffer))?)
}

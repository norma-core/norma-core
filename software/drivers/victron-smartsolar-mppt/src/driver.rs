use crate::port::{ProbeErrorKind, VictronPort, VictronProbeError};
use crate::victron_smartsolar_mppt_proto::VictronDevice;
use log::{debug, error, info, warn};
use normfs::NormFS;
use station_iface::StationEngine;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, watch};
use tokio::task::JoinHandle;
use tokio::time::interval;
use tokio_serial::{SerialPortInfo, SerialPortType, available_ports};

pub const QUEUE_PREFIX: &str = "victron-smartsolar-mppt";
pub const DEFAULT_READ_TIMEOUT: Duration = Duration::from_secs(10);

const PORT_BAUD_RATE: u32 = 19_200;
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const HEX_POLL_INTERVAL: Duration = Duration::from_secs(1);

const REJECT_COOLDOWN: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsbMatch {
    pub vid: u16,
    pub pid: u16,
}

const DEFAULT_USB_MATCHES: &[UsbMatch] = &[UsbMatch {
    vid: 0x0403,
    pid: 0x6015,
}];

#[derive(Debug, Clone)]
pub struct VictronSmartSolarMpptDriverConfig {
    pub read_timeout: Duration,
}

impl Default for VictronSmartSolarMpptDriverConfig {
    fn default() -> Self {
        Self {
            read_timeout: DEFAULT_READ_TIMEOUT,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PortParams {
    pub read_timeout: Duration,
    pub probe_timeout: Duration,
    pub known_cable: bool,
}

pub struct VictronSmartSolarMpptDriver {
    shutdown: watch::Sender<bool>,
    worker: JoinHandle<()>,
}

impl VictronSmartSolarMpptDriver {
    pub async fn stop(self) {
        let _ = self.shutdown.send(true);
        if let Err(err) = self.worker.await {
            warn!("Victron SmartSolar MPPT scan task failed during shutdown: {err}");
        }
    }
}

impl VictronSmartSolarMpptDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        mut config: VictronSmartSolarMpptDriverConfig,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        if config.read_timeout.is_zero() {
            warn!(
                "Victron SmartSolar MPPT read-timeout is zero, using {:?}",
                DEFAULT_READ_TIMEOUT
            );
            config.read_timeout = DEFAULT_READ_TIMEOUT;
        }

        info!(
            "Victron SmartSolar MPPT scanning USB serial ports ({} match rule(s))",
            DEFAULT_USB_MATCHES.len()
        );
        let (shutdown, shutdown_rx) = watch::channel(false);
        let worker = tokio::spawn(run_scan_loop(
            normfs.clone(),
            station_engine,
            config,
            shutdown_rx,
        ));

        Ok(Self { shutdown, worker })
    }
}

pub(crate) fn device_rx_queue_path(device: &VictronDevice) -> String {
    let key = [
        device.device_serial.as_str(),
        device.serial_number.as_str(),
        device.port_name.as_str(),
    ]
    .into_iter()
    .find(|candidate| !candidate.is_empty())
    .unwrap_or("unknown");

    let key: String = key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();

    format!("{QUEUE_PREFIX}/{key}/rx")
}

pub async fn start_victron_smartsolar_mppt_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: VictronSmartSolarMpptDriverConfig,
) -> Result<VictronSmartSolarMpptDriver, Box<dyn std::error::Error>> {
    VictronSmartSolarMpptDriver::new(normfs, station_engine, config).await
}

async fn run_scan_loop<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: VictronSmartSolarMpptDriverConfig,
    mut shutdown: watch::Receiver<bool>,
) {
    let base_params = PortParams {
        read_timeout: config.read_timeout,
        probe_timeout: PROBE_TIMEOUT,
        known_cable: false,
    };

    let managed: Arc<RwLock<HashSet<String>>> = Arc::new(RwLock::new(HashSet::new()));
    let rejected: Arc<RwLock<HashMap<String, Instant>>> = Arc::new(RwLock::new(HashMap::new()));
    let mut scan = interval(Duration::from_secs(1));
    let mut port_tasks: Vec<JoinHandle<()>> = Vec::new();

    loop {
        tokio::select! {
            _ = scan.tick() => {}
            _ = shutdown.changed() => break,
        }

        if *shutdown.borrow() {
            break;
        }

        port_tasks.retain(|task| !task.is_finished());

        let ports = match available_ports() {
            Ok(ports) => ports,
            Err(err) => {
                error!("Failed to scan serial ports: {}", err);
                continue;
            }
        };

        prune_cooldowns(&rejected).await;

        for port_info in ports {
            if !is_victron_device(&port_info) || !can_use_port(&port_info) {
                continue;
            }

            let port_name = port_info.port_name.clone();
            if managed.read().await.contains(&port_name) {
                continue;
            }
            if is_in_cooldown(&rejected, &port_name).await {
                continue;
            }

            let known_cable = is_victron_cable(&port_info);
            let device = create_device(&port_info);
            info!(
                "New Victron SmartSolar MPPT USB candidate detected on {}{}",
                port_name,
                if known_cable {
                    " (genuine VE.Direct cable; waiting for charger data)"
                } else {
                    ""
                }
            );
            managed.write().await.insert(port_name.clone());

            let mut params = base_params;
            params.known_cable = known_cable;

            let normfs = normfs.clone();
            let station_engine = station_engine.clone();
            let managed = managed.clone();
            let rejected = rejected.clone();
            let port_shutdown = shutdown.clone();
            port_tasks.push(tokio::spawn(async move {
                let port = VictronPort::new(normfs, station_engine, device, params, port_shutdown);
                match port.open().await {
                    Ok(()) => {
                        info!(
                            "Victron SmartSolar MPPT port {} disconnected and removed from management",
                            port_name
                        );
                    }
                    Err(err) => {
                        if let Some(probe_err) = err.downcast_ref::<VictronProbeError>() {
                            let cooldown = match (probe_err.kind, known_cable) {
                                (ProbeErrorKind::Silent, true) => None,
                                _ => Some(REJECT_COOLDOWN),
                            };
                            debug!(
                                "Port {} rejected by Victron SmartSolar MPPT probe: {}",
                                port_name, err
                            );
                            if let Some(cooldown) = cooldown {
                                rejected
                                    .write()
                                    .await
                                    .insert(port_name.clone(), Instant::now() + cooldown);
                            }
                        } else {
                            warn!(
                                "Failed to open Victron SmartSolar MPPT port {}: {}",
                                port_name, err
                            );
                            rejected
                                .write()
                                .await
                                .insert(port_name.clone(), Instant::now() + REJECT_COOLDOWN);
                        }
                    }
                }
                managed.write().await.remove(&port_name);
            }));
        }
    }

    info!("Victron SmartSolar MPPT scan loop stopping, waiting for {} port task(s)", port_tasks.len());
    for task in port_tasks {
        if let Err(err) = task.await {
            warn!("Victron SmartSolar MPPT port task failed during shutdown: {err}");
        }
    }
}

async fn prune_cooldowns(rejected: &RwLock<HashMap<String, Instant>>) {
    let now = Instant::now();
    rejected.write().await.retain(|_, expiry| *expiry > now);
}

async fn is_in_cooldown(rejected: &RwLock<HashMap<String, Instant>>, port_name: &str) -> bool {
    let guard = rejected.read().await;
    match guard.get(port_name) {
        Some(expiry) => *expiry > Instant::now(),
        None => false,
    }
}

fn is_victron_device(port_info: &SerialPortInfo) -> bool {
    match &port_info.port_type {
        SerialPortType::UsbPort(usb) => DEFAULT_USB_MATCHES
            .iter()
            .any(|rule| rule.vid == usb.vid && rule.pid == usb.pid),
        _ => false,
    }
}

fn is_victron_cable(port_info: &SerialPortInfo) -> bool {
    match &port_info.port_type {
        SerialPortType::UsbPort(usb) => {
            let product = usb.product.as_deref().unwrap_or_default().to_ascii_lowercase();
            let manufacturer = usb
                .manufacturer
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase();
            product.contains("ve direct") || manufacturer.contains("victron")
        }
        _ => false,
    }
}

fn can_use_port(port_info: &SerialPortInfo) -> bool {
    if let SerialPortType::UsbPort(_) = &port_info.port_type {
        #[cfg(target_os = "macos")]
        {
            if port_info.port_name.starts_with("/dev/cu.") {
                return false;
            }
        }
        true
    } else {
        false
    }
}

fn create_device(port_info: &SerialPortInfo) -> VictronDevice {
    let (vid, pid, serial_number, manufacturer, product) = match &port_info.port_type {
        SerialPortType::UsbPort(usb) => (
            usb.vid as u32,
            usb.pid as u32,
            usb.serial_number.clone().unwrap_or_default(),
            usb.manufacturer.clone().unwrap_or_default(),
            usb.product.clone().unwrap_or_default(),
        ),
        _ => (0, 0, String::new(), String::new(), String::new()),
    };

    VictronDevice {
        port_name: port_info.port_name.clone(),
        vid,
        pid,
        serial_number,
        manufacturer,
        product,
        port_baud_rate: PORT_BAUD_RATE,
        ..Default::default()
    }
}

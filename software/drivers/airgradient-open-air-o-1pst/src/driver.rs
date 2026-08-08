use crate::airgradient_open_air_o_1pst_proto::AirGradientDevice;
use crate::port::AirGradientPort;
use log::{error, info, warn};
use normfs::NormFS;
use station_iface::StationEngine;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio::time::interval;
use tokio_serial::{SerialPortInfo, SerialPortType, available_ports};

pub const QUEUE_PREFIX: &str = "airgradient-open-air-o-1pst";
pub const DEFAULT_READ_TIMEOUT: Duration = Duration::from_secs(10);

const PORT_BAUD_RATE: u32 = 115_200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsbMatch {
    pub vid: u16,
    pub pid: u16,
}

const DEFAULT_USB_MATCHES: &[UsbMatch] = &[
    UsbMatch {
        vid: 0x303A,
        pid: 0x1001,
    },
    UsbMatch {
        vid: 0x1A86,
        pid: 0x7523,
    },
];

#[derive(Debug, Clone)]
pub struct AirGradientOpenAirO1pstDriverConfig {
    pub read_timeout: Duration,
}

impl Default for AirGradientOpenAirO1pstDriverConfig {
    fn default() -> Self {
        Self {
            read_timeout: DEFAULT_READ_TIMEOUT,
        }
    }
}

pub struct AirGradientOpenAirO1pstDriver {
    _worker: JoinHandle<()>,
}

impl AirGradientOpenAirO1pstDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        mut config: AirGradientOpenAirO1pstDriverConfig,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        if config.read_timeout.is_zero() {
            warn!(
                "AirGradient Open Air O-1PST read timeout is zero, using {:?}",
                DEFAULT_READ_TIMEOUT
            );
            config.read_timeout = DEFAULT_READ_TIMEOUT;
        }

        info!(
            "AirGradient Open Air O-1PST scanning USB serial ports ({} match rule(s))",
            DEFAULT_USB_MATCHES.len()
        );
        let worker = tokio::spawn(run_scan_loop(
            normfs.clone(),
            station_engine,
            config.read_timeout,
        ));

        Ok(Self { _worker: worker })
    }
}

pub(crate) fn device_rx_queue_path(device: &AirGradientDevice) -> String {
    let key = [
        device.device_id.as_str(),
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

pub async fn start_airgradient_open_air_o_1pst_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: AirGradientOpenAirO1pstDriverConfig,
) -> Result<Arc<AirGradientOpenAirO1pstDriver>, Box<dyn std::error::Error>> {
    let driver = AirGradientOpenAirO1pstDriver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

async fn run_scan_loop<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    read_timeout: Duration,
) {
    let managed: Arc<RwLock<HashSet<String>>> = Arc::new(RwLock::new(HashSet::new()));
    let mut scan = interval(Duration::from_secs(1));

    loop {
        scan.tick().await;

        let ports = match available_ports() {
            Ok(ports) => ports,
            Err(err) => {
                error!("Failed to scan serial ports: {}", err);
                continue;
            }
        };

        for port_info in ports {
            if !is_airgradient_device(&port_info) || !can_use_port(&port_info) {
                continue;
            }

            let port_name = port_info.port_name.clone();
            if managed.read().await.contains(&port_name) {
                continue;
            }

            let device = create_device(&port_info);
            info!("New AirGradient Open Air O-1PST USB candidate detected on {}", port_name);
            managed.write().await.insert(port_name.clone());

            let normfs = normfs.clone();
            let station_engine = station_engine.clone();
            let managed = managed.clone();
            tokio::spawn(async move {
                let port = AirGradientPort::new(normfs, station_engine, device, read_timeout);
                if let Err(err) = port.open().await {
                    warn!("Failed to open AirGradient Open Air O-1PST port {}: {}", port_name, err);
                }
                managed.write().await.remove(&port_name);
                info!(
                    "AirGradient Open Air O-1PST port {} disconnected and removed from management",
                    port_name
                );
            });
        }
    }
}

fn is_airgradient_device(port_info: &SerialPortInfo) -> bool {
    match &port_info.port_type {
        SerialPortType::UsbPort(usb) => DEFAULT_USB_MATCHES
            .iter()
            .any(|rule| rule.vid == usb.vid && rule.pid == usb.pid),
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

fn create_device(port_info: &SerialPortInfo) -> AirGradientDevice {
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

    AirGradientDevice {
        port_name: port_info.port_name.clone(),
        vid,
        pid,
        serial_number,
        manufacturer,
        product,
        port_baud_rate: PORT_BAUD_RATE,
        device_id: String::new(),
    }
}

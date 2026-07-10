use crate::airgradient_open_air_o_1pst_proto::AirGradientDevice;
use crate::port::AirGradientPort;
use log::{error, info, warn};
use normfs::{NormFS, QueueId};
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio::time::{MissedTickBehavior, interval};
use tokio_serial::{SerialPortInfo, SerialPortType, available_ports};

pub const RX_QUEUE_ID: &str = "airgradient-open-air-o-1pst/rx";
pub const DEFAULT_PORT_BAUD_RATE: u32 = 115_200;
pub const DEFAULT_READ_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsbMatch {
    pub vid: u16,
    pub pid: u16,
}

pub const DEFAULT_USB_MATCHES: &[UsbMatch] = &[
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
    pub port: Option<String>,
    pub port_baud_rate: u32,
    pub usb_matches: Vec<UsbMatch>,
    pub read_timeout: Duration,
}

impl Default for AirGradientOpenAirO1pstDriverConfig {
    fn default() -> Self {
        Self {
            port: None,
            port_baud_rate: DEFAULT_PORT_BAUD_RATE,
            usb_matches: DEFAULT_USB_MATCHES.to_vec(),
            read_timeout: DEFAULT_READ_TIMEOUT,
        }
    }
}

pub fn parse_usb_match(spec: &str) -> Option<UsbMatch> {
    let (vid, pid) = spec.trim().split_once(':')?;
    Some(UsbMatch {
        vid: parse_hex_u16(vid)?,
        pid: parse_hex_u16(pid)?,
    })
}

fn parse_hex_u16(value: &str) -> Option<u16> {
    let trimmed = value.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    u16::from_str_radix(hex, 16).ok()
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
        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        station_engine.register_queue(
            &rx_queue_id,
            QueueDataType::QdtAirgradientOpenAirO1pstRx,
            vec![],
        );

        if config.usb_matches.is_empty() {
            config.usb_matches = DEFAULT_USB_MATCHES.to_vec();
        }
        let read_timeout = if config.read_timeout.is_zero() {
            warn!(
                "AirGradient Open Air O-1PST read timeout is zero, using {:?}",
                DEFAULT_READ_TIMEOUT
            );
            DEFAULT_READ_TIMEOUT
        } else {
            config.read_timeout
        };

        let worker = if let Some(port_path) = config.port.clone() {
            info!("AirGradient Open Air O-1PST using explicit serial port {}", port_path);
            tokio::spawn(run_explicit_port(
                normfs.clone(),
                rx_queue_id,
                port_path,
                config.port_baud_rate,
                read_timeout,
            ))
        } else {
            info!(
                "AirGradient Open Air O-1PST scanning USB serial ports ({} match rule(s))",
                config.usb_matches.len()
            );
            tokio::spawn(run_scan_loop(
                normfs.clone(),
                rx_queue_id,
                config.usb_matches.clone(),
                config.port_baud_rate,
                read_timeout,
            ))
        };

        Ok(Self { _worker: worker })
    }
}

pub async fn start_airgradient_open_air_o_1pst_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: AirGradientOpenAirO1pstDriverConfig,
) -> Result<Arc<AirGradientOpenAirO1pstDriver>, Box<dyn std::error::Error>> {
    let driver = AirGradientOpenAirO1pstDriver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

async fn run_explicit_port(
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    port_path: String,
    baud: u32,
    read_timeout: Duration,
) {
    let mut retry = interval(Duration::from_secs(1));
    retry.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        retry.tick().await;

        let device = AirGradientDevice {
            port_name: port_path.clone(),
            port_baud_rate: baud,
            ..Default::default()
        };
        let port = AirGradientPort::new(normfs.clone(), rx_queue_id.clone(), device, read_timeout);
        if let Err(err) = port.open().await {
            warn!("Failed to open AirGradient Open Air O-1PST port {}: {}", port_path, err);
        }
    }
}

async fn run_scan_loop(
    normfs: Arc<NormFS>,
    rx_queue_id: QueueId,
    usb_matches: Vec<UsbMatch>,
    baud: u32,
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
            if !is_airgradient_device(&port_info, &usb_matches) || !can_use_port(&port_info) {
                continue;
            }

            let port_name = port_info.port_name.clone();
            if managed.read().await.contains(&port_name) {
                continue;
            }

            let device = create_device(&port_info, baud);
            info!("New AirGradient Open Air O-1PST USB candidate detected on {}", port_name);
            managed.write().await.insert(port_name.clone());

            let normfs = normfs.clone();
            let rx_queue_id = rx_queue_id.clone();
            let managed = managed.clone();
            tokio::spawn(async move {
                let port = AirGradientPort::new(normfs, rx_queue_id, device, read_timeout);
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

fn is_airgradient_device(port_info: &SerialPortInfo, usb_matches: &[UsbMatch]) -> bool {
    match &port_info.port_type {
        SerialPortType::UsbPort(usb) => usb_matches
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

fn create_device(port_info: &SerialPortInfo, baud: u32) -> AirGradientDevice {
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
        port_baud_rate: baud,
    }
}

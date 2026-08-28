use crate::port::{VescTrampaPort, VescTrampaProbeError};
use crate::state::VescTrampaCommunicator;
use crate::vesc_trampa_proto::{Command, TxEnvelope, VescTrampaBoard as VescTrampaBoardProto};
use log::{debug, error, info, warn};
use normfs::NormFS;
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::{commands, drivers};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::interval;
use tokio_serial::{SerialPortInfo, SerialPortType, available_ports};

pub const RX_QUEUE_ID: &str = "vesc-trampa/rx";
pub const TX_QUEUE_ID: &str = "vesc-trampa/tx";
pub const INFERENCE_QUEUE_ID: &str = "vesc-trampa/inference";

#[derive(Debug, Clone)]
pub struct VescTrampaDriverConfig {
    pub port_baud_rate: u32,
}

impl Default for VescTrampaDriverConfig {
    fn default() -> Self {
        Self {
            port_baud_rate: crate::protocol::DEFAULT_BAUD_RATE,
        }
    }
}

pub struct VescTrampaDriver {
    com: Arc<VescTrampaCommunicator>,
    ports: Arc<RwLock<HashSet<String>>>,
    config: VescTrampaDriverConfig,
}

impl VescTrampaDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        config: VescTrampaDriverConfig,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);
        let tx_queue_id = normfs.resolve(TX_QUEUE_ID);
        let inference_queue_id = normfs.resolve(INFERENCE_QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&tx_queue_id).await?;
        normfs
            .ensure_queue_exists_for_write(&inference_queue_id)
            .await?;
        station_engine.register_queue(
            &rx_queue_id,
            drivers::QueueDataType::QdtVescTrampaSerialRx,
            vec![],
        );
        station_engine.register_queue(
            &tx_queue_id,
            drivers::QueueDataType::QdtVescTrampaSerialTx,
            vec![],
        );
        station_engine.register_queue(
            &inference_queue_id,
            drivers::QueueDataType::QdtVescTrampaInference,
            vec![],
        );

        let com = Arc::new(VescTrampaCommunicator::new(
            normfs.clone(),
            rx_queue_id,
            tx_queue_id,
            inference_queue_id,
        ));

        let com4commands = com.clone();
        let commands_queue_id = normfs.resolve("commands");
        normfs.subscribe(
            &commands_queue_id,
            Box::new(move |entries: &[(normfs::UintN, bytes::Bytes)]| {
                for (_, data) in entries {
                    if let Ok(pack) = commands::StationCommandsPack::decode(data.as_ref()) {
                        for cmd in &pack.commands {
                            if cmd.r#type() != drivers::StationCommandType::StcVescTrampaCommand {
                                continue;
                            }

                            let command = match Command::decode(cmd.body.clone()) {
                                Ok(command) => command,
                                Err(error) => {
                                    error!("Failed to decode VESC Trampa command: {}", error);
                                    continue;
                                }
                            };

                            let envelope = TxEnvelope {
                                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                                local_stamp_ns: systime::get_local_stamp_ns(),
                                app_start_id: systime::get_app_start_id(),
                                target_board_uuid: command.target_board_uuid,
                                command_id: cmd.command_id.clone(),
                                board_commands: command.board_commands,
                                motor_mode: command.motor_mode,
                            };

                            if let Err(error) = com4commands.send_tx(&envelope) {
                                error!("Failed to send VESC Trampa command to tx queue: {}", error);
                            }
                        }
                    }
                }
                true
            }),
        )?;

        let driver = Self {
            com,
            ports: Arc::new(RwLock::new(HashSet::new())),
            config,
        };

        driver.start_worker();
        Ok(driver)
    }

    fn start_worker(&self) {
        let com = self.com.clone();
        let ports = self.ports.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            let mut scan_interval = interval(Duration::from_secs(1));
            loop {
                Self::scan_and_update_ports(&com, &ports, &config).await;
                scan_interval.tick().await;
            }
        });
    }

    async fn scan_and_update_ports(
        com: &Arc<VescTrampaCommunicator>,
        ports: &Arc<RwLock<HashSet<String>>>,
        config: &VescTrampaDriverConfig,
    ) {
        match available_ports() {
            Ok(found_ports) => {
                let vesc_ports: Vec<SerialPortInfo> = found_ports
                    .into_iter()
                    .filter(|port| Self::is_vesc_trampa_device(port) && Self::can_use_port(port))
                    .collect();

                let mut ports_guard = ports.write().await;

                for port_info in vesc_ports {
                    let port_name = port_info.port_name.clone();

                    if !ports_guard.contains(&port_name) {
                        let board_info = Self::create_board_info(&port_info, config);
                        info!(
                            "New VESC Trampa USB candidate detected: {} ({})",
                            board_info.serial_number, board_info.port_name
                        );

                        let mut port =
                            VescTrampaPort::new(port_info.clone(), com.clone(), board_info.clone());

                        ports_guard.insert(port_name.clone());

                        let ports_clone = ports.clone();
                        tokio::spawn(async move {
                            let probe_failed = match port.open().await {
                                Ok(()) => false,
                                Err(error)
                                    if error.downcast_ref::<VescTrampaProbeError>().is_some() =>
                                {
                                    debug!(
                                        "Ignoring non-VESC Trampa serial candidate {}: {}",
                                        port_name, error
                                    );
                                    true
                                }
                                Err(error) => {
                                    warn!(
                                        "Failed to open VESC Trampa port {}: {}",
                                        port_name, error
                                    );
                                    false
                                }
                            };

                            ports_clone.write().await.remove(&port_name);
                            if !probe_failed {
                                info!(
                                    "VESC Trampa port {} disconnected and removed from management",
                                    port_name
                                );
                            }
                        });
                    }
                }
            }
            Err(error) => {
                error!("Failed to scan serial ports: {}", error);
            }
        }
    }

    fn is_vesc_trampa_device(port_info: &SerialPortInfo) -> bool {
        match &port_info.port_type {
            SerialPortType::UsbPort(usb_info) => {
                crate::protocol::is_vesc_trampa_usbdevice(usb_info.vid, usb_info.pid)
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

    fn create_board_info(
        port_info: &SerialPortInfo,
        config: &VescTrampaDriverConfig,
    ) -> VescTrampaBoardProto {
        let (vid, pid, serial_number, manufacturer, product) = match &port_info.port_type {
            SerialPortType::UsbPort(usb_info) => (
                usb_info.vid as u32,
                usb_info.pid as u32,
                usb_info.serial_number.clone().unwrap_or_default(),
                usb_info.manufacturer.clone().unwrap_or_default(),
                usb_info.product.clone().unwrap_or_default(),
            ),
            _ => (0, 0, String::new(), String::new(), String::new()),
        };

        VescTrampaBoardProto {
            port_name: port_info.port_name.clone(),
            vid,
            pid,
            serial_number,
            manufacturer,
            product,
            port_baud_rate: config.port_baud_rate,
            ..Default::default()
        }
    }
}

pub async fn start_vesc_trampa_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    config: VescTrampaDriverConfig,
) -> Result<Arc<VescTrampaDriver>, Box<dyn std::error::Error>> {
    let driver = VescTrampaDriver::new(normfs, station_engine, config).await?;
    Ok(Arc::new(driver))
}

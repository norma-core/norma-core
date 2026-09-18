use super::port::St3215Port;
use super::state::ST3215BusCommunicator;
use crate::protocol;
use crate::st3215_proto::{
    Command, RxEnvelope, St3215Bus as St3215BusProto, St3215SignalType, TxEnvelope,
};
use log::{debug, error, info, warn};
use normfs::NormFS;
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::commands;
use station_iface::iface_proto::drivers::{self, QueueDataType};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::interval;
use tokio_serial::{SerialPortInfo, SerialPortType, available_ports};

pub const RX_QUEUE_ID: &str = "st3215/rx";
pub const TX_QUEUE_ID: &str = "st3215/tx";
pub const META_QUEUE_ID: &str = "st3215/meta";
pub const INFERENCE_QUEUE_ID: &str = "st3215/inference";

pub struct St3215Driver {
    com: Arc<ST3215BusCommunicator>,
    ports: Arc<RwLock<HashSet<String>>>,
}

impl St3215Driver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let ports = Arc::new(RwLock::new(HashSet::new()));

        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);
        let tx_queue_id = normfs.resolve(TX_QUEUE_ID);
        let meta_queue_id = normfs.resolve(META_QUEUE_ID);
        let inference_queue_id = normfs.resolve(INFERENCE_QUEUE_ID);

        let com = Arc::new(
            ST3215BusCommunicator::new(
                normfs.clone(),
                rx_queue_id.clone(),
                tx_queue_id.clone(),
                meta_queue_id.clone(),
                inference_queue_id.clone(),
            )
            .await?,
        );

        station_engine.register_queue(
            &rx_queue_id,
            drivers::QueueDataType::QdtSt3215SerialRx,
            vec![],
        );
        station_engine.register_queue(&tx_queue_id, QueueDataType::QdtSt3215SerialTx, vec![]);
        station_engine.register_queue(&meta_queue_id, QueueDataType::QdtSt3215Meta, vec![]);
        station_engine.register_queue(
            &inference_queue_id,
            QueueDataType::QdtSt3215Inference,
            vec![],
        );

        let com4commands = com.clone();
        let commands_queue_id = normfs.resolve("commands");
        normfs.subscribe(
            &commands_queue_id,
            Box::new(move |entries: &[(normfs::UintN, bytes::Bytes)]| {
                for (_, data) in entries {
                    if let Ok(pack) = commands::StationCommandsPack::decode(data.as_ref()) {
                        log::debug!("Received command: {:?}", pack.pack_id);
                        for cmd in &pack.commands {
                            if cmd.r#type() != drivers::StationCommandType::StcSt3215Command {
                                continue;
                            }

                            let command = Command::decode(cmd.body.clone()).map_err(|e| {
                                error!("Failed to decode ST3215 command: {}", e);
                            });
                            if command.is_err() {
                                continue;
                            }
                            let command = command.unwrap();

                            let envelope = TxEnvelope {
                                command_id: cmd.command_id.clone(),
                                monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                                local_stamp_ns: systime::get_local_stamp_ns(),
                                app_start_id: systime::get_app_start_id(),
                                target_bus_serial: command.target_bus_serial,
                                action: command.action,
                                write: command.write,
                                reg_write: command.reg_write,
                                reset: command.reset,
                                reset_calibration: command.reset_calibration,
                                freeze_calibration: command.freeze_calibration,
                                auto_calibrate: command.auto_calibrate,
                                stop_auto_calibrate: command.stop_auto_calibrate,
                                sync_write: command.sync_write,
                            };

                            com4commands.send_tx(&envelope);
                        }
                    }
                }
                true
            }),
        )?;

        info!("Started ST3215 bus");

        let bus = Self {
            com,
            ports: ports.clone(),
        };

        bus.start_worker();
        Ok(bus)
    }

    fn start_worker(&self) {
        let ports = self.ports.clone();
        let com = self.com.clone();

        tokio::spawn(async move {
            let mut scan_interval = interval(Duration::from_secs(1));
            loop {
                Self::scan_and_update_ports(&com, &ports).await;
                scan_interval.tick().await;
            }
        });
    }

    async fn scan_and_update_ports(
        com: &Arc<ST3215BusCommunicator>,
        ports: &Arc<RwLock<HashSet<String>>>,
    ) {
        match available_ports() {
            Ok(found_ports) => {
                let st3215_ports: Vec<SerialPortInfo> = found_ports
                    .into_iter()
                    .filter(|port| Self::is_st3215_device(port) && Self::can_use_port(port))
                    .collect();

                // The lock must not be held across the awaits below.
                let known = ports.read().await.clone();

                for port_info in st3215_ports {
                    let port_name = port_info.port_name.clone();

                    if !known.contains(&port_name) {
                        info!("New ST3215 port detected: {}", port_name);
                        let bus_info = Self::create_bus_info(&port_info);

                        match St3215Port::new(port_info.clone(), com.clone(), bus_info.clone())
                            .await
                        {
                            Ok(mut port) => {
                                Self::send_bus_connect_signal(com, &bus_info).await;
                                ports.write().await.insert(port_name.clone());
                                info!("Added ST3215 port to management: {}", port_name);

                                let port_name_clone = port_name.clone();
                                let bus_info_clone = bus_info.clone();
                                let ports_clone = ports.clone();
                                let com_clone = com.clone();

                                debug!("Spawning worker for ST3215 port: {}", port_name_clone);
                                tokio::spawn(async move {
                                    debug!(
                                        "Worker task started for ST3215 port: {}",
                                        port_name_clone
                                    );

                                    debug!("Opening port: {}", port_name_clone);
                                    match port.open().await {
                                        Ok(_) => {
                                            Self::send_bus_disconnect_signal(
                                                &com_clone,
                                                &bus_info_clone,
                                            )
                                            .await;
                                        }
                                        Err(e) => {
                                            warn!(
                                                "Failed to open ST3215 port {}: {}",
                                                port_name_clone, e
                                            );
                                        }
                                    }

                                    ports_clone.write().await.remove(&port_name_clone);
                                    info!(
                                        "ST3215 port {} disconnected and removed from management",
                                        port_name_clone
                                    );
                                });
                            }
                            Err(e) => {
                                error!("Failed to create ST3215 port {}: {}", port_name, e);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error!("Failed to scan serial ports: {}", e);
            }
        }
    }

    fn is_st3215_device(port_info: &SerialPortInfo) -> bool {
        match &port_info.port_type {
            SerialPortType::UsbPort(usb_info) => {
                protocol::is_st3215_usbdevice(usb_info.vid, usb_info.pid)
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

    fn create_bus_info(port_info: &SerialPortInfo) -> St3215BusProto {
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

        St3215BusProto {
            port_name: port_info.port_name.clone(),
            vid,
            pid,
            serial_number,
            manufacturer,
            product,
            port_baud_rate: protocol::SUPPORTED_BAUD_RATES[0],
        }
    }

    async fn send_bus_connect_signal(comm: &ST3215BusCommunicator, bus_info: &St3215BusProto) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: St3215SignalType::St3215BusConnect as i32,
            bus: Some(bus_info.clone()),
            ..Default::default()
        };

        if let Err(e) = comm.send_rx(&envelope).await {
            error!("Failed to send ST3215 bus connect signal: {}", e);
        }
    }

    async fn send_bus_disconnect_signal(comm: &ST3215BusCommunicator, bus_info: &St3215BusProto) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: St3215SignalType::St3215BusDisconnect as i32,
            bus: Some(bus_info.clone()),
            ..Default::default()
        };

        if let Err(e) = comm.send_rx(&envelope).await {
            error!("Failed to send ST3215 bus disconnect signal: {}", e);
        }
    }
}

pub async fn start_st3215_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
) -> Result<Arc<St3215Driver>, Box<dyn std::error::Error>> {
    let bus = St3215Driver::new(normfs, station_engine).await?;
    Ok(Arc::new(bus))
}

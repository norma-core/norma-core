use crate::dogzilla_proto::{
    Command, DogzillaDevice, DogzillaModel, DogzillaSignalType, RxEnvelope, TxEnvelope,
};
use crate::port::DogzillaPort;
use crate::protocol::{BAUD_RATE, RPI_UART_PORT};
use crate::sim::DogzillaSimulator;
use crate::state::DogzillaCommunicator;
use log::{error, info, warn};
use normfs::NormFS;
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::commands;
use station_iface::iface_proto::drivers::{self, QueueDataType};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const RX_QUEUE_ID: &str = "dogzilla/rx";
const TX_QUEUE_ID: &str = "dogzilla/tx";
const INFERENCE_QUEUE_ID: &str = "dogzilla/inference";
const SIM_PORT_NAME: &str = "dogzilla-sim";
const DETECTION_RETRY_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ConnectionAttempt {
    Connected,
    PortMissing,
    NotDetected,
}

pub struct DogzillaDriver {
    _com: Arc<DogzillaCommunicator>,
    _connected_port: Arc<RwLock<Option<String>>>,
}

impl DogzillaDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
        simulation: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let connected_port = Arc::new(RwLock::new(None));
        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);
        let tx_queue_id = normfs.resolve(TX_QUEUE_ID);
        let inference_queue_id = normfs.resolve(INFERENCE_QUEUE_ID);

        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&tx_queue_id).await?;
        normfs
            .ensure_queue_exists_for_write(&inference_queue_id)
            .await?;

        station_engine.register_queue(&rx_queue_id, QueueDataType::QdtDogzillaSerialRx, vec![]);
        station_engine.register_queue(&tx_queue_id, QueueDataType::QdtDogzillaSerialTx, vec![]);
        station_engine.register_queue(
            &inference_queue_id,
            QueueDataType::QdtDogzillaInference,
            vec![],
        );

        let com = Arc::new(DogzillaCommunicator::new(
            normfs.clone(),
            rx_queue_id,
            tx_queue_id.clone(),
            inference_queue_id,
        ));

        let com_for_commands = com.clone();
        let commands_queue_id = normfs.resolve("commands");
        normfs.subscribe(
            &commands_queue_id,
            Box::new(move |entries: &[(normfs::UintN, bytes::Bytes)]| {
                for (_, data) in entries {
                    let Ok(pack) = commands::StationCommandsPack::decode(data.as_ref()) else {
                        continue;
                    };

                    for cmd in &pack.commands {
                        if cmd.r#type() != drivers::StationCommandType::StcDogzillaCommand {
                            continue;
                        }

                        let command = match Command::decode(cmd.body.clone()) {
                            Ok(c) => c,
                            Err(e) => {
                                error!("Failed to decode DOGZILLA command: {}", e);
                                continue;
                            }
                        };

                        let envelope = TxEnvelope {
                            command_id: cmd.command_id.to_vec(),
                            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
                            local_stamp_ns: systime::get_local_stamp_ns(),
                            app_start_id: systime::get_app_start_id(),
                            target_device_serial: command.target_device_serial.clone(),
                            command: Some(command),
                        };

                        if let Err(e) = com_for_commands.send_tx(&envelope) {
                            error!("Failed to send DOGZILLA command to tx queue: {}", e);
                        }
                    }
                }
                true
            }),
        )?;

        info!("Started DOGZILLA driver");

        let driver = Self {
            _com: com.clone(),
            _connected_port: connected_port.clone(),
        };

        if simulation {
            Self::start_simulation(&com, &connected_port).await;
        } else {
            let rpi_serial = read_rpi_cpu_serial().unwrap_or_default();
            info!(
                "DOGZILLA detection watchdog started: port={} retry_interval={}s cpu_serial={}",
                RPI_UART_PORT,
                DETECTION_RETRY_INTERVAL.as_secs(),
                if rpi_serial.is_empty() {
                    "not available"
                } else {
                    &rpi_serial
                }
            );
            Self::start_connection_monitor(com.clone(), connected_port.clone(), rpi_serial);
        }

        Ok(driver)
    }

    fn start_connection_monitor(
        com: Arc<DogzillaCommunicator>,
        connected_port: Arc<RwLock<Option<String>>>,
        rpi_serial: String,
    ) {
        tokio::spawn(async move {
            let mut last_failure = None;

            loop {
                if connected_port.read().await.is_some() {
                    last_failure = None;
                    tokio::time::sleep(DETECTION_RETRY_INTERVAL).await;
                    continue;
                }

                let attempt = Self::scan_and_connect(&com, &connected_port, &rpi_serial).await;
                match attempt {
                    ConnectionAttempt::Connected => {
                        if last_failure.is_some() {
                            info!(
                                "DOGZILLA detection recovered on {} after retry",
                                RPI_UART_PORT
                            );
                        }
                        last_failure = None;
                    }
                    ConnectionAttempt::PortMissing => {
                        if last_failure != Some(ConnectionAttempt::PortMissing) {
                            warn!(
                                "Raspberry Pi UART port {} not found, retrying every {}s",
                                RPI_UART_PORT,
                                DETECTION_RETRY_INTERVAL.as_secs()
                            );
                            last_failure = Some(ConnectionAttempt::PortMissing);
                        }
                        tokio::time::sleep(DETECTION_RETRY_INTERVAL).await;
                    }
                    ConnectionAttempt::NotDetected => {
                        if last_failure != Some(ConnectionAttempt::NotDetected) {
                            warn!(
                                "No dogzilla device detected on {}, retrying every {}s",
                                RPI_UART_PORT,
                                DETECTION_RETRY_INTERVAL.as_secs()
                            );
                            last_failure = Some(ConnectionAttempt::NotDetected);
                        }
                        tokio::time::sleep(DETECTION_RETRY_INTERVAL).await;
                    }
                }
            }
        });
    }

    async fn start_simulation(
        com: &Arc<DogzillaCommunicator>,
        connected_port: &Arc<RwLock<Option<String>>>,
    ) {
        let rpi_serial = read_rpi_cpu_serial().unwrap_or_default();
        let mut device_info = Self::create_device_info(SIM_PORT_NAME, &rpi_serial);
        device_info.firmware_version = "L-SIM".to_string();
        device_info.model = DogzillaModel::DogzillaLite as i32;

        *connected_port.write().await = Some(SIM_PORT_NAME.to_string());
        Self::send_device_connect_signal(com, &device_info);

        let connected_port_clone = connected_port.clone();
        let com_clone = com.clone();
        let device_info_clone = device_info.clone();

        tokio::spawn(async move {
            let mut simulator =
                DogzillaSimulator::new(device_info_clone.clone(), com_clone.clone());
            if let Err(e) = simulator.run().await {
                warn!("DOGZILLA simulation error: {}", e);
            }

            *connected_port_clone.write().await = None;
            Self::send_device_disconnect_signal(&com_clone, &device_info_clone);
            info!("DOGZILLA simulation stopped");
        });
    }

    async fn scan_and_connect(
        com: &Arc<DogzillaCommunicator>,
        connected_port: &Arc<RwLock<Option<String>>>,
        rpi_serial: &str,
    ) -> ConnectionAttempt {
        if !Path::new(RPI_UART_PORT).exists() {
            return ConnectionAttempt::PortMissing;
        }

        let mut device_info = Self::create_device_info(RPI_UART_PORT, rpi_serial);
        let mut port =
            DogzillaPort::new(RPI_UART_PORT.to_string(), device_info.clone(), com.clone());

        if let Some(firmware_version) = port.detect_dogzilla().await {
            let model = Self::detect_model_from_firmware(&firmware_version);
            device_info.firmware_version = firmware_version;
            device_info.model = model as i32;

            info!(
                "DOGZILLA detected: port={} serial={} firmware=v{} model={:?}",
                RPI_UART_PORT, device_info.serial_number, device_info.firmware_version, model
            );

            *connected_port.write().await = Some(RPI_UART_PORT.to_string());
            Self::send_device_connect_signal(com, &device_info);

            let connected_port_clone = connected_port.clone();
            let com_clone = com.clone();
            let device_info_clone = device_info.clone();

            tokio::spawn(async move {
                if let Err(e) = port.run().await {
                    warn!("DOGZILLA port {} error: {}", RPI_UART_PORT, e);
                }

                *connected_port_clone.write().await = None;
                Self::send_device_disconnect_signal(&com_clone, &device_info_clone);
                info!("DOGZILLA port {} disconnected", RPI_UART_PORT);
            });
            ConnectionAttempt::Connected
        } else {
            ConnectionAttempt::NotDetected
        }
    }

    fn create_device_info(port_name: &str, rpi_serial: &str) -> DogzillaDevice {
        DogzillaDevice {
            port_name: port_name.to_string(),
            baud_rate: BAUD_RATE,
            serial_number: rpi_serial.to_string(),
            firmware_version: String::new(),
            model: DogzillaModel::Unknown as i32,
            vid: 0,
            pid: 0,
            manufacturer: String::new(),
            product: String::new(),
        }
    }

    fn detect_model_from_firmware(firmware_version: &str) -> DogzillaModel {
        match firmware_version.chars().next() {
            Some('L') => DogzillaModel::DogzillaLite,
            Some('M') => DogzillaModel::DogzillaMini,
            Some('R') => DogzillaModel::DogzillaRider,
            _ => DogzillaModel::Unknown,
        }
    }

    fn send_device_connect_signal(comm: &DogzillaCommunicator, device_info: &DogzillaDevice) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: DogzillaSignalType::DogzillaConnected as i32,
            device: Some(device_info.clone()),
            ..Default::default()
        };

        if let Err(e) = comm.send_rx(&envelope) {
            error!("Failed to send DOGZILLA connect signal: {}", e);
        }
    }

    fn send_device_disconnect_signal(comm: &DogzillaCommunicator, device_info: &DogzillaDevice) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: DogzillaSignalType::DogzillaDisconnected as i32,
            device: Some(device_info.clone()),
            ..Default::default()
        };

        if let Err(e) = comm.send_rx(&envelope) {
            error!("Failed to send DOGZILLA disconnect signal: {}", e);
        }
    }
}

pub async fn start_dogzilla_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    simulation: bool,
) -> Result<Arc<DogzillaDriver>, Box<dyn std::error::Error>> {
    let driver = DogzillaDriver::new(normfs, station_engine, simulation).await?;
    Ok(Arc::new(driver))
}

fn read_rpi_cpu_serial() -> Option<String> {
    fs::read_to_string("/proc/cpuinfo")
        .ok()?
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key.trim() == "Serial").then(|| value.trim().to_string())
        })
}

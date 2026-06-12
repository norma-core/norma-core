use crate::protocol::{
    AppConfigPayload, FirmwareInfoPayload, MotorConfigPayload, VescRequest, VescResponse,
};
use crate::state::VescTrampaCommunicator;
use crate::vesc_trampa_proto::{RxEnvelope, VescTrampaBoard, VescTrampaSignalType};
use log::{error, info, warn};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio_serial::{SerialPortBuilderExt, SerialPortInfo};

pub const VESC_TRAMPA_COMMAND_TIMEOUT_MS: u64 = 100;

pub struct VescTrampaPort {
    port_info: SerialPortInfo,
    board_info: VescTrampaBoard,
    com: Arc<VescTrampaCommunicator>,
    firmware_info: Option<FirmwareInfoPayload>,
    motor_config: Option<MotorConfigPayload>,
    app_config: Option<AppConfigPayload>,
}

impl VescTrampaPort {
    pub fn new(
        port_info: SerialPortInfo,
        com: Arc<VescTrampaCommunicator>,
        board_info: VescTrampaBoard,
    ) -> Self {
        Self {
            port_info,
            board_info,
            com,
            firmware_info: None,
            motor_config: None,
            app_config: None,
        }
    }

    pub async fn open(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let port_name = self.port_info.port_name.clone();
        info!("Attempting to open VESC Trampa port: {}", port_name);

        let mut port = tokio_serial::new(&port_name, self.board_info.port_baud_rate)
            .timeout(Duration::from_millis(100))
            .open_native_async()?;

        info!("Successfully opened VESC Trampa port: {}", port_name);
        if let Err(error) = self.read_firmware_info(&mut port).await {
            warn!(
                "Failed to read VESC Trampa firmware info from {}: {}",
                port_name, error
            );
            return Err(error);
        }
        if let Err(error) = self.read_motor_config(&mut port).await {
            warn!(
                "Failed to read VESC Trampa motor config from {}: {}",
                port_name, error
            );
            return Err(error);
        }
        if let Err(error) = self.read_app_config(&mut port).await {
            warn!(
                "Failed to read VESC Trampa app config from {}: {}",
                port_name, error
            );
            return Err(error);
        }

        self.send_board_signal(VescTrampaSignalType::VescTrampaBoardConnect);

        let mut buf = [0u8; 64];
        loop {
            match port.read(&mut buf).await {
                Ok(0) => {
                    warn!("VESC Trampa port {} serial stream ended", port_name);
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    warn!("VESC Trampa port {} disconnected: {}", port_name, error);
                    break;
                }
            }
        }

        self.send_board_signal(VescTrampaSignalType::VescTrampaBoardDisconnect);
        Ok(())
    }

    async fn read_app_config(
        &mut self,
        port: &mut tokio_serial::SerialStream,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let response = VescRequest::AppConfig
            .async_readwrite(port, VESC_TRAMPA_COMMAND_TIMEOUT_MS)
            .await?;

        match response {
            VescResponse::AppConfig { config, .. } => {
                info!(
                    "VESC Trampa app config read from {}: {}",
                    self.board_info.port_name, config
                );

                self.app_config = Some(config);
            }
            _ => unreachable!(),
        }

        Ok(())
    }

    async fn read_motor_config(
        &mut self,
        port: &mut tokio_serial::SerialStream,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let response = VescRequest::MotorConfig
            .async_readwrite(port, VESC_TRAMPA_COMMAND_TIMEOUT_MS)
            .await?;

        match response {
            VescResponse::MotorConfig { config, .. } => {
                info!(
                    "VESC Trampa motor config read from {}: {}",
                    self.board_info.port_name, config
                );

                self.motor_config = Some(config);
            }
            _ => unreachable!(),
        }

        Ok(())
    }

    async fn read_firmware_info(
        &mut self,
        port: &mut tokio_serial::SerialStream,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let response = VescRequest::FirmwareInfo
            .async_readwrite(port, VESC_TRAMPA_COMMAND_TIMEOUT_MS)
            .await?;

        match response {
            VescResponse::FirmwareInfo { info, .. } => {
                info!(
                    "VESC Trampa firmware detected on {}: {}",
                    self.board_info.port_name, info
                );

                self.firmware_info = Some(info);
            }
            _ => unreachable!(),
        }

        Ok(())
    }

    fn send_board_signal(&self, signal_type: VescTrampaSignalType) {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: signal_type as i32,
            board: Some(self.board_info.clone()),
        };

        if let Err(err) = self.com.send_rx(&envelope) {
            error!("Failed to send VESC Trampa board signal: {}", err);
        }
    }
}

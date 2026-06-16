use crate::protocol::{
    AppConfigPayload, CommPacket, FirmwareInfoPayload, MotorConfigPayload, ValuesPayload,
    VescCommandId, VescRequest, VescResponse,
};
use crate::state::VescTrampaCommunicator;
use crate::vesc_trampa_proto::{
    RxEnvelope, TxEnvelope, VescTrampaBoard, VescTrampaBoardPacket, VescTrampaMotorMode,
    VescTrampaSignalType,
};
use bytes::Bytes;
use log::{debug, error, info, warn};
use prost::Message;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::MissedTickBehavior;
use tokio_serial::{SerialPortBuilderExt, SerialPortInfo, SerialStream};

pub const VESC_TRAMPA_COMMAND_TIMEOUT_MS: u64 = 100;
pub const VESC_TRAMPA_TICK_INTERVAL_MS: u64 = 20;
pub const VESC_TRAMPA_HOLD_HANDBRAKE_CURRENT_A: f32 = 10.0;

#[derive(Debug)]
pub struct VescTrampaProbeError {
    port_name: String,
    source: Box<dyn std::error::Error + Send + Sync>,
}

impl VescTrampaProbeError {
    fn new(port_name: String, source: Box<dyn std::error::Error + Send + Sync>) -> Self {
        Self { port_name, source }
    }
}

impl fmt::Display for VescTrampaProbeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} did not answer VESC firmware info probe",
            self.port_name
        )
    }
}

impl std::error::Error for VescTrampaProbeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.source.as_ref())
    }
}

pub struct VescTrampaPort {
    port_info: SerialPortInfo,
    board_info: VescTrampaBoard,
    com: Arc<VescTrampaCommunicator>,
    firmware_info: Option<FirmwareInfoPayload>,
    motor_config: Option<MotorConfigPayload>,
    app_config: Option<AppConfigPayload>,
    values: Option<ValuesPayload>,
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
            values: None,
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
            debug!("VESC Trampa probe failed on {}: {}", port_name, error);
            return Err(Box::new(VescTrampaProbeError::new(port_name, error)));
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

        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<TxEnvelope>();
        let command_waiting = Arc::new(AtomicBool::new(false));
        let tx_queue_id = self.com.tx_queue_id.clone();
        let normfs = self.com.normfs.clone();
        let target_board_uuid = self.board_info.uuid.clone();
        let cmd_tx_clone = cmd_tx.clone();
        let command_waiting_clone = command_waiting.clone();
        let subscription_id = normfs.subscribe(
            &tx_queue_id,
            Box::new(move |entries| {
                for (_id, data) in entries {
                    if let Ok(envelope) = TxEnvelope::decode(data.as_ref()) {
                        if envelope.target_board_uuid == target_board_uuid {
                            command_waiting_clone.store(true, Ordering::SeqCst);
                            if let Err(error) = cmd_tx_clone.send(envelope) {
                                error!(
                                    "Failed to send VESC Trampa command to port worker: {}",
                                    error
                                );
                                return false;
                            }
                        }
                    }
                }
                true
            }),
        )?;

        if let Err(error) = self.send_board_signal(VescTrampaSignalType::VescTrampaBoardConnect) {
            normfs.unsubscribe(&tx_queue_id, subscription_id);
            return Err(error);
        }

        let mut tick_interval =
            tokio::time::interval(Duration::from_millis(VESC_TRAMPA_TICK_INTERVAL_MS));
        tick_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut hold_mode_active = false;

        loop {
            tokio::select! {
                Some(command) = cmd_rx.recv() => {
                    command_waiting.store(false, Ordering::SeqCst);
                    self.log_command_received(&command);

                    if hold_mode_active && !Self::is_motor_mode_hold_command(&command) {
                        info!(
                            "Canceling VESC Trampa hold mode on {} before processing command_id={:02X?}",
                            self.board_info.port_name, command.command_id
                        );
                        hold_mode_active = false;
                    }

                    if let Err(error) = self.send_command_received_signal(&command) {
                        error!("Failed to send VESC Trampa command received signal: {}", error);
                        break;
                    }

                    match self.process_command(&mut port, &command, &mut hold_mode_active).await {
                        Ok(processed) => {
                            let signal_type = if processed {
                                VescTrampaSignalType::VescTrampaCommandSuccess
                            } else {
                                VescTrampaSignalType::VescTrampaCommandRejected
                            };

                            if let Err(error) = self.send_command_result_signal(&command, signal_type, None) {
                                error!("Failed to send VESC Trampa command result signal: {}", error);
                                break;
                            }
                        }
                        Err(error) => {
                            let error_message = error.to_string();
                            if let Err(send_error) = self.send_command_result_signal(
                                &command,
                                VescTrampaSignalType::VescTrampaCommandFailed,
                                Some(error_message),
                            ) {
                                error!("Failed to send VESC Trampa command failure signal: {}", send_error);
                            }
                            warn!("VESC Trampa command failed on {}: {}", port_name, error);
                            break;
                        }
                    }
                }
                _ = tick_interval.tick() => {
                    if command_waiting.load(Ordering::SeqCst) {
                        continue;
                    }

                    if hold_mode_active {
                        if let Err(error) = self.write_set_handbrake(&mut port, VESC_TRAMPA_HOLD_HANDBRAKE_CURRENT_A).await {
                            warn!("VESC Trampa port {} disconnected while holding: {}", port_name, error);
                            break;
                        }
                    }

                    if let Err(error) = self.read_values(&mut port).await {
                        warn!("VESC Trampa port {} disconnected: {}", port_name, error);
                        break;
                    }
                }
            }
        }

        normfs.unsubscribe(&tx_queue_id, subscription_id);
        drop(cmd_tx);

        if let Err(error) = self.send_board_signal(VescTrampaSignalType::VescTrampaBoardDisconnect)
        {
            error!(
                "Failed to send VESC Trampa board disconnect signal for {}: {}",
                port_name, error
            );
        }
        Ok(())
    }

    async fn read_values(
        &mut self,
        port: &mut SerialStream,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let response = VescRequest::Values
            .async_readwrite(port, VESC_TRAMPA_COMMAND_TIMEOUT_MS)
            .await?;

        match response {
            VescResponse::Values {
                values,
                source_packet,
                ..
            } => {
                debug!(
                    "VESC Trampa values read from {}: {}",
                    self.board_info.port_name, values
                );

                self.values = Some(values);
                self.send_board_packet_signal(&source_packet)?;
            }
            _ => unreachable!(),
        }

        Ok(())
    }

    async fn process_command(
        &mut self,
        port: &mut SerialStream,
        command: &TxEnvelope,
        hold_mode_active: &mut bool,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let command_variant_count = Self::command_variant_count(command);
        if command_variant_count != 1 {
            warn!(
                "Rejected VESC Trampa command for {}: expected exactly one command variant, got {}",
                self.board_info.port_name, command_variant_count
            );
            return Ok(false);
        }

        if let Some(mode) = Self::motor_mode(command) {
            match mode {
                VescTrampaMotorMode::Unspecified => {
                    warn!(
                        "Rejected VESC Trampa motor mode command for {}: unspecified mode",
                        self.board_info.port_name
                    );
                    return Ok(false);
                }
                VescTrampaMotorMode::Hold => {
                    info!(
                        "Processing VESC Trampa motor mode HOLD command on {} with handbrake_current_a={:.3}",
                        self.board_info.port_name, VESC_TRAMPA_HOLD_HANDBRAKE_CURRENT_A
                    );
                    *hold_mode_active = true;
                    self.write_set_handbrake(port, VESC_TRAMPA_HOLD_HANDBRAKE_CURRENT_A)
                        .await?;
                    return Ok(true);
                }
            }
        }

        let Some(board_command) = command.board_command.as_ref() else {
            warn!(
                "Rejected VESC Trampa command for {}: missing board_command",
                self.board_info.port_name
            );
            return Ok(false);
        };

        if board_command.payload.is_empty() {
            warn!(
                "Rejected VESC Trampa command for {}: empty payload",
                self.board_info.port_name
            );
            return Ok(false);
        }

        let request_packet = CommPacket::new(board_command.payload.clone())?;
        request_packet
            .async_write(port, VESC_TRAMPA_COMMAND_TIMEOUT_MS)
            .await?;

        if board_command.response_expected {
            let response_packet =
                CommPacket::async_read(port, VESC_TRAMPA_COMMAND_TIMEOUT_MS).await?;
            if response_packet.command_id() != request_packet.command_id() {
                let expected = request_packet.command_id().unwrap_or_default();
                let actual = response_packet.command_id().unwrap_or_default();
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!(
                        "VESC Trampa command response mismatch: expected command_id={expected}, got command_id={actual}"
                    ),
                )
                .into());
            }
            self.send_board_packet_signal(&response_packet)?;
        }

        Ok(true)
    }

    async fn write_set_handbrake(
        &self,
        port: &mut SerialStream,
        current_a: f32,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let packet = CommPacket::new(Self::set_handbrake_payload(current_a))?;
        packet
            .async_write(port, VESC_TRAMPA_COMMAND_TIMEOUT_MS)
            .await?;
        Ok(())
    }

    fn set_handbrake_payload(current_a: f32) -> Bytes {
        let mut payload = Vec::with_capacity(5);
        payload.push(VescCommandId::SetHandbrake.wire_id());
        payload.extend_from_slice(&((current_a * 1_000.0).round() as i32).to_be_bytes());
        Bytes::from(payload)
    }

    fn command_variant_count(command: &TxEnvelope) -> usize {
        (command.board_command.is_some() as usize) + (command.motor_mode.is_some() as usize)
    }

    fn is_motor_mode_hold_command(command: &TxEnvelope) -> bool {
        command.board_command.is_none()
            && Self::motor_mode(command) == Some(VescTrampaMotorMode::Hold)
    }

    fn motor_mode(command: &TxEnvelope) -> Option<VescTrampaMotorMode> {
        command.motor_mode.as_ref().map(|command| {
            VescTrampaMotorMode::try_from(command.mode).unwrap_or(VescTrampaMotorMode::Unspecified)
        })
    }

    fn log_command_received(&self, command: &TxEnvelope) {
        let now_ns = systime::get_monotonic_stamp_ns();
        let latency_ns = now_ns.saturating_sub(command.monotonic_stamp_ns);
        let latency_ms = latency_ns as f64 / 1_000_000.0;
        let payload_len = command
            .board_command
            .as_ref()
            .map(|command| command.payload.len())
            .unwrap_or_default();
        let motor_mode = Self::motor_mode(command);

        debug!(
            "Received VESC Trampa command for port {} uuid={} (latency: {:.2}ms): TxEnvelope {{ monotonic_stamp_ns: {}, local_stamp_ns: {}, app_start_id: {}, command_id: {:02X?}, payload_len: {}, response_expected: {}, motor_mode: {:?} }}",
            self.board_info.port_name,
            format_bytes(self.board_info.uuid.as_ref()),
            latency_ms,
            command.monotonic_stamp_ns,
            command.local_stamp_ns,
            command.app_start_id,
            command.command_id,
            payload_len,
            command
                .board_command
                .as_ref()
                .map(|command| command.response_expected)
                .unwrap_or_default(),
            motor_mode,
        );
    }

    async fn read_app_config(
        &mut self,
        port: &mut SerialStream,
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
        port: &mut SerialStream,
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
        port: &mut SerialStream,
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

                self.fill_board_firmware_info(&info);
                self.firmware_info = Some(info);
            }
            _ => unreachable!(),
        }

        Ok(())
    }

    fn fill_board_firmware_info(&mut self, info: &FirmwareInfoPayload) {
        self.board_info.firmware_major = info.major() as u32;
        self.board_info.firmware_minor = info.minor() as u32;
        self.board_info.hardware_name =
            String::from_utf8_lossy(info.hardware_name_bytes()).into_owned();
        self.board_info.uuid = info.uuid().map(Bytes::copy_from_slice).unwrap_or_default();
        self.board_info.pairing_done = info.pairing_done().unwrap_or_default();
        self.board_info.test_version_number = info.test_version_number().unwrap_or_default() as u32;
        self.board_info.hardware_type = info.hardware_type().unwrap_or_default() as u32;
        self.board_info.custom_config_count = info.custom_config_count().unwrap_or_default() as u32;
        self.board_info.has_phase_filters = info.has_phase_filters().unwrap_or_default();
        self.board_info.qml_hw = info.qml_hw().unwrap_or_default() as u32;
        self.board_info.qml_app = info.qml_app().unwrap_or_default() as u32;
        self.board_info.nrf_flags = info.nrf_flags().unwrap_or_default() as u32;
        self.board_info.firmware_name = info
            .firmware_name_bytes()
            .map(String::from_utf8_lossy)
            .map(|value| value.into_owned())
            .unwrap_or_default();
        self.board_info.hardware_config_crc = info.hardware_config_crc().unwrap_or_default();
        self.board_info.firmware_info_extra_bytes = Bytes::copy_from_slice(info.extra_bytes());
        self.board_info.firmware_info_raw_payload = info.raw_payload().clone();
    }

    fn send_board_signal(
        &self,
        signal_type: VescTrampaSignalType,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: signal_type as i32,
            board: Some(self.board_info.clone()),
            ..Default::default()
        };

        self.com.send_rx(&envelope)
    }

    fn send_board_packet_signal(
        &self,
        packet: &CommPacket,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: VescTrampaSignalType::VescTrampaBoardPacket as i32,
            board: Some(self.board_info.clone()),
            board_packet: Some(Self::to_board_packet_proto(packet)),
            ..Default::default()
        };

        self.com.send_rx(&envelope)
    }

    fn send_command_received_signal(
        &self,
        command: &TxEnvelope,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.send_command_signal(command, VescTrampaSignalType::VescTrampaCommand, None)
    }

    fn send_command_result_signal(
        &self,
        command: &TxEnvelope,
        signal_type: VescTrampaSignalType,
        error: Option<String>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.send_command_signal(command, signal_type, error)
    }

    fn send_command_signal(
        &self,
        command: &TxEnvelope,
        signal_type: VescTrampaSignalType,
        error: Option<String>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let envelope = RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            signal_type: signal_type as i32,
            board: Some(self.board_info.clone()),
            command: Some(command.clone()),
            error: error.unwrap_or_default(),
            ..Default::default()
        };

        self.com.send_rx(&envelope)
    }

    fn to_board_packet_proto(packet: &CommPacket) -> VescTrampaBoardPacket {
        VescTrampaBoardPacket {
            start_byte: packet.start_byte() as u32,
            payload_len: packet.payload_len() as u32,
            command_id: packet.command_id().unwrap_or_default(),
            payload: packet.payload().clone(),
            crc: packet.crc() as u32,
            end_byte: packet.end_byte() as u32,
        }
    }
}

fn format_bytes(value: &[u8]) -> String {
    let mut formatted = String::with_capacity(value.len() * 2);
    for byte in value {
        use std::fmt::Write;
        write!(&mut formatted, "{byte:02x}").expect("writing to String cannot fail");
    }
    formatted
}

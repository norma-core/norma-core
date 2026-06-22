use crate::command_inbox::{CommandReceiver, command_inbox};
use crate::yahboom_dogzilla_lite_proto::{
    Acceleration, Command, YahboomDogzillaLiteDevice, YahboomDogzillaLiteSignalType, YahboomDogzillaLiteStatus, ImuOrientation,
    TxEnvelope,
};
use crate::errors::YahboomDogzillaLiteError;
use crate::protocol::{self, FeedbackPacket, Frame};
use crate::shared::{
    ServoWrite, command_byte, compute_command_effect, send_command_result, send_status_update,
    should_report_command_success, target_matches, unsupported_command_message,
};
use crate::state::YahboomDogzillaLiteCommunicator;
use log::{error, info, warn};
use prost::Message;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;
use tokio_serial::SerialStream;

const WRITE_TIMEOUT: Duration = Duration::from_millis(100);
const DETECTION_TIMEOUT: Duration = Duration::from_secs(3);
const DEFAULT_SERVO_SPEED: u8 = 127;

pub(crate) struct YahboomDogzillaLitePort {
    port_name: String,
    device_info: YahboomDogzillaLiteDevice,
    leg_servo_speed: u32,
    arm_servo_speed: u32,
    com: Arc<YahboomDogzillaLiteCommunicator>,
}

impl YahboomDogzillaLitePort {
    pub(crate) fn new(
        port_name: String,
        device_info: YahboomDogzillaLiteDevice,
        com: Arc<YahboomDogzillaLiteCommunicator>,
    ) -> Self {
        Self {
            port_name,
            device_info,
            leg_servo_speed: DEFAULT_SERVO_SPEED as u32,
            arm_servo_speed: DEFAULT_SERVO_SPEED as u32,
            com,
        }
    }

    pub(crate) async fn detect_yahboom_dogzilla_lite(&mut self) -> Option<String> {
        let mut serial =
            match SerialStream::open(&tokio_serial::new(&self.port_name, protocol::BAUD_RATE)) {
                Ok(s) => s,
                Err(e) => {
                    warn!("Failed to open port {}: {}", self.port_name, e);
                    return None;
                }
            };

        let disable_feedback = Frame::write(protocol::REG_ENABLE_FEEDBACK, vec![0x00]);
        if let Err(e) = Self::write_frame(&mut serial, &disable_feedback).await {
            warn!(
                "Failed to disable feedback mode on {}: {}",
                self.port_name, e
            );
            return None;
        }

        let firmware = self
            .read_register_with_timeout(
                &mut serial,
                protocol::REG_FIRMWARE_VERSION,
                10,
                DETECTION_TIMEOUT,
            )
            .await?;

        let version = String::from_utf8_lossy(&firmware)
            .trim_matches('\0')
            .to_string();
        info!(
            "Detected Yahboom Dogzilla Lite on {}: firmware v{}",
            self.port_name, version
        );

        Some(version)
    }

    pub(crate) async fn run(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let mut serial =
            SerialStream::open(&tokio_serial::new(&self.port_name, protocol::BAUD_RATE))?;

        self.write_startup_frames(&mut serial).await;

        let (tx_sender, tx_receiver) = command_inbox();
        let device_serial = self.device_info.serial_number.clone();
        let result_com = self.com.clone();
        let result_device = self.device_info.clone();
        let normfs = self.com.normfs.clone();
        let tx_queue_id = self.com.tx_queue_id.clone();
        let subscription_id = normfs
            .subscribe(
                &tx_queue_id,
                Box::new(move |entries: &[(normfs::UintN, bytes::Bytes)]| {
                    for (_id, data) in entries {
                        match TxEnvelope::decode(data.as_ref()) {
                            Ok(envelope) => {
                                if !target_matches(&envelope.target_device_serial, &device_serial) {
                                    continue;
                                }

                                if envelope.command.is_none() {
                                    continue;
                                }

                                let failed_envelope = envelope.clone();
                                if let Err(e) = tx_sender.push(envelope) {
                                    warn!("Failed to queue TX command: {}", e);
                                    send_command_result(
                                        &result_com,
                                        &result_device,
                                        &failed_envelope,
                                        YahboomDogzillaLiteSignalType::YahboomDogzillaLiteCommandFailed,
                                        Some(e.to_string()),
                                    );
                                }
                            }
                            Err(e) => warn!("Failed to decode TX envelope: {}", e),
                        }
                    }
                    true
                }),
            )
            .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

        let enable_feedback = Frame::write(protocol::REG_ENABLE_FEEDBACK, vec![0x01]);
        if let Err(e) = Self::write_frame(&mut serial, &enable_feedback).await {
            warn!("Failed to enable feedback mode: {}", e);
        }

        let result = self.feedback_loop(&mut serial, tx_receiver).await;
        normfs.unsubscribe(&tx_queue_id, subscription_id);
        result
    }

    async fn read_register_with_timeout(
        &mut self,
        serial: &mut SerialStream,
        reg: u8,
        len: u8,
        read_timeout: Duration,
    ) -> Option<Vec<u8>> {
        let frame = Frame::read(reg, len);
        Self::write_frame(serial, &frame).await.ok()?;

        let mut buffer = Vec::with_capacity(256);
        let mut temp = [0u8; 64];
        let read_deadline = Instant::now() + read_timeout;

        loop {
            let remaining = read_deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return None;
            }

            match timeout(remaining, serial.read(&mut temp)).await {
                Ok(Ok(n)) if n > 0 => {
                    buffer.extend_from_slice(&temp[..n]);
                    if buffer.ends_with(&protocol::PACKET_TAIL) {
                        break;
                    }
                }
                Ok(Ok(_)) => continue,
                Ok(Err(_)) | Err(_) => return None,
            }
        }

        match Frame::decode(&buffer) {
            Ok(response) if response.address == reg => Some(response.data),
            _ => None,
        }
    }

    async fn write_startup_frames(&mut self, serial: &mut SerialStream) {
        let disable_stabilization = Frame::write(protocol::REG_IMU_STABILIZATION, vec![0x00]);
        if let Err(e) = Self::write_frame(serial, &disable_stabilization).await {
            warn!("Failed to disable stabilization mode: {}", e);
        }

        let leg_speed_frame = Frame::write(protocol::REG_SERVO_SPEED, vec![DEFAULT_SERVO_SPEED]);
        if let Err(e) = Self::write_frame(serial, &leg_speed_frame).await {
            warn!("Failed to set leg servo speed: {}", e);
        }

        let arm_speed_frame =
            Frame::write(protocol::REG_SERVO_ARM_SPEED, vec![DEFAULT_SERVO_SPEED]);
        if let Err(e) = Self::write_frame(serial, &arm_speed_frame).await {
            warn!("Failed to set arm servo speed: {}", e);
        }
    }

    async fn feedback_loop(
        &mut self,
        serial: &mut SerialStream,
        mut tx_receiver: CommandReceiver,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut buffer = Vec::with_capacity(128);
        let mut temp = [0u8; 128];

        loop {
            tokio::select! {
                command = tx_receiver.recv() => {
                    match command {
                        Some(envelope) => self.process_envelope(serial, &envelope).await,
                        None => {
                            warn!("YAHBOOM_DOGZILLA_LITE command channel closed");
                            return Ok(());
                        }
                    }
                }
                result = serial.read(&mut temp) => {
                    match result {
                        Ok(n) if n > 0 => {
                            buffer.extend_from_slice(&temp[..n]);
                            while let Some(status) = self.try_parse_feedback_packet(&mut buffer) {
                                self.update_and_send_status(status);
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            error!("Serial read error: {}", e);
                            return Err(Box::new(e));
                        }
                    }
                }
            }
        }
    }

    fn try_parse_feedback_packet(&self, buffer: &mut Vec<u8>) -> Option<YahboomDogzillaLiteStatus> {
        let start = match buffer
            .windows(2)
            .position(|window| window == protocol::PACKET_HEADER)
        {
            Some(index) => index,
            None => {
                let keep = buffer
                    .last()
                    .copied()
                    .filter(|&byte| byte == protocol::PACKET_HEADER[0]);
                buffer.clear();
                if let Some(byte) = keep {
                    buffer.push(byte);
                }
                return None;
            }
        };

        if start > 0 {
            buffer.drain(0..start);
        }

        if buffer.len() < protocol::FEEDBACK_PACKET_SIZE {
            return None;
        }

        let packet = &buffer[..protocol::FEEDBACK_PACKET_SIZE];
        if packet[protocol::FEEDBACK_PACKET_SIZE - 2..] != protocol::PACKET_TAIL {
            warn!(
                "Broken feedback packet tail: 0x{:02X} 0x{:02X}",
                packet[protocol::FEEDBACK_PACKET_SIZE - 2],
                packet[protocol::FEEDBACK_PACKET_SIZE - 1]
            );
            buffer.drain(0..1);
            return None;
        }

        match FeedbackPacket::parse(packet) {
            Some(parsed) => {
                buffer.drain(0..protocol::FEEDBACK_PACKET_SIZE);
                Some(self.feedback_packet_to_status(&parsed))
            }
            None => {
                warn!("Failed to parse feedback packet");
                buffer.drain(0..1);
                None
            }
        }
    }

    fn feedback_packet_to_status(&self, packet: &FeedbackPacket) -> YahboomDogzillaLiteStatus {
        let servo_positions = packet.servo_positions.iter().map(|&b| b as u32).collect();
        let servo_angles = packet
            .servo_positions
            .iter()
            .enumerate()
            .map(|(i, &raw)| {
                let limit = protocol::get_servo_limit_lite(i);
                protocol::servo_position_to_angle(raw, limit)
            })
            .collect();

        YahboomDogzillaLiteStatus {
            battery_level: packet.battery as u32,
            model: self.device_info.model,
            firmware_version: self.device_info.firmware_version.clone(),
            servo_positions,
            servo_angles,
            leg_servo_speed: self.leg_servo_speed,
            arm_servo_speed: self.arm_servo_speed,
            orientation: Some(ImuOrientation {
                roll: packet.roll,
                pitch: packet.pitch,
                yaw: packet.yaw,
            }),
            acceleration: Some(Acceleration {
                x: packet.accel_x,
                y: packet.accel_y,
                z: packet.accel_z,
            }),
        }
    }

    async fn process_envelope(&mut self, serial: &mut SerialStream, envelope: &TxEnvelope) {
        let Some(command) = envelope.command.as_ref() else {
            return;
        };

        let report_success = should_report_command_success(command);
        match self.apply_command(serial, command).await {
            Ok(()) => {
                if report_success {
                    self.send_command_result(
                        envelope,
                        YahboomDogzillaLiteSignalType::YahboomDogzillaLiteCommandSuccess,
                        None,
                    );
                }
            }
            Err(e) => {
                error!("Failed to process YAHBOOM_DOGZILLA_LITE command: {}", e);
                self.send_command_result(
                    envelope,
                    YahboomDogzillaLiteSignalType::YahboomDogzillaLiteCommandFailed,
                    Some(e.to_string()),
                );
            }
        }
    }

    async fn apply_command(
        &mut self,
        serial: &mut SerialStream,
        command: &Command,
    ) -> Result<(), YahboomDogzillaLiteError> {
        if let Some(message) = unsupported_command_message(command) {
            return Err(YahboomDogzillaLiteError::UnsupportedCommand(message));
        }

        let mut applied = false;
        let effect = compute_command_effect(command);
        if command.servo.is_some() && effect.servo_writes.is_empty() {
            let servo_id = command
                .servo
                .as_ref()
                .map(|servo| servo.servo_id)
                .unwrap_or(0);
            return Err(YahboomDogzillaLiteError::UnsupportedCommand(format!(
                "unknown servo ID {}",
                servo_id
            )));
        }

        for write in effect.servo_writes {
            self.write_servo_position(serial, write).await?;
            applied = true;
        }

        if let Some(speed) = effect.leg_servo_speed {
            self.write_leg_speed(serial, speed).await?;
            applied = true;
        }

        if let Some(speed) = effect.arm_servo_speed {
            self.write_arm_speed(serial, speed).await?;
            applied = true;
        }

        if let Some(action) = &command.action {
            applied |= self.write_action(serial, action.action).await?;
        }

        if let Some(movement) = &command.movement {
            self.write_movement(serial, movement.move_x, movement.move_y, movement.move_yaw)
                .await?;
            applied = true;
        }

        if applied {
            Ok(())
        } else {
            Err(YahboomDogzillaLiteError::UnsupportedCommand(
                "empty YAHBOOM_DOGZILLA_LITE command".to_string(),
            ))
        }
    }

    async fn write_servo_position(
        &mut self,
        serial: &mut SerialStream,
        write: ServoWrite,
    ) -> Result<(), YahboomDogzillaLiteError> {
        let frame = Frame::write(write.register, vec![write.position]);
        info!(
            "Sending servo command: id={} reg=0x{:02X} pos={}",
            write.servo_id, write.register, write.position
        );

        Self::write_frame(serial, &frame).await
    }

    async fn write_leg_speed(
        &mut self,
        serial: &mut SerialStream,
        speed: u32,
    ) -> Result<(), YahboomDogzillaLiteError> {
        let speed_byte = command_byte(speed);
        let frame = Frame::write(protocol::REG_SERVO_SPEED, vec![speed_byte]);
        info!("Sending leg servo speed: {}", speed_byte);

        Self::write_frame(serial, &frame).await?;
        self.leg_servo_speed = speed;
        Ok(())
    }

    async fn write_arm_speed(
        &mut self,
        serial: &mut SerialStream,
        speed: u32,
    ) -> Result<(), YahboomDogzillaLiteError> {
        let speed_byte = command_byte(speed);
        let frame = Frame::write(protocol::REG_SERVO_ARM_SPEED, vec![speed_byte]);
        info!("Sending arm servo speed: {}", speed_byte);

        Self::write_frame(serial, &frame).await?;
        self.arm_servo_speed = speed;
        Ok(())
    }

    async fn write_action(
        &mut self,
        serial: &mut SerialStream,
        action: i32,
    ) -> Result<bool, YahboomDogzillaLiteError> {
        let action_value = action.clamp(0, 255) as u8;
        if action_value == 0 {
            return Ok(false);
        }

        let frame = Frame::write(protocol::REG_ACTION, vec![action_value]);
        info!("Sending action command: action={}", action_value);

        Self::write_frame(serial, &frame).await?;
        Ok(true)
    }

    async fn write_movement(
        &mut self,
        serial: &mut SerialStream,
        x: u32,
        y: u32,
        yaw: u32,
    ) -> Result<(), YahboomDogzillaLiteError> {
        let move_x = command_byte(x);
        let move_y = command_byte(y);
        let move_yaw = command_byte(yaw);

        self.write_register(serial, protocol::REG_MOVE_X, move_x, "move_x")
            .await?;
        self.write_register(serial, protocol::REG_MOVE_Y, move_y, "move_y")
            .await?;
        self.write_register(serial, protocol::REG_MOVE_YAW, move_yaw, "move_yaw")
            .await?;

        info!("Movement: x={} y={} yaw={}", move_x, move_y, move_yaw);
        Ok(())
    }

    async fn write_register(
        &mut self,
        serial: &mut SerialStream,
        register: u8,
        value: u8,
        name: &str,
    ) -> Result<(), YahboomDogzillaLiteError> {
        let frame = Frame::write(register, vec![value]);
        Self::write_frame(serial, &frame).await.map_err(|e| {
            error!("Failed to write {}: {}", name, e);
            e
        })
    }

    fn update_and_send_status(&self, status: YahboomDogzillaLiteStatus) {
        send_status_update(&self.com, &self.device_info, status);
    }

    fn send_command_result(
        &self,
        envelope: &TxEnvelope,
        signal_type: YahboomDogzillaLiteSignalType,
        error_message: Option<String>,
    ) {
        send_command_result(
            &self.com,
            &self.device_info,
            envelope,
            signal_type,
            error_message,
        );
    }

    async fn write_frame(serial: &mut SerialStream, frame: &Frame) -> Result<(), YahboomDogzillaLiteError> {
        let data = frame.encode();

        match timeout(WRITE_TIMEOUT, serial.write_all(&data)).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(e)) => Err(YahboomDogzillaLiteError::SerialError(e.to_string())),
            Err(_) => Err(YahboomDogzillaLiteError::Timeout),
        }
    }
}

use crate::dogzilla_proto::{
    Acceleration, Command, DogzillaDevice, DogzillaStatus, ImuOrientation, TxEnvelope,
};
use crate::errors::DogzillaError;
use crate::protocol::{self, FeedbackPacket, Frame};
use crate::shared::{compute_command_effect, send_status_update};
use crate::state::DogzillaCommunicator;
use log::{error, info, warn};
use prost::Message;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_serial::SerialStream;

const WRITE_TIMEOUT: Duration = Duration::from_millis(100);
const DETECTION_TIMEOUT: Duration = Duration::from_secs(3);

pub struct DogzillaPort {
    port_name: String,
    device_info: DogzillaDevice,
    leg_servo_speed: u32,
    arm_servo_speed: u32,
    com: Arc<DogzillaCommunicator>,
}

impl DogzillaPort {
    pub fn new(
        port_name: String,
        device_info: DogzillaDevice,
        com: Arc<DogzillaCommunicator>,
    ) -> Self {
        Self {
            port_name,
            device_info,
            leg_servo_speed: 127,
            arm_servo_speed: 127,
            com,
        }
    }

    /// Detect dogzilla device by trying to read firmware version
    /// Flow: disable feedback mode -> read firmware version
    /// Returns firmware version if successful, None otherwise
    pub async fn detect_dogzilla(&mut self) -> Option<String> {
        let mut serial =
            match SerialStream::open(&tokio_serial::new(&self.port_name, protocol::BAUD_RATE)) {
                Ok(s) => s,
                Err(e) => {
                    warn!("Failed to open port {}: {}", self.port_name, e);
                    return None;
                }
            };

        // Disable feedback mode before reading registers
        let disable_feedback = Frame::write(protocol::REG_ENABLE_FEEDBACK, vec![0x00]);
        if let Err(e) = self.write_frame_to(&mut serial, &disable_feedback).await {
            warn!(
                "Failed to disable feedback mode on {}: {}",
                self.port_name, e
            );
            return None;
        }

        // Read firmware version with timeout (10 bytes ASCII string)
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
            "Detected dogzilla on {}: firmware v{}",
            self.port_name, version
        );

        Some(version)
    }

    /// Read a register with a specific timeout
    async fn read_register_with_timeout(
        &mut self,
        serial: &mut SerialStream,
        reg: u8,
        len: u8,
        read_timeout: Duration,
    ) -> Option<Vec<u8>> {
        let frame = Frame::read(reg, len);
        let data = frame.encode();

        if timeout(WRITE_TIMEOUT, serial.write_all(&data))
            .await
            .is_err()
        {
            return None;
        }

        let mut buffer = Vec::with_capacity(256);
        let mut temp = [0u8; 64];
        let read_deadline = std::time::Instant::now() + read_timeout;

        loop {
            let remaining = read_deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return None;
            }

            match timeout(remaining, serial.read(&mut temp)).await {
                Ok(Ok(n)) if n > 0 => {
                    buffer.extend_from_slice(&temp[..n]);
                    if buffer.len() >= 2
                        && buffer[buffer.len() - 2] == 0x00
                        && buffer[buffer.len() - 1] == 0xAA
                    {
                        break;
                    }
                }
                Ok(Ok(_)) => continue,
                Ok(Err(_)) | Err(_) => return None,
            }
        }

        if let Ok(response) = Frame::decode(&buffer) {
            if response.address == reg {
                return Some(response.data);
            }
        }

        None
    }

    /// Write a frame to a specific serial port (used during detection)
    async fn write_frame_to(
        &mut self,
        serial: &mut SerialStream,
        frame: &Frame,
    ) -> Result<(), DogzillaError> {
        let data = frame.encode();

        match timeout(WRITE_TIMEOUT, serial.write_all(&data)).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(e)) => Err(DogzillaError::SerialError(e.to_string())),
            Err(_) => Err(DogzillaError::Timeout),
        }
    }

    /// Run the main communication loop using polling (no feedback mode)
    pub async fn run(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let mut serial =
            SerialStream::open(&tokio_serial::new(&self.port_name, protocol::BAUD_RATE))?;

        // Startup: Disable stabilization mode
        let disable_stabilization = Frame::write(protocol::REG_IMU_STABILIZATION, vec![0x00]);
        if let Err(e) = self.write_frame(&mut serial, &disable_stabilization).await {
            warn!("Failed to disable stabilization mode: {}", e);
        }

        // Write default servo speeds (127) at startup
        let default_speed: u8 = 127;
        let leg_speed_frame = Frame::write(protocol::REG_SERVO_SPEED, vec![default_speed]);
        if let Err(e) = self.write_frame(&mut serial, &leg_speed_frame).await {
            warn!("Failed to set leg servo speed: {}", e);
        }
        let arm_speed_frame = Frame::write(protocol::REG_SERVO_ARM_SPEED, vec![default_speed]);
        if let Err(e) = self.write_frame(&mut serial, &arm_speed_frame).await {
            warn!("Failed to set arm servo speed: {}", e);
        }

        // Create a channel for TX commands
        let (tx_sender, tx_receiver) = mpsc::unbounded_channel::<Command>();

        // Subscribe to TX queue and forward commands to the channel
        let tx_sender_clone = tx_sender.clone();
        let device_serial = self.device_info.serial_number.clone();
        let normfs = self.com.normfs.clone();
        let tx_queue_id = self.com.tx_queue_id.clone();
        let subscription_id = normfs
            .subscribe(
                &tx_queue_id,
                Box::new(move |entries: &[(normfs::UintN, bytes::Bytes)]| {
                    for (_id, data) in entries {
                        match TxEnvelope::decode(data.as_ref()) {
                            Ok(envelope) => {
                                // Filter by target device serial (empty string matches all)
                                if envelope.target_device_serial.is_empty()
                                    || envelope.target_device_serial == device_serial
                                {
                                    if let Some(command) = envelope.command {
                                        if let Err(e) = tx_sender_clone.send(command) {
                                            warn!("Failed to forward TX command: {}", e);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("Failed to decode TX envelope: {}", e);
                            }
                        }
                    }
                    true
                }),
            )
            .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

        // Enable feedback mode for continuous status packets
        let enable_feedback = Frame::write(protocol::REG_ENABLE_FEEDBACK, vec![0x01]);
        if let Err(e) = self.write_frame(&mut serial, &enable_feedback).await {
            warn!("Failed to enable feedback mode: {}", e);
        }

        // Main loop: feedback stream + TX commands
        let result = self.feedback_loop(&mut serial, tx_receiver).await;

        // Cleanup subscription
        normfs.unsubscribe(&tx_queue_id, subscription_id);

        result
    }

    /// Main loop that streams feedback packets and handles TX commands
    async fn feedback_loop(
        &mut self,
        serial: &mut SerialStream,
        mut tx_receiver: mpsc::UnboundedReceiver<Command>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut buffer = Vec::with_capacity(128);
        let mut temp = [0u8; 128];

        loop {
            tokio::select! {
                biased;
                // Handle TX commands with priority
                Some(command) = tx_receiver.recv() => {
                    self.process_command(serial, &command).await;
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

    fn try_parse_feedback_packet(&self, buffer: &mut Vec<u8>) -> Option<DogzillaStatus> {
        let header = [
            protocol::FEEDBACK_HEADER_BYTE_1,
            protocol::FEEDBACK_HEADER_BYTE_2,
        ];
        let tail = [
            protocol::FEEDBACK_TAIL_BYTE_1,
            protocol::FEEDBACK_TAIL_BYTE_2,
        ];

        let start = match buffer.windows(2).position(|window| window == header) {
            Some(index) => index,
            None => {
                let keep = buffer.last().copied().filter(|&b| b == header[0]);
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
        let tail_ok = packet[protocol::FEEDBACK_PACKET_SIZE - 2] == tail[0]
            && packet[protocol::FEEDBACK_PACKET_SIZE - 1] == tail[1];

        if !tail_ok {
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

    fn feedback_packet_to_status(&self, packet: &FeedbackPacket) -> DogzillaStatus {
        let servo_positions: Vec<u32> = packet.servo_positions.iter().map(|&b| b as u32).collect();
        let servo_angles: Vec<f32> = packet
            .servo_positions
            .iter()
            .enumerate()
            .map(|(i, &raw)| {
                let limit = protocol::get_servo_limit_lite(i);
                protocol::servo_position_to_angle(raw, limit)
            })
            .collect();

        DogzillaStatus {
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

    /// Process a command received from the dashboard
    async fn process_command(&mut self, serial: &mut SerialStream, command: &Command) {
        let effect = compute_command_effect(command);

        for write in effect.servo_writes {
            let frame = Frame::write(write.register, vec![write.position]);

            info!(
                "Sending servo command: id={} reg=0x{:02X} pos={}",
                write.servo_id, write.register, write.position
            );

            if let Err(e) = self.write_frame(serial, &frame).await {
                error!("Failed to write servo command: {}", e);
            }
        }

        if let Some(body_speed) = effect.leg_servo_speed {
            let body_speed_u8 = body_speed as u8;
            let frame = Frame::write(protocol::REG_SERVO_SPEED, vec![body_speed_u8]);

            info!("Sending leg servo speed: {}", body_speed_u8);
            if let Err(e) = self.write_frame(serial, &frame).await {
                error!("Failed to write leg servo speed: {}", e);
            } else {
                self.leg_servo_speed = body_speed;
            }
        }

        if let Some(arm_speed) = effect.arm_servo_speed {
            let arm_speed_u8 = arm_speed as u8;
            let frame = Frame::write(protocol::REG_SERVO_ARM_SPEED, vec![arm_speed_u8]);

            info!("Sending arm servo speed: {}", arm_speed_u8);
            if let Err(e) = self.write_frame(serial, &frame).await {
                error!("Failed to write arm servo speed: {}", e);
            } else {
                self.arm_servo_speed = arm_speed;
            }
        }

        // Handle action command
        if let Some(action_cmd) = &command.action {
            let action_value = action_cmd.action as u8;
            if action_value > 0 {
                let frame = Frame::write(protocol::REG_ACTION, vec![action_value]);

                info!("Sending action command: action={}", action_value);
                if let Err(e) = self.write_frame(serial, &frame).await {
                    error!("Failed to write action command: {}", e);
                }
            }
        }

        if let Some(movement) = &command.movement {
            let move_x = (movement.move_x as u8).clamp(0, 255);
            let move_y = (movement.move_y as u8).clamp(0, 255);
            let move_yaw = (movement.move_yaw as u8).clamp(0, 255);

            let frame_x = Frame::write(protocol::REG_MOVE_X, vec![move_x]);
            if let Err(e) = self.write_frame(serial, &frame_x).await {
                error!("Failed to write move_x: {}", e);
            }

            let frame_y = Frame::write(protocol::REG_MOVE_Y, vec![move_y]);
            if let Err(e) = self.write_frame(serial, &frame_y).await {
                error!("Failed to write move_y: {}", e);
            }

            let frame_yaw = Frame::write(protocol::REG_MOVE_YAW, vec![move_yaw]);
            if let Err(e) = self.write_frame(serial, &frame_yaw).await {
                error!("Failed to write move_yaw: {}", e);
            }

            info!("Movement: x={} y={} yaw={}", move_x, move_y, move_yaw);
        }
    }

    /// Send status update via RX envelope (state update handled internally by communicator)
    fn update_and_send_status(&self, status: DogzillaStatus) {
        send_status_update(&self.com, &self.device_info, status);
    }

    pub async fn write_frame(
        &mut self,
        serial: &mut SerialStream,
        frame: &Frame,
    ) -> Result<(), DogzillaError> {
        let data = frame.encode();

        match timeout(
            WRITE_TIMEOUT,
            tokio::io::AsyncWriteExt::write_all(serial, &data),
        )
        .await
        {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(e)) => {
                error!("Serial write error: {}", e);
                Err(DogzillaError::SerialError(e.to_string()))
            }
            Err(_) => {
                error!("Serial write timeout");
                Err(DogzillaError::Timeout)
            }
        }
    }
}

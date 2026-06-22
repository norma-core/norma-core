use crate::yahboom_dogzilla_lite_proto::{Command, ServoSpeedCommand, TxEnvelope, servo_speed_command};
use parking_lot::Mutex;
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::mpsc;

const DISCRETE_QUEUE_CAPACITY: usize = 64;
const WAKE_QUEUE_CAPACITY: usize = 1;

pub(crate) struct CommandInbox {
    discrete_tx: mpsc::Sender<TxEnvelope>,
    wake_tx: mpsc::Sender<()>,
    pending: Arc<Mutex<PendingCommands>>,
}

pub(crate) struct CommandReceiver {
    discrete_rx: mpsc::Receiver<TxEnvelope>,
    wake_rx: mpsc::Receiver<()>,
    pending: Arc<Mutex<PendingCommands>>,
}

#[derive(Default)]
struct PendingCommands {
    servos: BTreeMap<u32, TxEnvelope>,
    leg_speed: Option<TxEnvelope>,
    arm_speed: Option<TxEnvelope>,
    movement: Option<TxEnvelope>,
}

pub(crate) fn command_inbox() -> (CommandInbox, CommandReceiver) {
    let (discrete_tx, discrete_rx) = mpsc::channel(DISCRETE_QUEUE_CAPACITY);
    let (wake_tx, wake_rx) = mpsc::channel(WAKE_QUEUE_CAPACITY);
    let pending = Arc::new(Mutex::new(PendingCommands::default()));

    (
        CommandInbox {
            discrete_tx,
            wake_tx,
            pending: pending.clone(),
        },
        CommandReceiver {
            discrete_rx,
            wake_rx,
            pending,
        },
    )
}

impl CommandInbox {
    pub(crate) fn push(&self, envelope: TxEnvelope) -> Result<(), &'static str> {
        if is_coalesced_envelope(&envelope) {
            self.pending.lock().merge(envelope);
            match self.wake_tx.try_send(()) {
                Ok(()) | Err(mpsc::error::TrySendError::Full(_)) => Ok(()),
                Err(mpsc::error::TrySendError::Closed(_)) => Err("command receiver closed"),
            }
        } else {
            match self.discrete_tx.try_send(envelope) {
                Ok(()) => Ok(()),
                Err(mpsc::error::TrySendError::Full(_)) => Err("discrete command queue full"),
                Err(mpsc::error::TrySendError::Closed(_)) => Err("command receiver closed"),
            }
        }
    }
}

impl CommandReceiver {
    pub(crate) async fn recv(&mut self) -> Option<TxEnvelope> {
        loop {
            if let Some(envelope) = self.pending.lock().pop_next() {
                return Some(envelope);
            }

            tokio::select! {
                envelope = self.discrete_rx.recv() => {
                    if envelope.is_some() {
                        return envelope;
                    }
                    if self.wake_rx.is_closed() {
                        return None;
                    }
                }
                wake = self.wake_rx.recv() => {
                    if wake.is_none() && self.discrete_rx.is_closed() {
                        return None;
                    }
                }
            }
        }
    }
}

impl PendingCommands {
    fn merge(&mut self, envelope: TxEnvelope) {
        let Some(command) = envelope.command.as_ref() else {
            return;
        };

        if let Some(servo) = command.servo.clone() {
            self.servos.insert(
                servo.servo_id,
                envelope_with_command(
                    &envelope,
                    Command {
                        target_device_serial: command.target_device_serial.clone(),
                        servo: Some(servo),
                        ..Default::default()
                    },
                ),
            );
        }

        if let Some(speed) = command.servo_speed.clone() {
            if let Some(servo_speed_command::BodySpeed::BodyServoSpeed(value)) = speed.body_speed {
                self.leg_speed = Some(envelope_with_command(
                    &envelope,
                    Command {
                        target_device_serial: command.target_device_serial.clone(),
                        servo_speed: Some(ServoSpeedCommand {
                            body_speed: Some(servo_speed_command::BodySpeed::BodyServoSpeed(value)),
                            arm_speed: None,
                        }),
                        ..Default::default()
                    },
                ));
            }
            if let Some(servo_speed_command::ArmSpeed::ArmServoSpeed(value)) = speed.arm_speed {
                self.arm_speed = Some(envelope_with_command(
                    &envelope,
                    Command {
                        target_device_serial: command.target_device_serial.clone(),
                        servo_speed: Some(ServoSpeedCommand {
                            body_speed: None,
                            arm_speed: Some(servo_speed_command::ArmSpeed::ArmServoSpeed(value)),
                        }),
                        ..Default::default()
                    },
                ));
            }
        }

        if let Some(movement) = command.movement.clone() {
            self.movement = Some(envelope_with_command(
                &envelope,
                Command {
                    target_device_serial: command.target_device_serial.clone(),
                    movement: Some(movement),
                    ..Default::default()
                },
            ));
        }
    }

    fn pop_next(&mut self) -> Option<TxEnvelope> {
        if let Some(envelope) = self.movement.take() {
            return Some(envelope);
        }

        if let Some(envelope) = self.leg_speed.take() {
            return Some(envelope);
        }

        if let Some(envelope) = self.arm_speed.take() {
            return Some(envelope);
        }

        self.servos.pop_first().map(|(_, envelope)| envelope)
    }
}

fn envelope_with_command(envelope: &TxEnvelope, command: Command) -> TxEnvelope {
    let mut next = envelope.clone();
    next.command = Some(command);
    next
}

fn is_coalesced_envelope(envelope: &TxEnvelope) -> bool {
    envelope.command.as_ref().is_some_and(is_coalesced_command)
}

fn is_coalesced_command(command: &Command) -> bool {
    command.calibration.is_none()
        && command.arm.is_none()
        && command.io.is_none()
        && command.config.is_none()
        && command.led.is_none()
        && command.action.is_none()
        && (command.servo.is_some() || command.servo_speed.is_some() || command.movement.is_some())
}

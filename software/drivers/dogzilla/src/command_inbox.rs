use crate::dogzilla_proto::{
    Command, MovementCommand, ServoCommand, ServoSpeedCommand, servo_speed_command,
};
use parking_lot::Mutex;
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::mpsc;

const DISCRETE_QUEUE_CAPACITY: usize = 64;
const WAKE_QUEUE_CAPACITY: usize = 1;

pub(crate) struct CommandInbox {
    discrete_tx: mpsc::Sender<Command>,
    wake_tx: mpsc::Sender<()>,
    pending: Arc<Mutex<PendingCommands>>,
}

pub(crate) struct CommandReceiver {
    discrete_rx: mpsc::Receiver<Command>,
    wake_rx: mpsc::Receiver<()>,
    pending: Arc<Mutex<PendingCommands>>,
}

#[derive(Default)]
struct PendingCommands {
    servos: BTreeMap<u32, ServoCommand>,
    leg_speed: Option<u32>,
    arm_speed: Option<u32>,
    movement: Option<MovementCommand>,
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
    pub(crate) fn push(&self, command: Command) -> Result<(), &'static str> {
        if is_coalesced_command(&command) {
            self.pending.lock().merge(command);
            match self.wake_tx.try_send(()) {
                Ok(()) | Err(mpsc::error::TrySendError::Full(_)) => Ok(()),
                Err(mpsc::error::TrySendError::Closed(_)) => Err("command receiver closed"),
            }
        } else {
            match self.discrete_tx.try_send(command) {
                Ok(()) => Ok(()),
                Err(mpsc::error::TrySendError::Full(_)) => Err("discrete command queue full"),
                Err(mpsc::error::TrySendError::Closed(_)) => Err("command receiver closed"),
            }
        }
    }
}

impl CommandReceiver {
    pub(crate) async fn recv(&mut self) -> Option<Command> {
        loop {
            if let Some(command) = self.pending.lock().pop_next() {
                return Some(command);
            }

            tokio::select! {
                command = self.discrete_rx.recv() => {
                    if command.is_some() {
                        return command;
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
    fn merge(&mut self, command: Command) {
        if let Some(servo) = command.servo {
            self.servos.insert(servo.servo_id, servo);
        }

        if let Some(speed) = command.servo_speed {
            if let Some(servo_speed_command::BodySpeed::BodyServoSpeed(value)) = speed.body_speed {
                self.leg_speed = Some(value);
            }
            if let Some(servo_speed_command::ArmSpeed::ArmServoSpeed(value)) = speed.arm_speed {
                self.arm_speed = Some(value);
            }
        }

        if let Some(movement) = command.movement {
            self.movement = Some(movement);
        }
    }

    fn pop_next(&mut self) -> Option<Command> {
        if let Some((_, servo)) = self.servos.pop_first() {
            return Some(Command {
                servo: Some(servo),
                ..Default::default()
            });
        }

        if self.leg_speed.is_some() || self.arm_speed.is_some() {
            return Some(Command {
                servo_speed: Some(ServoSpeedCommand {
                    body_speed: self
                        .leg_speed
                        .take()
                        .map(servo_speed_command::BodySpeed::BodyServoSpeed),
                    arm_speed: self
                        .arm_speed
                        .take()
                        .map(servo_speed_command::ArmSpeed::ArmServoSpeed),
                }),
                ..Default::default()
            });
        }

        self.movement.take().map(|movement| Command {
            movement: Some(movement),
            ..Default::default()
        })
    }
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

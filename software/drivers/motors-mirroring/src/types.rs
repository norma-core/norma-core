use crate::proto::mirroring;

#[derive(Debug, Clone, PartialEq)]
pub struct Command {
    pub target_bus_id: String,
    pub motor_id: u32,
    pub command: MotorCommand,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MotorCommand {
    Speed(u16),
    Accel(u16),
    Goal(u16),
    Torque(u8),
    TorqueLimit(u16),
}

#[derive(Hash, Eq, PartialEq, Clone, Debug)]
pub struct BusKey {
    pub bus_id: String,
    pub bus_type: mirroring::BusType,
}
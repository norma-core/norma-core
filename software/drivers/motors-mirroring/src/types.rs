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
    /// Writes `EepromRegister::Mode` (0 = position, 2 = open-loop PWM). An
    /// EEPROM register - must be bracketed by `EepromLock(0)` before and
    /// `EepromLock(1)` after, see `gravity_comp_pwm::send_setup_commands`.
    Mode(u8),
    /// Writes `RamRegister::Lock`, which gates EEPROM writes (0 = unlock,
    /// 1 = lock). Despite the name this is a RAM register, not EEPROM.
    EepromLock(u8),
    /// Writes `RamRegister::GoalTime`, reinterpreted as a signed PWM duty
    /// cycle (native range roughly ±1000) while the motor's `Mode` is 2. No
    /// effect in position mode (0). Encoded via
    /// `st3215::protocol::encode_direction_bit(value, 10)`.
    Pwm(i16),
}

#[derive(Hash, Eq, PartialEq, Clone, Debug)]
pub struct BusKey {
    pub bus_id: String,
    pub bus_type: mirroring::BusType,
}
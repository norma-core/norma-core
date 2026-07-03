pub mod arduino_nicla_sense_env_proto {
    include!("proto/arduino_nicla_sense_env.rs");
}

mod driver;

pub use driver::{
    ArduinoNiclaSenseEnvBoardConfig, ArduinoNiclaSenseEnvDriver, ArduinoNiclaSenseEnvDriverConfig,
    DEFAULT_I2C_ADDRESS, RAW_REGISTER_LENGTH, RAW_REGISTER_START, RX_QUEUE_ID,
    start_arduino_nicla_sense_env_driver,
};

pub mod arduino_nicla_sense_me_proto {
    include!("proto/arduino_nicla_sense_me.rs");
}

mod driver;

pub use driver::{
    ArduinoNiclaSenseMeBoardConfig, ArduinoNiclaSenseMeDriver, ArduinoNiclaSenseMeDriverConfig,
    DEFAULT_I2C_ADDRESS, RAW_REGISTER_LENGTH, RAW_REGISTER_START, RX_QUEUE_ID,
    start_arduino_nicla_sense_me_driver,
};

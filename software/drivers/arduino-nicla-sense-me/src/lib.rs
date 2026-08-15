pub mod arduino_nicla_sense_me_proto {
    include!("proto/arduino_nicla_sense_me.rs");
}

mod driver;

pub use driver::{
    ArduinoNiclaSenseMeBoardConfig, ArduinoNiclaSenseMeDriver, ArduinoNiclaSenseMeDriverConfig,
    ArduinoNiclaSenseMeTransport, DEFAULT_I2C_ADDRESS, RAW_REGISTER_LENGTH, RAW_REGISTER_START,
    RX_QUEUE_ID, USB_PID, USB_VID, find_usb_port, read_dump,
    start_arduino_nicla_sense_me_driver,
};

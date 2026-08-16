pub mod arduino_nicla_sense_me_proto {
    include!("proto/arduino_nicla_sense_me.rs");
}

mod driver;

pub use driver::{
    ArduinoNiclaSenseMeBoardConfig, ArduinoNiclaSenseMeDriver, ArduinoNiclaSenseMeDriverConfig,
    ArduinoNiclaSenseMeTransport, DEFAULT_I2C_ADDRESS, MOTION_RING_CAPACITY, MOTION_SAMPLE_SIZE,
    RAW_REGISTER_LENGTH, RAW_REGISTER_START, RX_QUEUE_ID, SERIAL_CMD_MOTION, USB_PID, USB_VID,
    find_usb_port, read_dump, read_motion_batch, start_arduino_nicla_sense_me_driver,
};

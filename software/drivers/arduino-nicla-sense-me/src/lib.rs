pub mod arduino_nicla_sense_me_proto {
    include!("proto/arduino_nicla_sense_me.rs");
}

mod driver;

pub use driver::{
    ArduinoNiclaSenseMeDriver, FrameScanner, RAW_REGISTER_LENGTH, RX_QUEUE_PREFIX, SERIAL_BAUD,
    SERIAL_CMD_STREAM_START, SERIAL_CMD_STREAM_STOP, USB_PID, USB_VID, list_usb_ports,
    prepare_port, read_frame, rx_queue_id, serial_hex, start_arduino_nicla_sense_me_driver,
};

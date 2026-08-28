pub mod arduino_pro_4g_gnss_proto {
    include!("proto/arduino_pro_4g_gnss.rs");
}

mod discovery;
mod driver;
mod nmea;
mod power;
mod setup;
mod xtra;

pub use driver::{
    ArduinoPro4gGnssDriver, ArduinoPro4gGnssDriverConfig, QUEUE_ID, USB_PID, USB_VID,
    start_arduino_pro_4g_gnss_driver,
};
pub use nmea::{EpochBatcher, validate_nmea_sentence};

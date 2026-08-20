pub mod pwm_output_proto {
    include!("proto/pwm_output.rs");
}

mod driver;

pub use driver::{
    DEFAULT_DEVICE_PATH, PwmOutputDeviceConfig, PwmOutputDriver, PwmOutputDriverConfig,
    RX_QUEUE_ID, TX_QUEUE_ID, start_pwm_output_driver,
};

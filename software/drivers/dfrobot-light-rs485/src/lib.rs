pub mod dfrobot_light_rs485_proto {
    include!("proto/dfrobot_light_rs485.rs");
}

mod driver;
mod modbus;
mod sensors;

pub use driver::{
    DfrobotLightRs485Driver, DfrobotLightRs485DriverConfig, default_scan_ids, parse_scan_ids,
    sanitize_scan_ids, start_dfrobot_light_rs485_driver,
};
pub use sensors::SensorModel;

pub mod dfrobot_rs485_proto {
    include!("proto/dfrobot_rs485.rs");
}

mod driver;
mod modbus;
mod sensors;

pub use driver::{
    DfrobotRs485Driver, DfrobotRs485DriverConfig, DfrobotSensorConfig, default_scan_ids,
    parse_scan_ids, sanitize_scan_ids, start_dfrobot_rs485_driver,
};
pub use sensors::SensorModel;

pub mod ina226_proto {
    include!("proto/ina226.rs");
}

mod driver;

pub use driver::{
    DEFAULT_I2C_ADDRESS, DUMP_REGISTERS, Ina226DeviceConfig, Ina226Driver, Ina226DriverConfig,
    REGISTER_COUNT, REGISTER_LENGTH, RX_QUEUE_ID, start_ina226_driver,
};

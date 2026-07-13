pub mod victron_smartsolar_mppt_proto {
    include!("proto/victron_smartsolar_mppt.rs");
}

mod driver;
mod hex;
mod parse;
mod port;
mod registers;

pub use driver::{
    DEFAULT_READ_TIMEOUT, QUEUE_PREFIX, VictronSmartSolarMpptDriver,
    VictronSmartSolarMpptDriverConfig, start_victron_smartsolar_mppt_driver,
};

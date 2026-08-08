pub mod protocol;

pub mod vesc_trampa_proto {
    include!("proto/vesc_trampa.rs");
}

mod driver;
mod port;
mod state;

pub use driver::{VescTrampaDriver, VescTrampaDriverConfig, start_vesc_trampa_driver};

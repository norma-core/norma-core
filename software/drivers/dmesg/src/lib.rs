pub mod dmesg_proto {
    include!("proto/dmesg.rs");
}

mod driver;
mod reader;

pub use driver::{DmesgDriver, QUEUE_ID, start_dmesg_driver};

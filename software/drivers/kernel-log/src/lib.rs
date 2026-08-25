pub mod kernel_log_proto {
    include!("proto/kernel_log.rs");
}

mod driver;
mod matcher;
mod parser;
mod reader;

pub use driver::{KernelLogDriver, QUEUE_ID, start_kernel_log_driver};

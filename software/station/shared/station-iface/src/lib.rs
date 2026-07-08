pub mod config;
mod traits;

pub const COMMANDS_QUEUE_ID: &str = "commands";

pub use traits::*;

pub mod iface_proto {
    pub mod drivers {
        include!("proto/drivers.rs");
    }
    pub mod opts {
        include!("proto/opts.rs");
    }
    pub mod envelope {
        include!("proto/station.rs");
    }
    pub mod commands {
        include!("proto/commands.rs");
    }
    pub mod inference {
        include!("proto/inference.rs");
    }
}

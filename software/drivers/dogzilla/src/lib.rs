pub mod dogzilla_proto {
    include!(concat!(env!("OUT_DIR"), "/dogzilla.rs"));
}

mod command_inbox;
mod driver;
mod errors;
mod port;
mod protocol;
mod shared;
mod sim;
mod state;

pub use driver::{DogzillaDriver, start_dogzilla_driver};

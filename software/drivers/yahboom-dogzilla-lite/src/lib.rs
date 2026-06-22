pub mod yahboom_dogzilla_lite_proto {
    include!(concat!(env!("OUT_DIR"), "/yahboom_dogzilla_lite.rs"));
}

mod command_inbox;
mod driver;
mod errors;
mod port;
mod protocol;
mod shared;
mod sim;
mod state;

pub use driver::{YahboomDogzillaLiteDriver, start_yahboom_dogzilla_lite_driver};

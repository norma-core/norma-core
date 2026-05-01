pub mod dogzilla_proto {
    include!("proto/dogzilla.rs");
}

mod driver;
mod errors;
mod port;
mod protocol;
mod shared;
mod sim;
mod state;

pub use driver::{DogzillaDriver, start_dogzilla_driver};
pub use errors::DogzillaError;

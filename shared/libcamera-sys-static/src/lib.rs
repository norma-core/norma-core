//! Low-level FFI bindings to libcamera via C wrapper.
//!
//! This crate provides unsafe bindings to libcamera's C++ API through
//! a thin C wrapper layer.

#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(dead_code)]

include!(concat!(env!("OUT_DIR"), "/bindings.rs"));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_values() {
        assert_eq!(lc_status_t_LC_STATUS_OK, 0);
        assert_eq!(lc_status_t_LC_STATUS_ERROR, -1);
    }
}

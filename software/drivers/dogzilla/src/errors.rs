use std::fmt;

#[derive(Debug, Clone)]
pub enum DogzillaError {
    IoError(String),
    InvalidChecksum,
    InvalidHeader,
    InvalidFrame,
    Timeout,
    DeviceNotFound,
    SerialError(String),
}

impl fmt::Display for DogzillaError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            DogzillaError::IoError(s) => write!(f, "IO error: {}", s),
            DogzillaError::InvalidChecksum => write!(f, "Invalid checksum"),
            DogzillaError::InvalidHeader => write!(f, "Invalid frame header"),
            DogzillaError::InvalidFrame => write!(f, "Invalid frame"),
            DogzillaError::Timeout => write!(f, "Operation timeout"),
            DogzillaError::DeviceNotFound => write!(f, "Device not found"),
            DogzillaError::SerialError(s) => write!(f, "Serial error: {}", s),
        }
    }
}

impl std::error::Error for DogzillaError {}

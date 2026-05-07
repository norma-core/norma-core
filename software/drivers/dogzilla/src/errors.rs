use std::fmt;

#[derive(Debug, Clone)]
pub(crate) enum DogzillaError {
    InvalidChecksum,
    InvalidHeader,
    InvalidFrame,
    Timeout,
    SerialError(String),
    UnsupportedCommand(String),
}

impl fmt::Display for DogzillaError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            DogzillaError::InvalidChecksum => write!(f, "Invalid checksum"),
            DogzillaError::InvalidHeader => write!(f, "Invalid frame header"),
            DogzillaError::InvalidFrame => write!(f, "Invalid frame"),
            DogzillaError::Timeout => write!(f, "Operation timeout"),
            DogzillaError::SerialError(s) => write!(f, "Serial error: {}", s),
            DogzillaError::UnsupportedCommand(s) => write!(f, "Unsupported command: {}", s),
        }
    }
}

impl std::error::Error for DogzillaError {}

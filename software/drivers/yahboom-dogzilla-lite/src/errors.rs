use std::fmt;

#[derive(Debug, Clone)]
pub(crate) enum YahboomDogzillaLiteError {
    InvalidChecksum,
    InvalidHeader,
    InvalidFrame,
    Timeout,
    SerialError(String),
    UnsupportedCommand(String),
}

impl fmt::Display for YahboomDogzillaLiteError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            YahboomDogzillaLiteError::InvalidChecksum => write!(f, "Invalid checksum"),
            YahboomDogzillaLiteError::InvalidHeader => write!(f, "Invalid frame header"),
            YahboomDogzillaLiteError::InvalidFrame => write!(f, "Invalid frame"),
            YahboomDogzillaLiteError::Timeout => write!(f, "Operation timeout"),
            YahboomDogzillaLiteError::SerialError(s) => write!(f, "Serial error: {}", s),
            YahboomDogzillaLiteError::UnsupportedCommand(s) => write!(f, "Unsupported command: {}", s),
        }
    }
}

impl std::error::Error for YahboomDogzillaLiteError {}

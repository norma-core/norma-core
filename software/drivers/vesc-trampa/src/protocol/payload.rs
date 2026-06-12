use bytes::{BufMut, Bytes, BytesMut};
use std::fmt;
use std::ops::Range;
use std::str;
use tokio::io::{AsyncRead, AsyncWrite};

use super::{CommPacket, PacketError};

pub const COMM_FW_VERSION: u8 = 0;
pub const COMM_GET_MCCONF: u8 = 14;
pub const COMM_GET_APPCONF: u8 = 17;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayloadError {
    EmptyPayload,
    UnexpectedPacketId {
        expected: u8,
        actual: u8,
        source_payload: Bytes,
    },
    ResponseTypeMismatch {
        expected: &'static str,
        actual_packet_id: u8,
        source_payload: Bytes,
    },
    MissingBytes {
        field: &'static str,
        expected_len: usize,
        actual_len: usize,
        source_payload: Bytes,
    },
    UnterminatedString {
        field: &'static str,
        source_payload: Bytes,
    },
}

impl fmt::Display for PayloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPayload => write!(f, "empty VESC command payload"),
            Self::UnexpectedPacketId {
                expected, actual, ..
            } => write!(
                f,
                "unexpected VESC packet id: expected {expected:#04x}, got {actual:#04x}"
            ),
            Self::ResponseTypeMismatch {
                expected,
                actual_packet_id,
                ..
            } => write!(
                f,
                "VESC response type mismatch: expected {expected}, got packet id {actual_packet_id:#04x}"
            ),
            Self::MissingBytes {
                field,
                expected_len,
                actual_len,
                ..
            } => write!(
                f,
                "missing bytes for VESC firmware info field '{field}': expected {expected_len}, got {actual_len}"
            ),
            Self::UnterminatedString { field, .. } => {
                write!(f, "unterminated VESC firmware info string field '{field}'")
            }
        }
    }
}

impl std::error::Error for PayloadError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VescRequest {
    FirmwareInfo,
    MotorConfig,
    AppConfig,
}

impl VescRequest {
    fn command(&self) -> u8 {
        match self {
            Self::FirmwareInfo => COMM_FW_VERSION,
            Self::MotorConfig => COMM_GET_MCCONF,
            Self::AppConfig => COMM_GET_APPCONF,
        }
    }

    pub fn to_bytes(&self) -> Bytes {
        let mut payload = BytesMut::with_capacity(1);
        payload.put_u8(self.command());
        payload.freeze()
    }

    pub fn to_packet(&self) -> Result<CommPacket, PacketError> {
        CommPacket::new(self.to_bytes())
    }

    pub async fn async_write<W: AsyncWrite + Unpin>(
        &self,
        writer: &mut W,
        timeout_ms: u64,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.to_packet()?.async_write(writer, timeout_ms).await
    }

    pub async fn async_readwrite<RW: AsyncRead + AsyncWrite + Unpin>(
        &self,
        stream: &mut RW,
        timeout_ms: u64,
    ) -> Result<VescResponse, Box<dyn std::error::Error + Send + Sync>> {
        self.async_write(stream, timeout_ms).await?;
        let response_packet = CommPacket::async_read(stream, timeout_ms).await?;
        Ok(VescResponse::parse(self, response_packet.into_payload())?)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VescResponse {
    FirmwareInfo {
        info: FirmwareInfoPayload,
        source_bytes: Bytes,
    },
    MotorConfig {
        config: MotorConfigPayload,
        source_bytes: Bytes,
    },
    AppConfig {
        config: AppConfigPayload,
        source_bytes: Bytes,
    },
}

impl VescResponse {
    pub fn parse(request: &VescRequest, source_bytes: Bytes) -> Result<Self, PayloadError> {
        let actual_packet_id = *source_bytes.first().ok_or(PayloadError::EmptyPayload)?;

        match request {
            VescRequest::FirmwareInfo => {
                if actual_packet_id != COMM_FW_VERSION {
                    return Err(PayloadError::ResponseTypeMismatch {
                        expected: "FirmwareInfo",
                        actual_packet_id,
                        source_payload: source_bytes,
                    });
                }

                let info = FirmwareInfoPayload::parse(source_bytes.clone())?;
                Ok(Self::FirmwareInfo { info, source_bytes })
            }
            VescRequest::MotorConfig => {
                if actual_packet_id != COMM_GET_MCCONF {
                    return Err(PayloadError::ResponseTypeMismatch {
                        expected: "MotorConfig",
                        actual_packet_id,
                        source_payload: source_bytes,
                    });
                }

                let config = MotorConfigPayload::parse(source_bytes.clone())?;
                Ok(Self::MotorConfig {
                    config,
                    source_bytes,
                })
            }
            VescRequest::AppConfig => {
                if actual_packet_id != COMM_GET_APPCONF {
                    return Err(PayloadError::ResponseTypeMismatch {
                        expected: "AppConfig",
                        actual_packet_id,
                        source_payload: source_bytes,
                    });
                }

                let config = AppConfigPayload::parse(source_bytes.clone())?;
                Ok(Self::AppConfig {
                    config,
                    source_bytes,
                })
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MotorConfigPayload {
    payload: Bytes,
}

impl MotorConfigPayload {
    pub fn parse(payload: Bytes) -> Result<Self, PayloadError> {
        require_exact_id(&payload, COMM_GET_MCCONF)?;
        Ok(Self { payload })
    }

    pub fn raw_payload(&self) -> &Bytes {
        &self.payload
    }

    pub fn command_id(&self) -> u8 {
        self.payload[0]
    }

    pub fn config_bytes(&self) -> &[u8] {
        &self.payload[1..]
    }
}

impl fmt::Display for MotorConfigPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "command_id={}, config_len={}, raw_payload_len={}",
            self.command_id(),
            self.config_bytes().len(),
            self.raw_payload().len(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfigPayload {
    payload: Bytes,
}

impl AppConfigPayload {
    pub fn parse(payload: Bytes) -> Result<Self, PayloadError> {
        require_exact_id(&payload, COMM_GET_APPCONF)?;
        Ok(Self { payload })
    }

    pub fn raw_payload(&self) -> &Bytes {
        &self.payload
    }

    pub fn command_id(&self) -> u8 {
        self.payload[0]
    }

    pub fn config_bytes(&self) -> &[u8] {
        &self.payload[1..]
    }
}

impl fmt::Display for AppConfigPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "command_id={}, config_len={}, raw_payload_len={}",
            self.command_id(),
            self.config_bytes().len(),
            self.raw_payload().len(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FirmwareInfoPayload {
    payload: Bytes,
    hardware_name: Range<usize>,
    uuid: Option<Range<usize>>,
    pairing_done: Option<usize>,
    test_version_number: Option<usize>,
    hardware_type: Option<usize>,
    custom_config_count: Option<usize>,
    has_phase_filters: Option<usize>,
    qml_hw: Option<usize>,
    qml_app: Option<usize>,
    nrf_flags: Option<usize>,
    firmware_name: Option<Range<usize>>,
    hardware_config_crc: Option<Range<usize>>,
    extra: Range<usize>,
}

impl FirmwareInfoPayload {
    pub fn parse(payload: Bytes) -> Result<Self, PayloadError> {
        require_exact_id(&payload, COMM_FW_VERSION)?;
        require_len(&payload, 3, "firmware_version")?;

        let mut idx = 3;
        let hardware_name = take_c_string(&payload, &mut idx, "hardware_name")?;

        let uuid = take_optional_range(&payload, &mut idx, 12, "uuid")?;
        let pairing_done = take_optional_u8(&payload, &mut idx, "pairing_done")?;
        let test_version_number = take_optional_u8(&payload, &mut idx, "test_version_number")?;
        let hardware_type = take_optional_u8(&payload, &mut idx, "hardware_type")?;
        let custom_config_count = take_optional_u8(&payload, &mut idx, "custom_config_count")?;
        let has_phase_filters = take_optional_u8(&payload, &mut idx, "has_phase_filters")?;
        let qml_hw = take_optional_u8(&payload, &mut idx, "qml_hw")?;
        let qml_app = take_optional_u8(&payload, &mut idx, "qml_app")?;
        let nrf_flags = take_optional_u8(&payload, &mut idx, "nrf_flags")?;

        let firmware_name = if idx < payload.len() {
            Some(take_c_string(&payload, &mut idx, "firmware_name")?)
        } else {
            None
        };

        let hardware_config_crc =
            take_optional_range(&payload, &mut idx, 4, "hardware_config_crc")?;
        let extra = idx..payload.len();

        Ok(Self {
            payload,
            hardware_name,
            uuid,
            pairing_done,
            test_version_number,
            hardware_type,
            custom_config_count,
            has_phase_filters,
            qml_hw,
            qml_app,
            nrf_flags,
            firmware_name,
            hardware_config_crc,
            extra,
        })
    }

    pub fn raw_payload(&self) -> &Bytes {
        &self.payload
    }

    pub fn command_id(&self) -> u8 {
        self.payload[0]
    }

    pub fn major(&self) -> u8 {
        self.payload[1]
    }

    pub fn minor(&self) -> u8 {
        self.payload[2]
    }

    pub fn hardware_name_bytes(&self) -> &[u8] {
        &self.payload[self.hardware_name.clone()]
    }

    pub fn hardware_name(&self) -> Result<&str, str::Utf8Error> {
        str::from_utf8(self.hardware_name_bytes())
    }

    pub fn uuid(&self) -> Option<&[u8]> {
        self.uuid.as_ref().map(|range| &self.payload[range.clone()])
    }

    pub fn pairing_done(&self) -> Option<bool> {
        self.u8_at(self.pairing_done).map(|value| value != 0)
    }

    pub fn test_version_number(&self) -> Option<u8> {
        self.u8_at(self.test_version_number)
    }

    pub fn hardware_type(&self) -> Option<u8> {
        self.u8_at(self.hardware_type)
    }

    pub fn custom_config_count(&self) -> Option<u8> {
        self.u8_at(self.custom_config_count)
    }

    pub fn has_phase_filters(&self) -> Option<bool> {
        self.u8_at(self.has_phase_filters).map(|value| value != 0)
    }

    pub fn qml_hw(&self) -> Option<u8> {
        self.u8_at(self.qml_hw)
    }

    pub fn qml_app(&self) -> Option<u8> {
        self.u8_at(self.qml_app)
    }

    pub fn nrf_flags(&self) -> Option<u8> {
        self.u8_at(self.nrf_flags)
    }

    pub fn firmware_name_bytes(&self) -> Option<&[u8]> {
        self.firmware_name
            .as_ref()
            .map(|range| &self.payload[range.clone()])
    }

    pub fn firmware_name(&self) -> Option<Result<&str, str::Utf8Error>> {
        self.firmware_name_bytes().map(str::from_utf8)
    }

    pub fn hardware_config_crc(&self) -> Option<u32> {
        self.hardware_config_crc.as_ref().map(|range| {
            let bytes = &self.payload[range.clone()];
            u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        })
    }

    pub fn extra_bytes(&self) -> &[u8] {
        &self.payload[self.extra.clone()]
    }

    fn u8_at(&self, offset: Option<usize>) -> Option<u8> {
        offset.map(|offset| self.payload[offset])
    }
}

impl fmt::Display for FirmwareInfoPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "command_id={}, version={}.{}, hardware_name={}, uuid={}, pairing_done={}, test_version_number={}, hardware_type={}, custom_config_count={}, has_phase_filters={}, qml_hw={}, qml_app={}, nrf_flags={}, firmware_name={}, hardware_config_crc={}, extra_bytes={}, raw_payload_len={}",
            self.command_id(),
            self.major(),
            self.minor(),
            format_str_result(self.hardware_name()),
            format_optional_bytes(self.uuid()),
            format_optional_bool(self.pairing_done()),
            format_optional_u8(self.test_version_number()),
            format_optional_u8(self.hardware_type()),
            format_optional_u8(self.custom_config_count()),
            format_optional_bool(self.has_phase_filters()),
            format_optional_u8(self.qml_hw()),
            format_optional_u8(self.qml_app()),
            format_optional_u8_hex(self.nrf_flags()),
            format_optional_str_result(self.firmware_name()),
            format_optional_u32_hex(self.hardware_config_crc()),
            format_bytes(self.extra_bytes()),
            self.raw_payload().len(),
        )
    }
}

fn require_exact_id(payload: &Bytes, expected: u8) -> Result<(), PayloadError> {
    let Some(actual) = payload.first().copied() else {
        return Err(PayloadError::EmptyPayload);
    };

    if actual != expected {
        return Err(PayloadError::UnexpectedPacketId {
            expected,
            actual,
            source_payload: payload.clone(),
        });
    }

    Ok(())
}

fn require_len(
    payload: &Bytes,
    expected_len: usize,
    field: &'static str,
) -> Result<(), PayloadError> {
    if payload.len() < expected_len {
        return Err(PayloadError::MissingBytes {
            field,
            expected_len,
            actual_len: payload.len(),
            source_payload: payload.clone(),
        });
    }

    Ok(())
}

fn take_c_string(
    payload: &Bytes,
    idx: &mut usize,
    field: &'static str,
) -> Result<Range<usize>, PayloadError> {
    let start = *idx;
    let Some(relative_end) = payload[start..].iter().position(|byte| *byte == 0) else {
        return Err(PayloadError::UnterminatedString {
            field,
            source_payload: payload.clone(),
        });
    };

    let end = start + relative_end;
    *idx = end + 1;
    Ok(start..end)
}

fn take_optional_range(
    payload: &Bytes,
    idx: &mut usize,
    len: usize,
    field: &'static str,
) -> Result<Option<Range<usize>>, PayloadError> {
    if *idx == payload.len() {
        return Ok(None);
    }

    let actual_len = payload.len() - *idx;
    if actual_len < len {
        return Err(PayloadError::MissingBytes {
            field,
            expected_len: len,
            actual_len,
            source_payload: payload.clone(),
        });
    }

    let start = *idx;
    *idx += len;
    Ok(Some(start..*idx))
}

fn take_optional_u8(
    payload: &Bytes,
    idx: &mut usize,
    field: &'static str,
) -> Result<Option<usize>, PayloadError> {
    Ok(take_optional_range(payload, idx, 1, field)?.map(|range| range.start))
}

fn format_str_result(value: Result<&str, str::Utf8Error>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|error| format!("<invalid utf8: {error}>"))
}

fn format_optional_str_result(value: Option<Result<&str, str::Utf8Error>>) -> String {
    match value {
        Some(value) => format_str_result(value),
        None => "None".to_string(),
    }
}

fn format_optional_bool(value: Option<bool>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "None".to_string())
}

fn format_optional_u8(value: Option<u8>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "None".to_string())
}

fn format_optional_u8_hex(value: Option<u8>) -> String {
    value
        .map(|value| format!("{value:#04x}"))
        .unwrap_or_else(|| "None".to_string())
}

fn format_optional_u32_hex(value: Option<u32>) -> String {
    value
        .map(|value| format!("{value:#010x}"))
        .unwrap_or_else(|| "None".to_string())
}

fn format_optional_bytes(value: Option<&[u8]>) -> String {
    value
        .map(format_bytes)
        .unwrap_or_else(|| "None".to_string())
}

fn format_bytes(value: &[u8]) -> String {
    let mut formatted = String::with_capacity(value.len() * 2);
    for byte in value {
        use std::fmt::Write;
        write!(&mut formatted, "{byte:02x}").expect("writing to String cannot fail");
    }
    formatted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current_fw_payload() -> Bytes {
        let mut payload = Vec::new();
        payload.extend_from_slice(&[COMM_FW_VERSION, 6, 5]);
        payload.extend_from_slice(b"HW_60V\0");
        payload.extend_from_slice(&[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        payload.extend_from_slice(&[1, 2, 3, 4, 1, 2, 0, 0b11]);
        payload.extend_from_slice(b"VESC_FW\0");
        payload.extend_from_slice(&[0x12, 0x34, 0x56, 0x78]);
        Bytes::from(payload)
    }

    #[test]
    fn builds_firmware_info_request_payload() {
        assert_eq!(
            VescRequest::FirmwareInfo.to_bytes(),
            Bytes::from_static(&[COMM_FW_VERSION])
        );
    }

    #[test]
    fn builds_motor_config_request_payload() {
        assert_eq!(
            VescRequest::MotorConfig.to_bytes(),
            Bytes::from_static(&[COMM_GET_MCCONF])
        );
    }

    #[test]
    fn builds_app_config_request_payload() {
        assert_eq!(
            VescRequest::AppConfig.to_bytes(),
            Bytes::from_static(&[COMM_GET_APPCONF])
        );
    }

    #[test]
    fn parses_current_firmware_info_response_as_views() {
        let raw = current_fw_payload();
        let info = FirmwareInfoPayload::parse(raw.clone()).unwrap();

        assert_eq!(info.raw_payload(), &raw);
        assert_eq!(info.command_id(), COMM_FW_VERSION);
        assert_eq!(info.major(), 6);
        assert_eq!(info.minor(), 5);
        assert_eq!(info.hardware_name().unwrap(), "HW_60V");
        assert_eq!(
            info.uuid(),
            Some(&[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11][..])
        );
        assert_eq!(info.pairing_done(), Some(true));
        assert_eq!(info.test_version_number(), Some(2));
        assert_eq!(info.hardware_type(), Some(3));
        assert_eq!(info.custom_config_count(), Some(4));
        assert_eq!(info.has_phase_filters(), Some(true));
        assert_eq!(info.qml_hw(), Some(2));
        assert_eq!(info.qml_app(), Some(0));
        assert_eq!(info.nrf_flags(), Some(0b11));
        assert_eq!(info.firmware_name().unwrap().unwrap(), "VESC_FW");
        assert_eq!(info.hardware_config_crc(), Some(0x1234_5678));
        assert!(info.extra_bytes().is_empty());
    }

    #[test]
    fn formats_all_firmware_info_fields() {
        let info = FirmwareInfoPayload::parse(current_fw_payload()).unwrap();
        let formatted = info.to_string();

        assert!(formatted.contains("command_id=0"));
        assert!(formatted.contains("version=6.5"));
        assert!(formatted.contains("hardware_name=HW_60V"));
        assert!(formatted.contains("uuid=000102030405060708090a0b"));
        assert!(formatted.contains("pairing_done=true"));
        assert!(formatted.contains("test_version_number=2"));
        assert!(formatted.contains("hardware_type=3"));
        assert!(formatted.contains("custom_config_count=4"));
        assert!(formatted.contains("has_phase_filters=true"));
        assert!(formatted.contains("qml_hw=2"));
        assert!(formatted.contains("qml_app=0"));
        assert!(formatted.contains("nrf_flags=0x03"));
        assert!(formatted.contains("firmware_name=VESC_FW"));
        assert!(formatted.contains("hardware_config_crc=0x12345678"));
        assert!(formatted.contains("extra_bytes="));
        assert!(formatted.contains("raw_payload_len="));
    }

    #[test]
    fn parses_firmware_info_response_variant_for_request() {
        let payload = current_fw_payload();

        match VescResponse::parse(&VescRequest::FirmwareInfo, payload).unwrap() {
            VescResponse::FirmwareInfo { info, source_bytes } => {
                assert_eq!(source_bytes, info.raw_payload().clone());
                assert_eq!(info.hardware_name().unwrap(), "HW_60V");
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn parses_motor_config_response_variant_for_request() {
        let payload = Bytes::from_static(&[COMM_GET_MCCONF, 0xaa, 0xbb, 0xcc]);

        match VescResponse::parse(&VescRequest::MotorConfig, payload).unwrap() {
            VescResponse::MotorConfig {
                config,
                source_bytes,
            } => {
                assert_eq!(source_bytes, config.raw_payload().clone());
                assert_eq!(config.command_id(), COMM_GET_MCCONF);
                assert_eq!(config.config_bytes(), &[0xaa, 0xbb, 0xcc]);
                assert_eq!(
                    config.to_string(),
                    "command_id=14, config_len=3, raw_payload_len=4"
                );
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn parses_app_config_response_variant_for_request() {
        let payload = Bytes::from_static(&[COMM_GET_APPCONF, 0xaa, 0xbb, 0xcc]);

        match VescResponse::parse(&VescRequest::AppConfig, payload).unwrap() {
            VescResponse::AppConfig {
                config,
                source_bytes,
            } => {
                assert_eq!(source_bytes, config.raw_payload().clone());
                assert_eq!(config.command_id(), COMM_GET_APPCONF);
                assert_eq!(config.config_bytes(), &[0xaa, 0xbb, 0xcc]);
                assert_eq!(
                    config.to_string(),
                    "command_id=17, config_len=3, raw_payload_len=4"
                );
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn parses_minimal_legacy_firmware_info_response() {
        let info =
            FirmwareInfoPayload::parse(Bytes::from_static(&[COMM_FW_VERSION, 5, 3, b'H', b'W', 0]))
                .unwrap();

        assert_eq!(info.major(), 5);
        assert_eq!(info.minor(), 3);
        assert_eq!(info.hardware_name().unwrap(), "HW");
        assert_eq!(info.uuid(), None);
        assert_eq!(info.hardware_config_crc(), None);
    }

    #[test]
    fn rejects_unterminated_hardware_name() {
        let payload = Bytes::from_static(&[COMM_FW_VERSION, 6, 5, b'H', b'W']);

        assert_eq!(
            FirmwareInfoPayload::parse(payload.clone()),
            Err(PayloadError::UnterminatedString {
                field: "hardware_name",
                source_payload: payload,
            })
        );
    }

    #[test]
    fn rejects_wrong_packet_id() {
        let payload = Bytes::from_static(&[0x01]);

        assert_eq!(
            VescResponse::parse(&VescRequest::FirmwareInfo, payload.clone()),
            Err(PayloadError::ResponseTypeMismatch {
                expected: "FirmwareInfo",
                actual_packet_id: 0x01,
                source_payload: payload,
            })
        );
    }
}

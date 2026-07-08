use bytes::{BufMut, Bytes, BytesMut};
use std::fmt;
use std::ops::Range;
use std::str;
use tokio::io::{AsyncRead, AsyncWrite};

use super::{CommPacket, PacketError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum VescCommandId {
    FwVersion = 0,
    GetValues = 4,
    SetHandbrake = 10,
    GetMotorConfig = 14,
    GetAppConfig = 17,
}

impl VescCommandId {
    pub fn as_u32(self) -> u32 {
        self as u32
    }

    pub fn wire_id(self) -> u8 {
        self.as_u32() as u8
    }

    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::FwVersion),
            4 => Some(Self::GetValues),
            10 => Some(Self::SetHandbrake),
            14 => Some(Self::GetMotorConfig),
            17 => Some(Self::GetAppConfig),
            _ => None,
        }
    }

    pub fn from_wire_id(value: u8) -> Option<Self> {
        Self::from_u32(value as u32)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::FwVersion => "COMM_FW_VERSION",
            Self::GetValues => "COMM_GET_VALUES",
            Self::SetHandbrake => "COMM_SET_HANDBRAKE",
            Self::GetMotorConfig => "COMM_GET_MCCONF",
            Self::GetAppConfig => "COMM_GET_APPCONF",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayloadError {
    EmptyPayload,
    UnexpectedPacketId {
        expected: u32,
        actual: u32,
        source_payload: Bytes,
    },
    ResponseTypeMismatch {
        expected: &'static str,
        actual_packet_id: u32,
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
    InvalidPacket(PacketError),
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
            Self::InvalidPacket(error) => write!(f, "invalid VESC packet: {error}"),
        }
    }
}

impl std::error::Error for PayloadError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VescRequest {
    FirmwareInfo,
    Values,
    MotorConfig,
    AppConfig,
}

impl VescRequest {
    pub fn command(&self) -> VescCommandId {
        match self {
            Self::FirmwareInfo => VescCommandId::FwVersion,
            Self::Values => VescCommandId::GetValues,
            Self::MotorConfig => VescCommandId::GetMotorConfig,
            Self::AppConfig => VescCommandId::GetAppConfig,
        }
    }

    pub fn command_id(&self) -> u32 {
        self.command().as_u32()
    }

    pub fn wire_command_id(&self) -> u8 {
        self.command().wire_id()
    }

    pub fn expected_response_command(&self) -> VescCommandId {
        self.command()
    }

    pub fn expected_response_name(&self) -> &'static str {
        match self {
            Self::FirmwareInfo => "FirmwareInfo",
            Self::Values => "Values",
            Self::MotorConfig => "MotorConfig",
            Self::AppConfig => "AppConfig",
        }
    }

    pub fn to_bytes(&self) -> Bytes {
        let mut payload = BytesMut::with_capacity(1);
        payload.put_u8(self.wire_command_id());
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
        VescResponse::async_read(self, stream, timeout_ms).await
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VescResponse {
    FirmwareInfo {
        info: FirmwareInfoPayload,
        source_packet: CommPacket,
        source_bytes: Bytes,
    },
    Values {
        values: ValuesPayload,
        source_packet: CommPacket,
        source_bytes: Bytes,
    },
    MotorConfig {
        config: MotorConfigPayload,
        source_packet: CommPacket,
        source_bytes: Bytes,
    },
    AppConfig {
        config: AppConfigPayload,
        source_packet: CommPacket,
        source_bytes: Bytes,
    },
}

impl VescResponse {
    pub async fn async_read<R: AsyncRead + Unpin>(
        request: &VescRequest,
        reader: &mut R,
        timeout_ms: u64,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let response_packet = CommPacket::async_read(reader, timeout_ms).await?;
        Ok(Self::parse_packet(request, response_packet)?)
    }

    pub fn parse(request: &VescRequest, source_bytes: Bytes) -> Result<Self, PayloadError> {
        let source_packet = CommPacket::new(source_bytes).map_err(PayloadError::InvalidPacket)?;
        Self::parse_packet(request, source_packet)
    }

    pub fn parse_packet(
        request: &VescRequest,
        source_packet: CommPacket,
    ) -> Result<Self, PayloadError> {
        let source_bytes = source_packet.payload().clone();
        let actual_packet_id = *source_bytes.first().ok_or(PayloadError::EmptyPayload)? as u32;
        let expected_packet_id = request.expected_response_command().as_u32();

        if actual_packet_id != expected_packet_id {
            return Err(PayloadError::ResponseTypeMismatch {
                expected: request.expected_response_name(),
                actual_packet_id,
                source_payload: source_bytes,
            });
        }

        match request {
            VescRequest::FirmwareInfo => {
                let info = FirmwareInfoPayload::parse(source_bytes.clone())?;
                Ok(Self::FirmwareInfo {
                    info,
                    source_packet,
                    source_bytes,
                })
            }
            VescRequest::Values => {
                let values = ValuesPayload::parse(source_bytes.clone())?;
                Ok(Self::Values {
                    values,
                    source_packet,
                    source_bytes,
                })
            }
            VescRequest::MotorConfig => {
                let config = MotorConfigPayload::parse(source_bytes.clone())?;
                Ok(Self::MotorConfig {
                    config,
                    source_packet,
                    source_bytes,
                })
            }
            VescRequest::AppConfig => {
                let config = AppConfigPayload::parse(source_bytes.clone())?;
                Ok(Self::AppConfig {
                    config,
                    source_packet,
                    source_bytes,
                })
            }
        }
    }

    pub fn source_packet(&self) -> &CommPacket {
        match self {
            Self::FirmwareInfo { source_packet, .. }
            | Self::Values { source_packet, .. }
            | Self::MotorConfig { source_packet, .. }
            | Self::AppConfig { source_packet, .. } => source_packet,
        }
    }

    pub fn source_bytes(&self) -> &Bytes {
        match self {
            Self::FirmwareInfo { source_bytes, .. }
            | Self::Values { source_bytes, .. }
            | Self::MotorConfig { source_bytes, .. }
            | Self::AppConfig { source_bytes, .. } => source_bytes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValuesPayload {
    payload: Bytes,
}

impl ValuesPayload {
    pub fn parse(payload: Bytes) -> Result<Self, PayloadError> {
        require_exact_id(&payload, VescCommandId::GetValues.as_u32())?;
        Ok(Self { payload })
    }

    pub fn raw_payload(&self) -> &Bytes {
        &self.payload
    }

    pub fn command_id(&self) -> u32 {
        self.payload[0] as u32
    }

    pub fn values_bytes(&self) -> &[u8] {
        &self.payload[1..]
    }
}

impl fmt::Display for ValuesPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "command_id={}, values_len={}, raw_payload_len={}",
            self.command_id(),
            self.values_bytes().len(),
            self.raw_payload().len(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MotorConfigPayload {
    payload: Bytes,
}

impl MotorConfigPayload {
    pub fn parse(payload: Bytes) -> Result<Self, PayloadError> {
        require_exact_id(&payload, VescCommandId::GetMotorConfig.as_u32())?;
        Ok(Self { payload })
    }

    pub fn raw_payload(&self) -> &Bytes {
        &self.payload
    }

    pub fn command_id(&self) -> u32 {
        self.payload[0] as u32
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
        require_exact_id(&payload, VescCommandId::GetAppConfig.as_u32())?;
        Ok(Self { payload })
    }

    pub fn raw_payload(&self) -> &Bytes {
        &self.payload
    }

    pub fn command_id(&self) -> u32 {
        self.payload[0] as u32
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
        require_exact_id(&payload, VescCommandId::FwVersion.as_u32())?;
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

    pub fn command_id(&self) -> u32 {
        self.payload[0] as u32
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

fn require_exact_id(payload: &Bytes, expected: u32) -> Result<(), PayloadError> {
    let Some(actual) = payload.first().copied() else {
        return Err(PayloadError::EmptyPayload);
    };
    let actual = actual as u32;

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
    use tokio::io::AsyncWriteExt;

    fn wire(command_id: VescCommandId) -> u8 {
        command_id.wire_id()
    }

    fn current_fw_payload() -> Bytes {
        let mut payload = Vec::new();
        payload.extend_from_slice(&[wire(VescCommandId::FwVersion), 6, 5]);
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
            Bytes::from(vec![wire(VescCommandId::FwVersion)])
        );
    }

    #[test]
    fn builds_values_request_payload() {
        assert_eq!(
            VescRequest::Values.to_bytes(),
            Bytes::from(vec![wire(VescCommandId::GetValues)])
        );
    }

    #[test]
    fn builds_motor_config_request_payload() {
        assert_eq!(
            VescRequest::MotorConfig.to_bytes(),
            Bytes::from(vec![wire(VescCommandId::GetMotorConfig)])
        );
    }

    #[test]
    fn builds_app_config_request_payload() {
        assert_eq!(
            VescRequest::AppConfig.to_bytes(),
            Bytes::from(vec![wire(VescCommandId::GetAppConfig)])
        );
    }

    #[test]
    fn exposes_request_command_and_expected_response_metadata() {
        assert_eq!(
            VescRequest::FirmwareInfo.command(),
            VescCommandId::FwVersion
        );
        assert_eq!(
            VescRequest::FirmwareInfo.command_id(),
            VescCommandId::FwVersion.as_u32()
        );
        assert_eq!(
            VescRequest::FirmwareInfo.wire_command_id(),
            wire(VescCommandId::FwVersion)
        );
        assert_eq!(
            VescRequest::FirmwareInfo.expected_response_command(),
            VescCommandId::FwVersion
        );
        assert_eq!(
            VescRequest::FirmwareInfo.expected_response_name(),
            "FirmwareInfo"
        );

        assert_eq!(
            VescRequest::Values.expected_response_command(),
            VescCommandId::GetValues
        );
        assert_eq!(VescRequest::Values.expected_response_name(), "Values");
        assert_eq!(
            VescRequest::MotorConfig.expected_response_command(),
            VescCommandId::GetMotorConfig
        );
        assert_eq!(
            VescRequest::AppConfig.expected_response_command(),
            VescCommandId::GetAppConfig
        );
    }

    #[test]
    fn maps_u32_and_wire_command_ids() {
        assert_eq!(
            VescCommandId::from_u32(VescCommandId::GetValues.as_u32()),
            Some(VescCommandId::GetValues)
        );
        assert_eq!(
            VescCommandId::from_wire_id(wire(VescCommandId::GetValues)),
            Some(VescCommandId::GetValues)
        );
        assert_eq!(
            VescCommandId::from_u32(VescCommandId::GetMotorConfig.as_u32()),
            Some(VescCommandId::GetMotorConfig)
        );
        assert_eq!(
            VescCommandId::from_wire_id(wire(VescCommandId::GetMotorConfig)),
            Some(VescCommandId::GetMotorConfig)
        );
        assert_eq!(
            VescCommandId::GetMotorConfig.wire_id(),
            wire(VescCommandId::GetMotorConfig)
        );
        assert_eq!(VescCommandId::GetMotorConfig.name(), "COMM_GET_MCCONF");
        assert_eq!(
            VescCommandId::from_wire_id(wire(VescCommandId::SetHandbrake)),
            Some(VescCommandId::SetHandbrake)
        );
        assert_eq!(VescCommandId::SetHandbrake.wire_id(), 10);
        assert_eq!(VescCommandId::SetHandbrake.name(), "COMM_SET_HANDBRAKE");
    }

    #[test]
    fn parses_current_firmware_info_response_as_views() {
        let raw = current_fw_payload();
        let info = FirmwareInfoPayload::parse(raw.clone()).unwrap();

        assert_eq!(info.raw_payload(), &raw);
        assert_eq!(info.command_id(), VescCommandId::FwVersion.as_u32());
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
            VescResponse::FirmwareInfo {
                info,
                source_packet,
                source_bytes,
            } => {
                assert_eq!(source_packet.payload(), info.raw_payload());
                assert_eq!(source_bytes, info.raw_payload().clone());
                assert_eq!(info.hardware_name().unwrap(), "HW_60V");
            }
            _ => unreachable!(),
        }
    }

    #[tokio::test]
    async fn async_reads_response_variant_for_request() {
        let packet = CommPacket::new(current_fw_payload()).unwrap();
        let frame = packet.encode();
        let (mut reader, mut writer) = tokio::io::duplex(frame.len());

        writer.write_all(&frame).await.unwrap();
        drop(writer);

        match VescResponse::async_read(&VescRequest::FirmwareInfo, &mut reader, 100)
            .await
            .unwrap()
        {
            VescResponse::FirmwareInfo {
                info,
                source_packet,
                source_bytes,
            } => {
                assert_eq!(source_packet.start_byte(), packet.start_byte());
                assert_eq!(source_packet.crc(), packet.crc());
                assert_eq!(source_bytes, info.raw_payload().clone());
                assert_eq!(info.hardware_name().unwrap(), "HW_60V");
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn parses_values_response_variant_for_request() {
        let payload = Bytes::from(vec![wire(VescCommandId::GetValues), 0xaa, 0xbb, 0xcc]);

        match VescResponse::parse(&VescRequest::Values, payload).unwrap() {
            VescResponse::Values {
                values,
                source_packet,
                source_bytes,
            } => {
                assert_eq!(source_packet.payload(), values.raw_payload());
                assert_eq!(
                    source_packet.command_id(),
                    Some(VescCommandId::GetValues.as_u32())
                );
                assert_eq!(source_bytes, values.raw_payload().clone());
                assert_eq!(values.command_id(), VescCommandId::GetValues.as_u32());
                assert_eq!(values.values_bytes(), &[0xaa, 0xbb, 0xcc]);
                assert_eq!(
                    values.to_string(),
                    "command_id=4, values_len=3, raw_payload_len=4"
                );
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn parses_motor_config_response_variant_for_request() {
        let payload = Bytes::from(vec![wire(VescCommandId::GetMotorConfig), 0xaa, 0xbb, 0xcc]);

        match VescResponse::parse(&VescRequest::MotorConfig, payload).unwrap() {
            VescResponse::MotorConfig {
                config,
                source_packet,
                source_bytes,
            } => {
                assert_eq!(source_packet.payload(), config.raw_payload());
                assert_eq!(source_bytes, config.raw_payload().clone());
                assert_eq!(config.command_id(), VescCommandId::GetMotorConfig.as_u32());
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
        let payload = Bytes::from(vec![wire(VescCommandId::GetAppConfig), 0xaa, 0xbb, 0xcc]);

        match VescResponse::parse(&VescRequest::AppConfig, payload).unwrap() {
            VescResponse::AppConfig {
                config,
                source_packet,
                source_bytes,
            } => {
                assert_eq!(source_packet.payload(), config.raw_payload());
                assert_eq!(source_bytes, config.raw_payload().clone());
                assert_eq!(config.command_id(), VescCommandId::GetAppConfig.as_u32());
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
        let info = FirmwareInfoPayload::parse(Bytes::from(vec![
            wire(VescCommandId::FwVersion),
            5,
            3,
            b'H',
            b'W',
            0,
        ]))
        .unwrap();

        assert_eq!(info.major(), 5);
        assert_eq!(info.minor(), 3);
        assert_eq!(info.hardware_name().unwrap(), "HW");
        assert_eq!(info.uuid(), None);
        assert_eq!(info.hardware_config_crc(), None);
    }

    #[test]
    fn rejects_unterminated_hardware_name() {
        let payload = Bytes::from(vec![wire(VescCommandId::FwVersion), 6, 5, b'H', b'W']);

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

    #[test]
    fn rejects_response_packet_id_that_does_not_match_request_metadata() {
        let payload = Bytes::from(vec![wire(VescCommandId::GetAppConfig)]);

        assert_eq!(
            VescResponse::parse(&VescRequest::MotorConfig, payload.clone()),
            Err(PayloadError::ResponseTypeMismatch {
                expected: "MotorConfig",
                actual_packet_id: VescCommandId::GetAppConfig.as_u32(),
                source_payload: payload,
            })
        );
    }
}

mod devices;
mod packet;
mod payload;

pub use devices::is_vesc_trampa_usbdevice;
pub use packet::{
    CommPacket, EXTENDED_PACKET_START, EXTENDED_PAYLOAD_MAX_LEN, LONG_PACKET_START,
    LONG_PAYLOAD_MAX_LEN, MAX_PAYLOAD_LEN, PACKET_END, PacketError, SHORT_PACKET_START,
    SHORT_PAYLOAD_MAX_LEN,
};
pub use payload::{
    AppConfigPayload, COMM_FW_VERSION, COMM_GET_APPCONF, COMM_GET_MCCONF, FirmwareInfoPayload,
    MotorConfigPayload, PayloadError, VescRequest, VescResponse,
};

pub const DEFAULT_BAUD_RATE: u32 = 115_200;

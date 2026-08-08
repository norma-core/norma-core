// Trampa VESC boards expose the STM32 virtual COM port USB identifiers.
const VESC_TRAMPA_VID: u16 = 0x0483;
const VESC_TRAMPA_PID: u16 = 0x5740;

pub fn is_vesc_trampa_usbdevice(vid: u16, pid: u16) -> bool {
    vid == VESC_TRAMPA_VID && pid == VESC_TRAMPA_PID
}

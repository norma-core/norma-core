"""Parse the ST3215 register snapshot carried in InferenceState.MotorState.state.

Layout: EEPROM 0x00..0x27 followed by RAM 0x28..0x46, 0x47 bytes total.
All multi-byte values are little-endian u16.
"""

ADDR_TORQUE_ENABLE = 0x28
ADDR_ACCEL = 0x29
ADDR_GOAL_POSITION = 0x2A
ADDR_GOAL_SPEED = 0x2E
ADDR_PRESENT_POSITION = 0x38
ADDR_PRESENT_VOLTAGE = 0x3E
ADDR_STATUS = 0x40
SNAPSHOT_SIZE = 0x47

STEPS_PER_REV = 4096  # 12-bit magnetic encoder, one turn
MAX_STEP = STEPS_PER_REV - 1
_SIGN_BIT = 0x8000


def _u16(data: bytes, addr: int) -> int:
    if len(data) < addr + 2:
        return 0
    return int.from_bytes(data[addr : addr + 2], "little")


def _u8(data: bytes, addr: int) -> int:
    if len(data) <= addr:
        return 0
    return data[addr]


def normalize_position(raw: int) -> int:
    """Strip the servo's sign bit so a position is always 0..4095."""
    if raw & _SIGN_BIT:
        magnitude = raw & MAX_STEP
        return (MAX_STEP + 1 - magnitude) & MAX_STEP
    return raw & MAX_STEP


def present_position(data: bytes) -> int:
    return normalize_position(_u16(data, ADDR_PRESENT_POSITION))


def voltage_v(data: bytes) -> float:
    return _u8(data, ADDR_PRESENT_VOLTAGE) * 0.1


def torque_enabled(data: bytes) -> bool:
    return _u8(data, ADDR_TORQUE_ENABLE) != 0


def has_error(data: bytes) -> bool:
    """True when the status register is non-zero or the snapshot is truncated."""
    if len(data) < SNAPSHOT_SIZE:
        return True
    return data[ADDR_STATUS] != 0

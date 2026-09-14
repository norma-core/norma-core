"""Parse leader (ST3215) and follower (Dogzilla) inference frames."""

import struct

from mirror import LeaderMotorState

# ST3215 state register addresses inside motor.get_state() bytes.
RAM_PRESENT_POSITION = 0x38
RAM_STATUS = 0x40

# Position field is 16 bits but the high bit is a sign flag (negative encoder).
MAX_ANGLE_STEP = 4095
SIGN_BIT_MASK = 0x8000

# YahboomDogzillaLiteStatus.servo_positions / servo_angles are flat 15-entry
# arrays in this fixed order (see yahboom_dogzilla_lite.proto). Servo ids
# 51/52/53 are the arm+gripper; the rest are legs.
FOLLOWER_SERVO_ID_ORDER = [11, 12, 13, 21, 22, 23, 31, 32, 33, 41, 42, 43, 51, 52, 53]


def _u16(state: bytes, addr: int) -> int:
    if len(state) < addr + 2:
        return 0
    return struct.unpack_from("<H", state, addr)[0]


def _u8(state: bytes, addr: int) -> int:
    if len(state) <= addr:
        return 0
    return state[addr]


def _normal_position(raw: int) -> int:
    """Strip the sign bit so positions are always 0-4095."""
    if raw & SIGN_BIT_MASK:
        magnitude = raw & MAX_ANGLE_STEP
        return (MAX_ANGLE_STEP + 1 - magnitude) & MAX_ANGLE_STEP
    return raw & MAX_ANGLE_STEP


def parse_leader_motor_state(motor_reader) -> LeaderMotorState:
    """Build a LeaderMotorState from one ST3215 motor entry in an inference frame.

    `motor_reader` is an InferenceState_MotorStateReader (gremlin-generated).
    """
    state_bytes = bytes(motor_reader.get_state())

    return LeaderMotorState(
        present_position=_normal_position(_u16(state_bytes, RAM_PRESENT_POSITION)),
        range_min=motor_reader.get_range_min(),
        range_max=motor_reader.get_range_max(),
        error_status=_u8(state_bytes, RAM_STATUS),
    )


def resolve_leader_bus_serial(inference_state, requested: str) -> str:
    """Turn a `--leader-bus` argument into a concrete ST3215 bus serial.

    Only called at startup. "auto" requires exactly one bus on the station;
    a specific serial must be present. Raises if the requirement isn't met.
    """
    buses = inference_state.get_buses() or []
    if not buses:
        raise RuntimeError("No ST3215 buses on leader station")

    if requested == "auto":
        if len(buses) != 1:
            serials = [b.get_bus().get_serial_number() for b in buses if b.get_bus()]
            raise RuntimeError(
                f"--leader-bus auto requires exactly one bus, found {len(buses)}: {serials}"
            )
        info = buses[0].get_bus()
        if info is None:
            raise RuntimeError("Bus has no info")
        return info.get_serial_number()

    for bus in buses:
        info = bus.get_bus()
        if info and info.get_serial_number() == requested:
            return requested
    raise RuntimeError(f"Leader bus '{requested}' not found on station")


def find_leader_bus(inference_state, bus_serial: str):
    """Look up an ST3215 bus by exact serial in the latest leader frame.

    Returns None if the bus isn't in this frame — the bus may reappear on the
    next tick (transient publisher gap, USB blip, etc.), so the caller should
    just skip this tick rather than raise.
    """
    if inference_state is None:
        return None
    for bus in inference_state.get_buses() or []:
        info = bus.get_bus()
        if info and info.get_serial_number() == bus_serial:
            return bus
    return None


def resolve_follower_device_serial(inference_state, requested: str) -> str:
    """Turn a `--follower-device` argument into a concrete Dogzilla device serial.

    Only called at startup. "auto" requires exactly one device on the
    station; a specific serial must be present. Raises if the requirement
    isn't met.
    """
    devices = inference_state.get_devices() or []
    if not devices:
        raise RuntimeError("No Dogzilla devices on follower station")

    if requested == "auto":
        if len(devices) != 1:
            serials = [d.get_device().get_serial_number() for d in devices if d.get_device()]
            raise RuntimeError(
                f"--follower-device auto requires exactly one device, found {len(devices)}: {serials}"
            )
        info = devices[0].get_device()
        if info is None:
            raise RuntimeError("Device has no info")
        return info.get_serial_number()

    for device in devices:
        info = device.get_device()
        if info and info.get_serial_number() == requested:
            return requested
    raise RuntimeError(f"Follower device '{requested}' not found on station")


def find_follower_device(inference_state, device_serial: str):
    """Look up a Dogzilla device by exact serial in the latest follower frame.

    Returns None if the device isn't in this frame — it may reappear on the
    next tick (transient publisher gap, USB blip, etc.), so the caller should
    just skip this tick rather than raise.
    """
    if inference_state is None:
        return None
    for device in inference_state.get_devices() or []:
        info = device.get_device()
        if info and info.get_serial_number() == device_serial:
            return device
    return None


def parse_follower_positions(device) -> dict[int, int]:
    """Map servo id -> raw 0-255 present position from a Dogzilla DeviceState.

    `device` is an InferenceState_DeviceStateReader (gremlin-generated).
    """
    status = device.get_status()
    if status is None:
        return {}
    positions = status.get_servo_positions() or []
    return {
        servo_id: positions[i]
        for i, servo_id in enumerate(FOLLOWER_SERVO_ID_ORDER)
        if i < len(positions)
    }

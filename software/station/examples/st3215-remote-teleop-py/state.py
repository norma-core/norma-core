"""Parse motor state bytes from an InferenceState frame and resolve buses."""

import struct

from mirror import MotorState

# State register addresses inside motor.get_state() bytes.
RAM_TORQUE_ENABLE = 0x28
RAM_ACC = 0x29
RAM_GOAL_POSITION = 0x2A
RAM_GOAL_SPEED = 0x2E
RAM_PRESENT_POSITION = 0x38
RAM_STATUS = 0x40
RAM_PRESENT_CURRENT = 0x45

# Position field is 16 bits but the high bit is a sign flag (negative encoder).
MAX_ANGLE_STEP = 4095
SIGN_BIT_MASK = 0x8000


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


def parse_motor_state(motor_reader) -> MotorState:
    """Build a MotorState from one motor entry in an InferenceState frame.

    `motor_reader` is an InferenceState_MotorStateReader (gremlin-generated).
    """
    state_bytes = bytes(motor_reader.get_state())

    present = _normal_position(_u16(state_bytes, RAM_PRESENT_POSITION))
    goal = _normal_position(_u16(state_bytes, RAM_GOAL_POSITION))
    torque_on = _u8(state_bytes, RAM_TORQUE_ENABLE) != 0

    return MotorState(
        present_position=present,
        # When torque is off the goal register holds garbage from the last
        # write — pretend the target is the present position.
        target_position=goal if torque_on else present,
        range_min=motor_reader.get_range_min(),
        range_max=motor_reader.get_range_max(),
        error_status=_u8(state_bytes, RAM_STATUS),
        current=_u16(state_bytes, RAM_PRESENT_CURRENT),
        goal_speed=_u16(state_bytes, RAM_GOAL_SPEED),
        goal_accel=_u8(state_bytes, RAM_ACC),
    )


def resolve_bus_serial(inference_state, requested: str) -> str:
    """Turn a `--bus` argument into a concrete serial number.

    Only called at startup. "auto" requires exactly one bus on the station;
    a specific serial must be present. Raises if the requirement isn't met.
    """
    buses = inference_state.get_buses() or []
    if not buses:
        raise RuntimeError("No ST3215 buses on station")

    if requested == "auto":
        if len(buses) != 1:
            serials = [b.get_bus().get_serial_number() for b in buses if b.get_bus()]
            raise RuntimeError(
                f"--bus auto requires exactly one bus, found {len(buses)}: {serials}"
            )
        info = buses[0].get_bus()
        if info is None:
            raise RuntimeError("Bus has no info")
        return info.get_serial_number()

    for bus in buses:
        info = bus.get_bus()
        if info and info.get_serial_number() == requested:
            return requested
    raise RuntimeError(f"Bus '{requested}' not found on station")


def find_bus(inference_state, bus_serial: str):
    """Look up a bus by exact serial in the latest frame.

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

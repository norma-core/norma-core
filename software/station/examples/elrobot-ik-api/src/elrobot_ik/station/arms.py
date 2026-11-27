"""Decoded view of one st3215 InferenceState frame: buses (arms) and their motors."""
from __future__ import annotations

from dataclasses import dataclass

from elrobot_ik.station import registers as R
from elrobot_ik.station.proto import st3215_pb2

ELROBOT_MOTOR_IDS = (1, 2, 3, 4, 5, 6, 7, 8)
FOLLOWER_MIN_VOLTAGE_V = 10.0  # follower arms run at 12 V, leaders at 5-7.4 V


@dataclass(frozen=True)
class MotorSnapshot:
    id: int
    steps: int
    range_min: int
    range_max: int
    range_frozen: bool
    voltage_v: float
    torque_enabled: bool
    error_detail: str = ""  # empty when the motor is healthy

    @property
    def error(self) -> bool:
        return bool(self.error_detail)


@dataclass(frozen=True)
class BusSnapshot:
    serial: str
    motors: tuple[MotorSnapshot, ...]

    def motor(self, motor_id: int) -> MotorSnapshot | None:
        for m in self.motors:
            if m.id == motor_id:
                return m
        return None

    def steps(self, ids: tuple[int, ...] = ELROBOT_MOTOR_IDS, missing: int = -1) -> list[int]:
        """Present steps of the given motors, `missing` for ids not on the bus."""
        return [m.steps if (m := self.motor(i)) else missing for i in ids]

    @property
    def is_elrobot(self) -> bool:
        return tuple(sorted(m.id for m in self.motors)) == ELROBOT_MOTOR_IDS

    @property
    def voltage_v(self) -> float:
        first = self.motor(1)
        return first.voltage_v if first else 0.0


def _error_detail(m: st3215_pb2.InferenceState.MotorState) -> str:
    """Human-readable reason when the station flags a motor (I/O, timeout, servo error...)."""
    if m.HasField("error"):
        kind = st3215_pb2.ST3215Error.ST3215ErrorKind.Name(m.error.kind)
        return f"{kind}: {m.error.description}" if m.error.description else kind
    if R.has_error(m.state):
        return "status register non-zero" if len(m.state) >= R.SNAPSHOT_SIZE else "truncated snapshot"
    return ""


def parse_frame(data: bytes) -> list[BusSnapshot]:
    state = st3215_pb2.InferenceState.FromString(data)
    buses: list[BusSnapshot] = []
    for bus_state in state.buses:
        motors = tuple(
            MotorSnapshot(
                id=m.id,
                steps=R.present_position(m.state),
                range_min=m.range_min,
                range_max=m.range_max,
                range_frozen=m.range_freezed,
                voltage_v=R.voltage_v(m.state),
                torque_enabled=R.torque_enabled(m.state),
                error_detail=_error_detail(m),
            )
            for m in sorted(bus_state.motors, key=lambda m: m.id)
        )
        buses.append(BusSnapshot(serial=bus_state.bus.serial_number, motors=motors))
    return buses


def role(bus: BusSnapshot) -> str:
    """'follower' (12 V supply) or 'leader' (5-7.4 V), from motor 1's reported voltage."""
    return "follower" if bus.voltage_v >= FOLLOWER_MIN_VOLTAGE_V else "leader"


def find_arm(buses: list[BusSnapshot], serial: str) -> BusSnapshot | None:
    """The bus with this serial, or None. There is no default arm: callers name it."""
    return next((b for b in buses if b.serial == serial), None)

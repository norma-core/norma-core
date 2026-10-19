"""Build ST3215 sync-write commands and wrap them for the station command queue."""
from __future__ import annotations

from collections.abc import Sequence

from elrobot_ik.station import registers as R
from elrobot_ik.station.proto import commands_pb2, drivers_pb2, mirroring_pb2, st3215_pb2


def sync_write(bus_serial: str, address: int, writes: list[tuple[int, bytes]]) -> st3215_pb2.Command:
    cmd = st3215_pb2.Command(target_bus_serial=bus_serial)
    cmd.sync_write.address = address
    for motor_id, value in writes:
        w = cmd.sync_write.motors.add()
        w.motor_id = motor_id
        w.value = value
    return cmd


def torque_command(bus_serial: str, motor_ids: Sequence[int], enabled: bool) -> st3215_pb2.Command:
    return sync_write(bus_serial, R.ADDR_TORQUE_ENABLE, [(m, b"\x01" if enabled else b"\x00") for m in motor_ids])


def speed_command(bus_serial: str, motor_ids: Sequence[int], speed: int) -> st3215_pb2.Command:
    if not 0 <= speed <= 0xFFFF:
        raise ValueError(f"speed out of range: {speed}")
    return sync_write(bus_serial, R.ADDR_GOAL_SPEED, [(m, speed.to_bytes(2, "little")) for m in motor_ids])


def accel_command(bus_serial: str, motor_ids: Sequence[int], accel: int) -> st3215_pb2.Command:
    if not 0 <= accel <= 0xFF:
        raise ValueError(f"accel out of range: {accel}")
    return sync_write(bus_serial, R.ADDR_ACCEL, [(m, bytes([accel])) for m in motor_ids])


def goal_command(bus_serial: str, steps_by_id: dict[int, int]) -> st3215_pb2.Command:
    writes: list[tuple[int, bytes]] = []
    for motor_id, steps in steps_by_id.items():
        if not 0 <= steps <= R.MAX_STEP:
            raise ValueError(f"goal for motor {motor_id} out of range: {steps}")
        writes.append((motor_id, steps.to_bytes(2, "little")))
    return sync_write(bus_serial, R.ADDR_GOAL_POSITION, writes)


def mirroring_stop_command(bus_serial: str) -> commands_pb2.DriverCommand:
    """Release a bus from the station's leader->follower mirroring, so our goals are not overridden."""
    cmd = mirroring_pb2.Command(type=mirroring_pb2.CT_STOP_MIRROR)
    cmd.source.type = mirroring_pb2.MBT_ST3215
    cmd.source.unique_id = bus_serial
    return commands_pb2.DriverCommand(type=drivers_pb2.STC_MOTOR_MIRRORING_COMMAND, body=cmd.SerializeToString())


def pack_commands(commands: Sequence[st3215_pb2.Command | commands_pb2.DriverCommand]) -> bytes:
    """Wrap st3215 commands (and ready-made driver commands) in one StationCommandsPack."""
    pack = commands_pb2.StationCommandsPack()
    for c in commands:
        if isinstance(c, commands_pb2.DriverCommand):
            pack.commands.append(c)
            continue
        d = pack.commands.add()
        d.type = drivers_pb2.STC_ST3215_COMMAND
        d.body = c.SerializeToString()
    return pack.SerializeToString()


def drive_commands(bus_serial: str, goals: dict[int, int], speed: int, accel: int) -> list[st3215_pb2.Command]:
    """The servo writes that start a move: torque on, speed, acceleration (one pack), then the goals.

    Returns [setup_pack..., goal]; callers send the first three as one write and the goal as the
    next (speed and accel must be in place before the goal triggers movement).
    """
    ids = list(goals)
    return [
        torque_command(bus_serial, ids, True),
        speed_command(bus_serial, ids, speed),
        accel_command(bus_serial, ids, accel),
        goal_command(bus_serial, goals),
    ]

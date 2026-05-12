"""Batch motor commands into ST3215 sync_write packs and send them."""

from software.station.shared.station_py import send_commands
from target.gen_python.protobuf.station import commands as station_commands, drivers
from target.gen_python.protobuf.drivers.st3215 import st3215

from mirror import MotorCommand
from state import RAM_TORQUE_ENABLE, RAM_GOAL_POSITION, RAM_GOAL_SPEED, RAM_ACC


def _sync_write(bus_serial: str, address: int, motors: list[tuple[int, bytes]]):
    """Wrap a batch of (motor_id, value) pairs into one sync_write DriverCommand."""
    if not motors:
        return None

    cmd = st3215.Command(
        target_bus_serial=bus_serial,
        sync_write=st3215.ST3215SyncWriteCommand(
            address=address,
            motors=[
                st3215.ST3215SyncWriteCommand_MotorWrite(motor_id=mid, value=val)
                for mid, val in motors
            ],
        ),
    )
    return station_commands.DriverCommand(
        type=drivers.StationCommandType.STC_ST3215_COMMAND,
        body=cmd.encode(),
    )


async def send_motor_commands(
    client, bus_serial: str, motor_commands: list[MotorCommand],
):
    """Group commands by register and send them as sync_write packs.

    Order matters: speed and accel must be in place before goal triggers
    movement, so they go out first.
    """
    if not motor_commands:
        return

    speed_writes: list[tuple[int, bytes]] = []
    accel_writes: list[tuple[int, bytes]] = []
    goal_writes: list[tuple[int, bytes]] = []

    for c in motor_commands:
        if c.speed is not None:
            speed_writes.append((c.motor_id, c.speed.to_bytes(2, "little")))
        if c.accel is not None:
            accel_writes.append((c.motor_id, bytes([c.accel])))
        if c.goal is not None:
            goal_writes.append((c.motor_id, c.goal.to_bytes(2, "little")))

    pack = []
    for w in (
        _sync_write(bus_serial, RAM_GOAL_SPEED, speed_writes),
        _sync_write(bus_serial, RAM_ACC, accel_writes),
        _sync_write(bus_serial, RAM_GOAL_POSITION, goal_writes),
    ):
        if w is not None:
            pack.append(w)

    if pack:
        await send_commands(client, pack)


async def set_torque(client, bus_serial: str, motor_ids: list[int], enable: bool):
    """Enable or disable torque on a list of motors via sync_write."""
    value = b"\x01" if enable else b"\x00"
    cmd = _sync_write(
        bus_serial, RAM_TORQUE_ENABLE, [(mid, value) for mid in motor_ids],
    )
    if cmd is not None:
        await send_commands(client, [cmd])

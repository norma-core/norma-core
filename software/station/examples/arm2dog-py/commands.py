"""Build and send Dogzilla servo/movement commands for the follower side.

The leader (ST3215) side is read-only in this script -- we only ever read
its motor state, never write to it -- so there's nothing ST3215-specific
here. Unlike ST3215's sync_write, the Dogzilla driver's `ServoCommand`
addresses one servo per `Command` (see `compute_command_effect` in
`software/drivers/yahboom-dogzilla-lite/src/shared.rs`), so each follower
motor becomes its own `DriverCommand` in the batch. `MovementCommand`
(move_x/move_y/move_yaw) is a single combined write, used here for yaw and
forward/backward -- move_y (strafe) is unused, always sent neutral (128).
"""

from software.station.shared.station_py import send_commands
from target.gen_python.protobuf.station import commands as station_commands, drivers
from target.gen_python.protobuf.drivers.yahboom_dogzilla_lite import yahboom_dogzilla_lite


def _servo_command(device_serial: str, servo_id: int, position: int) -> station_commands.DriverCommand:
    cmd = yahboom_dogzilla_lite.Command(
        target_device_serial=device_serial,
        servo=yahboom_dogzilla_lite.ServoCommand(servo_id=servo_id, position=position),
    )
    return station_commands.DriverCommand(
        type=drivers.StationCommandType.STC_YAHBOOM_DOGZILLA_LITE_COMMAND,
        body=cmd.encode(),
    )


def _movement_command(device_serial: str, move_x: int, move_yaw: int, move_y: int = 128) -> station_commands.DriverCommand:
    cmd = yahboom_dogzilla_lite.Command(
        target_device_serial=device_serial,
        movement=yahboom_dogzilla_lite.MovementCommand(move_x=move_x, move_y=move_y, move_yaw=move_yaw),
    )
    return station_commands.DriverCommand(
        type=drivers.StationCommandType.STC_YAHBOOM_DOGZILLA_LITE_COMMAND,
        body=cmd.encode(),
    )


async def send_follower_commands(
    client,
    device_serial: str,
    positions: dict[int, int] | None = None,
    movement: tuple[int, int] | None = None,
):
    """Send servo-position writes and/or a movement write, batched in one packet.

    `movement`, if given, is `(move_x, move_yaw)` -- both must be supplied
    together. A MovementCommand write is a full overwrite of the register
    triple, not a per-field patch, so a caller wanting to change only one
    axis still has to pass the other axis's current value alongside it (see
    `mirror.AxisState` in main.py) -- otherwise the omitted field would
    round-trip through protobuf as 0 (full-reverse-power), not 128
    (neutral), since gremlin skips encoding zero-valued fields.
    """
    pack = []
    if positions:
        pack.extend(_servo_command(device_serial, sid, pos) for sid, pos in positions.items())
    if movement is not None:
        move_x, move_yaw = movement
        pack.append(_movement_command(device_serial, move_x=move_x, move_yaw=move_yaw))

    if not pack:
        return
    await send_commands(client, pack)

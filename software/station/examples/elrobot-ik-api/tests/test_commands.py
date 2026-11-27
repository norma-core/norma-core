import pytest

from elrobot_ik.station import registers as R
from elrobot_ik.station.commands import (
    accel_command,
    drive_commands,
    goal_command,
    mirroring_stop_command,
    pack_commands,
    speed_command,
    sync_write,
    torque_command,
)
from elrobot_ik.station.proto import commands_pb2, drivers_pb2, mirroring_pb2
from tests.helpers import unpack_commands, unpack_driver_commands


def test_sync_write_shape():
    cmd = sync_write("BUS", 0x2A, [(1, b"\x00\x08"), (2, b"\x01\x08")])
    assert cmd.target_bus_serial == "BUS"
    assert cmd.sync_write.address == 0x2A
    assert [(m.motor_id, m.value) for m in cmd.sync_write.motors] == [(1, b"\x00\x08"), (2, b"\x01\x08")]


def test_torque_speed_accel_goal_encodings():
    t = torque_command("B", [1, 2], True)
    assert t.sync_write.address == R.ADDR_TORQUE_ENABLE
    assert all(m.value == b"\x01" for m in t.sync_write.motors)
    assert torque_command("B", [1], False).sync_write.motors[0].value == b"\x00"

    s = speed_command("B", [3], 600)
    assert s.sync_write.address == R.ADDR_GOAL_SPEED
    assert s.sync_write.motors[0].value == (600).to_bytes(2, "little")

    a = accel_command("B", [3], 30)
    assert a.sync_write.address == R.ADDR_ACCEL
    assert a.sync_write.motors[0].value == b"\x1e"

    g = goal_command("B", {1: 2048, 5: 4095})
    assert g.sync_write.address == R.ADDR_GOAL_POSITION
    assert [(m.motor_id, int.from_bytes(m.value, "little")) for m in g.sync_write.motors] == [(1, 2048), (5, 4095)]


def test_goal_rejects_out_of_range():
    with pytest.raises(ValueError):
        goal_command("B", {1: 4096})
    with pytest.raises(ValueError):
        goal_command("B", {1: -1})


def test_pack_and_unpack_round_trip():
    cmds = [torque_command("B", [1], True), goal_command("B", {1: 100})]
    data = pack_commands(cmds)
    pack = commands_pb2.StationCommandsPack.FromString(data)
    assert len(pack.commands) == 2
    assert all(c.type == drivers_pb2.STC_ST3215_COMMAND for c in pack.commands)
    back = unpack_commands(data)
    assert back[1].sync_write.address == R.ADDR_GOAL_POSITION


def test_mirroring_stop_command_and_mixed_pack():
    stop = mirroring_stop_command("BUS1")
    assert stop.type == drivers_pb2.STC_MOTOR_MIRRORING_COMMAND
    body = mirroring_pb2.Command.FromString(stop.body)
    assert body.type == mirroring_pb2.CT_STOP_MIRROR
    assert body.source.unique_id == "BUS1" and body.source.type == mirroring_pb2.MBT_ST3215

    data = pack_commands([stop, torque_command("BUS1", [1], True)])
    dcs = unpack_driver_commands(data)
    assert [d.type for d in dcs] == [drivers_pb2.STC_MOTOR_MIRRORING_COMMAND, drivers_pb2.STC_ST3215_COMMAND]
    assert unpack_commands(data)[0].sync_write.address == R.ADDR_TORQUE_ENABLE  # st3215 commands only


def test_drive_commands_sequence():
    cmds = drive_commands("B", {2: 1000, 8: 2000}, speed=300, accel=20)
    assert [c.sync_write.address for c in cmds] == [R.ADDR_TORQUE_ENABLE, R.ADDR_GOAL_SPEED, R.ADDR_ACCEL, R.ADDR_GOAL_POSITION]
    assert all([m.motor_id for m in c.sync_write.motors] == [2, 8] for c in cmds)

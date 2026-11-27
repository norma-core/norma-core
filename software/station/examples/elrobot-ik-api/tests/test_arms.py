from elrobot_ik.station.arms import ELROBOT_MOTOR_IDS, find_arm, parse_frame, role
from tests.helpers import make_bus_state, make_elrobot_bus, make_frame, make_motor_state


def test_parse_frame_builds_snapshots():
    frame = make_frame(make_elrobot_bus("F1", positions=[2000 + i for i in range(8)]))
    buses = parse_frame(frame)
    assert len(buses) == 1
    bus = buses[0]
    assert bus.serial == "F1"
    assert bus.is_elrobot
    assert bus.steps() == [2000 + i for i in range(8)]
    assert bus.motor(3).steps == 2002
    assert bus.motor(3).range_min == 1024 and bus.motor(3).range_max == 3072
    assert bus.motor(3).range_frozen is True
    assert bus.motor(9) is None
    assert abs(bus.voltage_v - 12.0) < 1e-9
    assert ELROBOT_MOTOR_IDS == (1, 2, 3, 4, 5, 6, 7, 8)


def test_six_motor_bus_is_not_elrobot():
    bus = make_bus_state("S1", [make_motor_state(i, 2048) for i in range(1, 7)])
    assert parse_frame(make_frame(bus))[0].is_elrobot is False


def test_find_arm_by_serial():
    buses = parse_frame(make_frame(make_elrobot_bus("A"), make_elrobot_bus("B")))
    assert find_arm(buses, "B").serial == "B"
    assert find_arm(buses, "ZZZ") is None


def test_role_from_supply_voltage():
    leader = parse_frame(make_frame(make_elrobot_bus("LEAD", voltage_v=7.4)))[0]
    follower = parse_frame(make_frame(make_elrobot_bus("FOLL", voltage_v=12.1)))[0]
    assert role(leader) == "leader" and role(follower) == "follower"


def test_station_error_field_marks_motor_error():
    from elrobot_ik.station.proto import st3215_pb2

    healthy = make_motor_state(1, 2048)
    broken = make_motor_state(2, 2048)
    broken.error.kind = st3215_pb2.ST3215Error.SEK_TIMEOUT
    broken.error.description = "no response"
    bus = parse_frame(make_frame(make_bus_state("E", [healthy, broken])))[0]
    assert bus.motor(1).error is False and bus.motor(1).error_detail == ""
    assert bus.motor(2).error is True
    assert "no response" in bus.motor(2).error_detail

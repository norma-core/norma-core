import asyncio
import math
import time

import pytest

from elrobot_ik.calibration.mapper import MotorMapper
from elrobot_ik.config import Settings
from elrobot_ik.kinematics.ik import IKResult
from elrobot_ik.kinematics.transforms import make_transform, rpy_to_rotation
from elrobot_ik.service import ServiceError
from elrobot_ik.station.arms import parse_frame
from elrobot_ik.station.client import StationError
from elrobot_ik.station.proto import mirroring_pb2, st3215_pb2
from tests.helpers import (
    CAM_ID,
    CAM_QUEUE,
    FAST,
    INSTANCE,
    camera_queues,
    goal_steps,
    is_goal_write,
    make_bus_state,
    make_camera_frame,
    make_elrobot_bus,
    make_frame,
    make_inference_states,
    make_motor_state,
    make_service,
)

TORQUE, ACCEL, GOAL_SPEED, GOAL = 0x28, 0x29, 0x2E, 0x2A
DRIVE_ADDRESSES = [TORQUE, GOAL_SPEED, ACCEL, GOAL]


def DOWN(x, y, z, rot_deg=0.0):
    """Vertical gripper (approach axis down) with the jaws turned rot_deg about the vertical."""
    return make_transform(rpy_to_rotation(-math.pi / 2, 0.0, math.radians(rot_deg)), (x, y, z))


def calibrated_frame(positions=None, serial="F1", **kw):
    return make_frame(make_elrobot_bus(serial, positions=positions, **kw))


def addresses(client):
    return [c.sync_write.address for c in client.st3215_commands]


def goal_writes(client):
    return [c for c in client.st3215_commands if is_goal_write(c)]


def steps_at(bus_frame, angles, model):
    return MotorMapper(model.joint_limits).angles_to_steps(angles, parse_frame(bus_frame)[0])


async def point(svc, x, y, z, rotation_deg=0.0, **kw):
    """Vertical gripper over (x, y, z): the common move in these tests."""
    kw = {"gripper": None, "execute": False, "speed": None, "accel": None, **kw}
    return await svc.move_to("F1", DOWN(x, y, z, rotation_deg), **kw)


def test_settings_from_env_defaults_and_overrides():
    s = Settings.from_env({})
    assert s.station_url == "ws://localhost:8889/api"
    s2 = Settings.from_env({"STATION_URL": "ws://pi:8889/api", "MOTION_SPEED": "9999", "IK_PORT": "9000"})
    assert s2.station_url == "ws://pi:8889/api"
    assert s2.motion_speed == 9999  # clamped where used, not here
    assert s2.port == 9000


def test_resolve_errors(model, solver):
    svc, _ = make_service(model, solver, None)
    with pytest.raises(ServiceError) as e:
        svc.resolve("F1")
    assert e.value.status == 503 and e.value.code == "no_frame"

    svc, _ = make_service(model, solver, calibrated_frame(), age_ms=5000)
    with pytest.raises(ServiceError) as e:
        svc.resolve("F1")
    assert e.value.status == 503 and e.value.code == "stale_frame"

    svc, _ = make_service(model, solver, make_frame(make_elrobot_bus("A"), make_elrobot_bus("B")))
    with pytest.raises(ServiceError) as e:
        svc.resolve("NOPE")
    assert e.value.status == 404 and e.value.extra["candidates"] == ["A", "B"]


async def test_list_arms_reports_role_torque_joints_and_pose(model, solver):
    svc, _ = make_service(model, solver, make_frame(make_elrobot_bus("F1", voltage_v=12.0), make_elrobot_bus("L1", voltage_v=7.4)))
    arms = (await svc.list_arms())
    assert [(a["id"], a["role"]) for a in arms] == [("F1", "follower"), ("L1", "leader")]

    arm = arms[0]
    assert set(arm) == {"id", "role", "calibrated", "torque_enabled", "pose", "gripper", "joints"}
    assert arm["calibrated"] is True and arm["torque_enabled"] is True
    assert [j["motor"] for j in arm["joints"]] == [1, 2, 3, 4, 5, 6, 7, 8]
    centers = [(l.lower + l.upper) / 2 for l in model.joint_limits]
    assert [j["angle_rad"] for j in arm["joints"]] == pytest.approx(centers, abs=1e-3)
    assert all(j["steps"] == 2048 for j in arm["joints"])
    assert set(arm["pose"]) == {"position", "rpy", "rotation_deg"}
    assert arm["pose"]["position"]["x"] == pytest.approx(model.fk(centers)[0, 3], abs=1e-6)
    assert arm["gripper"] == pytest.approx(0.5)


async def test_uncalibrated_arm_is_listed_without_a_pose(model, solver):
    svc, _ = make_service(model, solver, make_frame(make_elrobot_bus("F1"), make_elrobot_bus("U1", calibrated=False)))
    arm = (await svc.list_arms())[1]
    assert arm["id"] == "U1" and arm["calibrated"] is False
    assert arm["pose"] is None and arm["gripper"] is None
    assert all(j["angle_rad"] is None and j["steps"] == 2048 for j in arm["joints"])


async def test_six_motor_bus_is_not_listed_as_an_arm(model, solver):
    six = make_bus_state("S1", [make_motor_state(i, 2048) for i in range(1, 7)])
    svc, _ = make_service(model, solver, make_frame(six, make_elrobot_bus("F1")))
    assert [a["id"] for a in (await svc.list_arms())] == ["F1"]


def test_health(model, solver):
    svc, _ = make_service(model, solver, calibrated_frame())
    h = svc.health()
    assert h["status"] == "ok" and h["station_connected"] is True and h["last_frame_age_ms"] == 10.0


async def test_move_to_dry_run_returns_steps_and_sends_nothing(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    out = await point(svc, 0.21, 0.05, 0.05)
    assert out.executed is False and out.motion.status == "not_executed"
    assert len(out.motor_steps) == 8 and all(1024 <= s <= 3072 for s in out.motor_steps)
    assert out.motor_steps[7] == 2048  # gripper held
    assert out.tcp_pose[:3, 3] == pytest.approx([0.21, 0.05, 0.05], abs=0.003)
    assert client.sent == []


async def test_dry_run_works_on_an_uncalibrated_arm(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(calibrated=False))
    out = await point(svc, 0.21, 0.0, 0.05)
    assert out.motor_steps == [] and out.tcp_pose[:3, 3] == pytest.approx([0.21, 0.0, 0.05], abs=0.003)
    assert client.sent == []


async def test_move_to_gripper_sets_motor_8(model, solver):
    svc, _ = make_service(model, solver, calibrated_frame())
    out = await point(svc, 0.21, 0.0, 0.05, gripper=1.0)
    # gripper 1.0 = open = URDF 0 rad (the URDF's zero pose has the jaws open); motor 8 runs
    # direction -1, so 0 rad is the arc max.
    assert out.motor_steps[7] == 3072
    assert out.joint_angles_rad[7] == pytest.approx(0.0)
    closed = await point(svc, 0.21, 0.0, 0.05, gripper=0.0)
    assert closed.joint_angles_rad[7] == pytest.approx(2.2028)
    assert closed.motor_steps[7] == 1024
    with pytest.raises(ServiceError) as e:
        await point(svc, 0.21, 0.0, 0.05, gripper=1.5)
    assert e.value.status == 422 and e.value.code == "invalid_gripper"


async def test_execute_without_gripper_leaves_motor_8_alone(model, solver):
    """A plain move must not re-command the gripper: writing its present position as the goal
    would cancel the squeeze on an object held after a stalled close."""
    held = calibrated_frame(positions=[2048] * 7 + [1500])  # jaws stopped on an object, goal was further closed
    svc, client = make_service(model, solver, held)
    client.arrive_at_goals()
    out = await point(svc, 0.21, 0.05, 0.05, execute=True)
    assert out.motion.status == "reached"
    assert len(out.motor_steps) == 8
    assert all(set(goal_steps([g])) == {1, 2, 3, 4, 5, 6, 7} for g in goal_writes(client))
    assert all(m.motor_id != 8 for c in client.st3215_commands for m in c.sync_write.motors)
    client.sent.clear()
    client.set_frame(held)
    await point(svc, 0.21, 0.05, 0.05, gripper=0.5, execute=True)
    assert 8 in goal_steps(goal_writes(client))


async def test_move_to_unreachable_is_422(model, solver):
    svc, _ = make_service(model, solver, calibrated_frame())
    with pytest.raises(ServiceError) as e:
        await point(svc, 1.0, 0.0, 0.05)
    assert e.value.status == 422 and e.value.code == "unreachable"
    assert set(e.value.extra) == {"position_error", "angle_error"} and e.value.extra["position_error"] > 0.3


async def test_move_to_below_table_is_422(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    with pytest.raises(ServiceError) as e:
        await point(svc, 0.21, 0.0, -0.05, execute=True)
    assert e.value.status == 422 and e.value.code in ("collision", "unreachable")
    assert client.sent == []


async def test_execute_requires_calibration(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(calibrated=False))
    with pytest.raises(ServiceError) as e:
        await point(svc, 0.21, 0.0, 0.05, execute=True)
    assert e.value.status == 409 and e.value.code == "not_calibrated"
    assert e.value.extra["motors"] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert client.sent == []


async def test_execute_refuses_motor_errors(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(status=0x20))
    with pytest.raises(ServiceError) as e:
        await point(svc, 0.21, 0.0, 0.05, execute=True)
    assert e.value.status == 409 and e.value.code == "motor_error"
    assert client.sent == []


async def test_execute_refuses_station_reported_motor_error(model, solver):
    motors = [make_motor_state(i, 2048, range_min=1024, range_max=3072, frozen=True) for i in range(1, 9)]
    motors[2].error.kind = st3215_pb2.ST3215Error.SEK_TIMEOUT
    motors[2].error.description = "no response"
    svc, _ = make_service(model, solver, make_frame(make_bus_state("F1", motors)))
    with pytest.raises(ServiceError) as e:
        await point(svc, 0.21, 0.0, 0.05, execute=True)
    assert e.value.code == "motor_error" and e.value.extra["motors"] == [3]
    assert "no response" in e.value.extra["details"][3]


async def test_execute_stops_mirroring_then_sends_torque_speed_accel_goal(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    client.arrive_at_goals()
    out = await point(svc, 0.21, 0.05, 0.05, execute=True, speed=800, accel=40)
    assert out.executed and out.motion.status == "reached"
    assert client.driver_types[0] == 1  # STC_MOTOR_MIRRORING_COMMAND first
    stop = mirroring_pb2.Command.FromString(client.sent[0][0].body)
    assert stop.type == mirroring_pb2.CT_STOP_MIRROR and stop.source.unique_id == "F1"
    assert addresses(client) == DRIVE_ADDRESSES
    torque, speed, accel, goal = client.st3215_commands
    assert all(m.value == b"\x01" for m in torque.sync_write.motors)
    assert int.from_bytes(speed.sync_write.motors[0].value, "little") == 800
    assert accel.sync_write.motors[0].value == bytes([40])
    assert list(goal_steps([goal]).values()) == out.motor_steps[:7]  # gripper omitted: motor 8 is not written


async def test_execute_reports_stalled_when_arm_does_not_move(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    out = await point(svc, 0.21, 0.05, 0.05, execute=True)
    assert out.executed and out.motion.status == "stalled"
    assert out.motion.duration_ms < 1000  # settle detection, not the full timeout
    assert len(goal_writes(client)) == 3  # initial goal + 2 nudges, each re-sent against a stalled arm


async def test_speed_and_accel_are_clamped(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    await point(svc, 0.21, 0.05, 0.05, execute=True, speed=5, accel=999)
    _, speed, accel, *_ = client.st3215_commands
    assert int.from_bytes(speed.sync_write.motors[0].value, "little") == 100
    assert accel.sync_write.motors[0].value == bytes([100])


async def test_move_to_full_pose(model, solver):
    svc, _ = make_service(model, solver, calibrated_frame())
    out = await svc.move_to("F1", DOWN(0.18, 0.0, 0.06), gripper=None, execute=False, speed=None, accel=None)
    assert out.tcp_pose[:3, 3] == pytest.approx([0.18, 0.0, 0.06], abs=0.003)


async def test_set_torque(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    res = await svc.set_torque("F1", False)
    assert res == {"id": "F1", "torque_enabled": False}
    assert addresses(client) == [TORQUE]
    assert all(m.value == b"\x00" for m in client.st3215_commands[0].sync_write.motors)
    assert client.driver_types == [0]  # releasing does not touch mirroring
    client.sent.clear()
    await svc.set_torque("F1", True)
    assert client.driver_types == [1, 0]  # holding the arm first releases it from leader mirroring


async def test_station_error_becomes_503(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())

    async def boom(cmds):
        raise StationError("disconnected", "gone")

    client.send_commands = boom
    with pytest.raises(ServiceError) as e:
        await svc.set_torque("F1", True)
    assert e.value.status == 503 and e.value.code == "station_disconnected"


SLOW = {"motion_timeout_s": 5.0, "settle_window_s": 2.0}  # a motion that stays "in flight" for the whole test


async def until(cond, timeout_s: float = 5.0) -> None:
    """Poll until cond() holds. Solves run in a worker thread, so request progress is not a sleep away."""
    t0 = time.monotonic()
    while not cond():
        assert time.monotonic() - t0 < timeout_s, "condition not met in time"
        await asyncio.sleep(0.005)


async def goal_sent(client, n: int = 1) -> None:
    await until(lambda: len(goal_writes(client)) >= n)


async def test_new_execute_stops_the_running_motion_and_runs_instead(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), settings=Settings(**SLOW))
    first = asyncio.create_task(point(svc, 0.21, 0.05, 0.05, execute=True))
    await goal_sent(client)  # first request has sent its goal and is waiting for arrival
    client.arrive_at_goals()
    second = await point(svc, 0.21, 0.0, 0.05, execute=True)
    assert second.motion.status == "reached"
    out = await first
    assert out.executed and out.motion.status == "unknown"  # the service stopped watching it
    assert out.motion.duration_ms < 500  # it stopped waiting as soon as the newer command arrived
    assert len(goal_writes(client)) == 2  # first's goal, then second's; no nudges for the stopped one
    # a dry run is still allowed at any time
    dry = await point(svc, 0.21, 0.0, 0.05)
    assert dry.executed is False


async def test_torque_change_stops_the_running_motion(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), settings=Settings(**SLOW))
    first = asyncio.create_task(point(svc, 0.21, 0.05, 0.05, execute=True))
    await goal_sent(client)
    res = await svc.set_torque("F1", False)
    assert res == {"id": "F1", "torque_enabled": False}
    assert (await first).motion.status == "unknown"
    assert addresses(client)[-1] == TORQUE and client.st3215_commands[-1].sync_write.motors[0].value == b"\x00"


async def test_only_the_newest_of_several_waiting_commands_runs(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), settings=Settings(**SLOW))
    # Keep the first motion "in flight" (its arrival wait gated) while two more commands solve
    # and queue up behind it, so both are waiting on the arm when it is released: only the
    # newest of them may drive.
    gate = asyncio.Event()
    real_wait = svc._wait_settled

    async def gated_wait(*args):
        await gate.wait()
        return await real_wait(*args)

    svc._wait_settled = gated_wait
    first = asyncio.create_task(point(svc, 0.21, 0.05, 0.05, execute=True))
    await goal_sent(client)
    second = asyncio.create_task(point(svc, 0.21, -0.05, 0.05, execute=True))
    await until(lambda: svc._tickets["F1"] == 2)
    third = asyncio.create_task(point(svc, 0.21, 0.0, 0.05, execute=True))
    await until(lambda: svc._tickets["F1"] == 3)
    client.arrive_at_goals()
    gate.set()
    assert (await third).motion.status == "reached"
    assert (await first).motion.status == "unknown"  # was driving: stopped watching
    assert (await second).executed is False  # never got to drive: nothing written for it
    assert len(goal_writes(client)) == 2


async def test_gripper_command_during_an_arm_move_is_judged_on_motor_8_only(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), settings=Settings(**SLOW))
    first = asyncio.create_task(point(svc, 0.21, 0.05, 0.05, execute=True))
    await goal_sent(client)

    def arm_still_moving(cmds):
        goals = goal_steps(cmds)
        if 8 in goals and len(goals) == 1:  # the gripper goal: motors 1-7 are elsewhere than when it was sent
            client.set_frame(calibrated_frame(positions=[2500] * 7 + [goals[8]]))

    client.on_send = arm_still_moving
    res = await svc.set_gripper("F1", 0.0, speed=None, accel=None)
    assert res["motion"]["status"] == "reached"
    assert (await first).motion.status == "unknown"


async def test_execute_reports_unknown_when_station_drops_during_wait(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())

    def drop(cmds):
        if any(is_goal_write(c) for c in cmds):
            client.connected = False

    client.on_send = drop
    out = await point(svc, 0.21, 0.05, 0.05, execute=True)
    assert out.executed and out.motion.status == "unknown"
    assert out.motion.duration_ms < 200  # did not sit out the full timeout


async def test_execute_reports_unknown_when_the_arm_leaves_the_station(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), settings=Settings(**SLOW))
    client.on_send = lambda cmds: client.set_frame(make_frame(make_elrobot_bus("OTHER"))) if goal_steps(cmds) else None
    t0 = time.monotonic()
    out = await point(svc, 0.21, 0.05, 0.05, execute=True)
    assert out.motion.status == "unknown"
    assert time.monotonic() - t0 < 2.0  # reported as soon as the bus is gone, not after the motion timeout


async def test_execute_reports_unknown_when_frames_go_stale(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())

    def stale(cmds):
        if any(is_goal_write(c) for c in cmds):
            client.age_ms = 5000

    client.on_send = stale
    out = await point(svc, 0.21, 0.05, 0.05, execute=True)
    assert out.motion.status == "unknown"


async def test_solution_outside_joint_limits_is_500(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    bad = [0.0] * 8
    bad[1] = model.joint_limits[1].upper + 0.5
    svc.solver = type("S", (), {"solve_pose": lambda self, T, seed, accept=None: IKResult(bad, 0.0, 0.0, True, 1)})()
    with pytest.raises(ServiceError) as e:
        await point(svc, 0.21, 0.0, 0.05, execute=True)
    assert e.value.status == 500 and e.value.code == "limit_violation"
    assert client.sent == []


async def test_move_to_from_folded_rest_pose_finds_collision_free_solution(model, solver):
    # Real hardware pose from 2026-10-16; the first IK restart collides at the wrist limit.
    from tests.test_ik import FOLDED_REST

    svc, _ = make_service(model, solver, calibrated_frame(positions=steps_at(calibrated_frame(), FOLDED_REST, model)))
    out = await point(svc, 0.20, 0.0, 0.06)
    assert out.tcp_pose[:3, 3] == pytest.approx([0.20, 0.0, 0.06], abs=0.003)


async def test_execute_nudges_goals_to_cancel_servo_sag(model, solver):
    """Servos with P-only control stop short under load; the service re-commands by the residual."""
    svc, client = make_service(model, solver, calibrated_frame())
    client.arrive_at_goals(sag={3: 25, 4: 29})  # steps short, as measured on the real arm
    out = await point(svc, 0.21, 0.05, 0.05, execute=True)
    assert out.motion.status == "reached", out.motion
    writes = goal_writes(client)
    assert len(writes) == 2  # one nudge was enough
    first, second = (goal_steps([w]) for w in writes)
    assert second[3] == first[3] + 25 and second[4] == first[4] + 29
    assert second[1] == first[1]  # motors without residual are re-sent unchanged


async def test_execute_timeout_when_arm_keeps_moving(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    tick = {"n": 0}
    real_buses = client.buses

    def jittering():
        tick["n"] += 1
        client.set_frame(calibrated_frame(positions=[1500 + (tick["n"] % 2) * 50] * 8))
        return real_buses()

    client.buses = jittering
    out = await point(svc, 0.21, 0.05, 0.05, execute=True)
    assert out.motion.status == "timeout"
    assert out.motion.duration_ms >= FAST["motion_timeout_s"] * 1000


async def test_list_arms_reports_gripper_fraction(model, solver):
    # motor 8 runs direction -1: arc max = URDF 0 rad = open (1.0), arc min = 2.2 rad = closed (0.0)
    for steps, fraction in ((3072, 1.0), (1024, 0.0), (2048, 0.5)):
        svc, _ = make_service(model, solver, calibrated_frame(positions=[2048] * 7 + [steps]))
        assert (await svc.list_arms())[0]["gripper"] == pytest.approx(fraction)


async def test_set_gripper_moves_only_motor_8(model, solver):
    svc, client = make_service(model, solver, calibrated_frame())
    client.arrive_at_goals()
    res = await svc.set_gripper("F1", 1.0, speed=None, accel=None)
    assert set(res) == {"id", "gripper", "motion"}
    assert res["gripper"] == pytest.approx(1.0) and res["motion"] == {"status": "reached", "duration_ms": res["motion"]["duration_ms"]}
    assert addresses(client) == DRIVE_ADDRESSES
    for c in client.st3215_commands:
        assert [m.motor_id for m in c.sync_write.motors] == [8]
    closed = await svc.set_gripper("F1", 0.0, speed=None, accel=None)
    assert closed["gripper"] == pytest.approx(0.0)
    assert goal_steps(client.st3215_commands[-1:])[8] == 1024
    with pytest.raises(ServiceError) as e:
        await svc.set_gripper("F1", 1.5, speed=None, accel=None)
    assert e.value.status == 422 and e.value.code == "invalid_gripper"


async def test_move_to_with_rotation_sets_jaw_direction(model, solver):
    svc, _ = make_service(model, solver, calibrated_frame())
    for rot in (0.0, 90.0, -45.0):
        out = await point(svc, 0.16, 0.0, 0.05, rotation_deg=rot)
        T = out.tcp_pose
        assert T[:3, 1] == pytest.approx([0.0, 0.0, -1.0], abs=0.05)  # still pointing down
        jaw_dir = math.degrees(math.atan2(T[1, 0], T[0, 0]))  # gripper X axis = jaw opening direction
        assert jaw_dir == pytest.approx(rot, abs=3.0)
        assert T[:3, 3] == pytest.approx([0.16, 0.0, 0.05], abs=0.003)


async def test_list_arms_reports_rotation_deg(model, solver):
    svc, _ = make_service(model, solver, calibrated_frame())
    arm = (await svc.list_arms())[0]
    T = model.fk([j["angle_rad"] for j in arm["joints"]])
    assert arm["pose"]["rotation_deg"] == pytest.approx(math.degrees(math.atan2(T[1, 0], T[0, 0])), abs=1e-6)


async def test_list_arms_reports_torque(model, solver):
    motors = [make_motor_state(i, 2048, range_min=1024, range_max=3072, frozen=True, torque=(i != 3)) for i in range(1, 9)]
    svc, _ = make_service(model, solver, make_frame(make_bus_state("F1", motors)))
    assert (await svc.list_arms())[0]["torque_enabled"] is False  # any motor without torque -> the arm is not fully held


# Pose read from the real arm resting with its jaws on the table (torque off): the jaws are in
# contact with the table surface, and stay so for the first part of any path away from it.
JAWS_ON_TABLE = [math.radians(a) for a in (-67.2, 10.7, 16.8, -5.4, 3.6, 75.4, 34.8, 114.2)]


async def test_move_from_a_pose_with_preexisting_contacts_is_allowed(model, solver):
    assert model.collisions(JAWS_ON_TABLE).table_pairs, "precondition: the start pose touches the table"
    svc, _ = make_service(model, solver, calibrated_frame(positions=steps_at(calibrated_frame(), JAWS_ON_TABLE, model)))
    out = await svc.move_to("F1", DOWN(0.16, 0.0, 0.05), gripper=None, execute=False, speed=None, accel=None)
    assert out.tcp_pose[:3, 3] == pytest.approx([0.16, 0.0, 0.05], abs=0.003)


async def test_new_contact_along_the_path_is_still_rejected(model, solver):
    # Same start, but a target under the table surface: the gripper body would hit the table.
    svc, client = make_service(model, solver, calibrated_frame(positions=steps_at(calibrated_frame(), JAWS_ON_TABLE, model)))
    with pytest.raises(ServiceError) as e:
        await svc.move_to("F1", DOWN(0.16, 0.0, -0.03), gripper=None, execute=True, speed=None, accel=None)
    assert e.value.status == 422 and e.value.code in ("collision", "unreachable")
    assert client.sent == []


async def test_list_cameras_and_image(model, solver):
    svc, _ = make_service(model, solver, calibrated_frame(), queues=camera_queues(b"\xff\xd8latest"))
    cams = await svc.list_cameras()
    assert cams == [{"id": "7bd21f18e39708492c1deee9e2a86aa7", "name": "UVC Camera", "unique_id": "0x113", "width": 299, "height": 224}]
    jpeg, meta = await svc.camera_image("7bd21f18e39708492c1deee9e2a86aa7")
    assert jpeg == b"\xff\xd8latest"
    assert meta["width"] == 299 and meta["height"] == 224 and meta["name"] == "UVC Camera"
    with pytest.raises(ServiceError) as e:
        await svc.camera_image("nope")
    assert e.value.status == 404 and e.value.code == "not_found"


async def test_camera_that_appears_after_the_listing_is_found_on_first_request(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), queues=camera_queues())
    assert await svc.list_cameras()  # cached listing: one camera
    new_id = "0123456789abcdef0123456789abcdef"
    new_queue = f"{INSTANCE}/usbvideo/{new_id}"
    client.queues["inference-states"] = [make_inference_states({CAM_QUEUE: "video", new_queue: "video"})]
    client.queues[new_queue] = [make_camera_frame(b"\xff\xd8new", product="New Cam", unique_id="0x2")]
    jpeg, meta = await svc.camera_image(new_id)
    assert jpeg == b"\xff\xd8new" and meta["name"] == "New Cam"
    assert [c["id"] for c in await svc.list_cameras()] == [CAM_ID, new_id]


async def test_camera_calls_need_the_station(model, solver):
    svc, _ = make_service(model, solver, None, connected=False)
    with pytest.raises(ServiceError) as e:
        await svc.list_cameras()
    assert e.value.status == 503

"""Handing an arm over from leader mirroring: the station's delayed torque-off, partial moves,
retries and cancellation, and the mirroring-state cases that decide whether a stop is sent at all."""
import asyncio

import pytest

from elrobot_ik.config import Settings
from elrobot_ik.service import ServiceError
from elrobot_ik.station import registers as R
from elrobot_ik.station.client import StationError
from elrobot_ik.station.commands import torque_command
from elrobot_ik.station.mirroring import torque_release_receipt
from elrobot_ik.station.proto import commands_pb2, mirroring_pb2, st3215_pb2
from tests.helpers import (
    FAST,
    MIRRORING_QUEUE,
    FakeStationClient,
    goal_steps,
    make_bus_state,
    make_frame,
    make_mirroring_state,
    make_motor_state,
    make_service,
    mirroring_queues,
)
from tests.test_service import calibrated_frame, point, until


def frame_with_torque(enabled):
    follower = make_bus_state('F1', [make_motor_state(i, 2048, range_min=1024, range_max=3072,
                              frozen=True, torque=i in enabled) for i in range(1, 9)])
    leader = make_bus_state('L1', [make_motor_state(i, 2048, voltage_v=6, torque=False) for i in range(1, 9)])
    return make_frame(follower, leader)


async def operate(svc, operation):
    if operation == 'gripper':
        return await svc.set_gripper('F1', 0.2, speed=200, accel=10)
    if operation == 'hold':
        return await svc.set_torque('F1', True)
    return await point(svc, 0.21, 0.05, 0.05, execute=True,
                       gripper=0.2 if operation == 'move_gripper' else None)


def torque_ids(client):
    return {m.id for m in client.buses()[0].motors if m.torque_enabled}


@pytest.mark.parametrize('mirrored', [False, True])
@pytest.mark.parametrize('initial', [set(), {8}, {1, 3, 8}, set(range(1, 8)), set(range(1, 9))])
@pytest.mark.parametrize('operation,commanded', [('gripper', {8}), ('move', set(range(1, 8))),
                                               ('move_gripper', set(range(1, 9)))])
async def test_command_scope_and_previous_torque(model, solver, mirrored, initial, operation, commanded):
    svc, client = make_service(model, solver, frame_with_torque(initial),
                               queues=mirroring_queues('F1') if mirrored else {})
    client.arrive_at_goals()
    await operate(svc, operation)
    assert torque_ids(client) == initial | commanded
    assert all(not m.torque_enabled for m in client.buses()[1].motors)
    for command in client.st3215_commands:
        assert command.target_bus_serial == 'F1'
        if command.sync_write.address == R.ADDR_TORQUE_ENABLE:
            assert all(w.value == b'\x01' for w in command.sync_write.motors)
            assert {w.motor_id for w in command.sync_write.motors} <= initial | commanded
        else:
            assert {w.motor_id for w in command.sync_write.motors} <= commanded
    assert (1 in client.driver_types) == mirrored
    assert not svc._pending_handoffs


def delay_stop(client):
    client.auto_stop = False
    client.arrive_at_goals()
    arrive = client.on_send

    def on_send(commands):
        for command in commands:
            if isinstance(command, commands_pb2.DriverCommand) and command.type == 1:
                stop = mirroring_pb2.Command.FromString(command.body)
                client.detach_mirroring(stop.source.unique_id)
        arrive(commands)
    client.on_send = on_send


@pytest.mark.parametrize('initial', [set(), {1, 3, 8}, set(range(1, 9))])
async def test_waits_for_new_receipt_not_just_mirroring_state_or_off_bits(model, solver, initial):
    svc, client = make_service(model, solver, frame_with_torque(initial), queues=mirroring_queues('F1'))
    client.complete_stop('F1')
    client.apply_torque(torque_command('F1', sorted(initial), True))
    delay_stop(client)
    request = asyncio.create_task(operate(svc, 'gripper'))
    await until(lambda: 1 in client.driver_types)
    await asyncio.sleep(0.04)
    assert not request.done() and not client.st3215_commands
    client.apply_torque(torque_command('F1', range(1, 9), False))
    await asyncio.sleep(0.04)
    assert not request.done() and not client.st3215_commands
    client.complete_stop('F1')
    await request
    assert torque_ids(client) == initial | {8}


async def test_timeout_retains_restoration_for_retry_without_a_second_stop(model, solver):
    initial = {1, 3, 8}
    svc, client = make_service(model, solver, frame_with_torque(initial), queues=mirroring_queues('F1'),
                               settings=Settings(**FAST, handoff_timeout_s=0.08))
    delay_stop(client)
    with pytest.raises(ServiceError, match='torque-off was not confirmed'):
        await operate(svc, 'gripper')
    assert not client.st3215_commands
    assert 'F1' in svc._pending_handoffs
    client.complete_stop('F1')
    await operate(svc, 'gripper')
    assert client.driver_types.count(1) == 1
    assert torque_ids(client) == initial | {8}
    assert not svc._pending_handoffs


async def test_retry_completes_on_the_echo_when_the_receipt_was_never_seen(model, solver):
    """The driver's torque-off landed but a later command overwrote its receipt before the service
    saw it (or the driver never wrote it). A retry must not wait again for a receipt that cannot
    come, nor send another stop: the driver's echo of the stop says its torque-off is already queued
    ahead of anything sent now."""
    initial = {1, 3, 8}
    svc, client = make_service(model, solver, frame_with_torque(initial), queues=mirroring_queues('F1'),
                               settings=Settings(**FAST, handoff_timeout_s=0.08))
    delay_stop(client)  # echoes the stop, never writes its torque-off
    with pytest.raises(ServiceError, match='torque-off was not confirmed'):
        await operate(svc, 'gripper')
    client.apply_torque(torque_command('F1', range(1, 9), False))  # off bits only: the receipt is gone
    assert 'F1' in svc._pending_handoffs and not svc._pending_handoffs['F1'].released
    await operate(svc, 'gripper')
    assert client.driver_types.count(1) == 1
    assert torque_ids(client) == initial | {8}
    assert not svc._pending_handoffs


async def test_cancelled_caller_finishes_restoring_previous_torque(model, solver):
    initial = {1, 3}
    svc, client = make_service(model, solver, frame_with_torque(initial), queues=mirroring_queues('F1'))
    delay_stop(client)
    request = asyncio.create_task(operate(svc, 'gripper'))
    await until(lambda: 1 in client.driver_types)
    await asyncio.sleep(0)
    request.cancel()
    client.complete_stop('F1')
    with pytest.raises(asyncio.CancelledError):
        await request
    assert torque_ids(client) == initial
    assert not goal_steps(client.st3215_commands)
    assert not svc._pending_handoffs


async def test_new_request_during_handoff_suppresses_old_gripper_goal(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), queues=mirroring_queues('F1'))
    delay_stop(client)
    first = asyncio.create_task(operate(svc, 'gripper'))
    await until(lambda: 1 in client.driver_types)
    second = asyncio.create_task(svc.set_torque('F1', False))
    await until(lambda: svc._tickets['F1'] == 2)
    client.complete_stop('F1')
    assert (await first)['motion']['status'] == 'not_executed'
    await second
    assert not goal_steps(client.st3215_commands)
    assert torque_ids(client) == set()


async def test_each_command_rechecks_mirroring_without_a_session(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), queues=mirroring_queues('F1'))
    client.arrive_at_goals()
    for _ in range(2):
        client.queues[MIRRORING_QUEUE].append(make_mirroring_state(['F1']))
        client.sent.clear()
        await operate(svc, 'gripper')
        assert client.driver_types.count(1) == 1
    client.sent.clear()
    await operate(svc, 'gripper')
    assert 1 not in client.driver_types


async def test_explicit_release_does_not_restore_torque_during_detachment(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), queues=mirroring_queues('F1'))
    await svc.set_torque('F1', False)
    assert client.driver_types == [1, 0]
    assert torque_ids(client) == set()
    assert all(w.value == b'\x00' for c in client.st3215_commands for w in c.sync_write.motors)


async def test_cancellation_during_stop_write_ack_still_restores(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), queues=mirroring_queues('F1'))
    write_ack = asyncio.Event()
    send = client.send_commands

    async def delayed_ack(commands):
        await send(commands)
        if isinstance(commands[0], commands_pb2.DriverCommand):
            await write_ack.wait()
    client.send_commands = delayed_ack
    request = asyncio.create_task(operate(svc, 'gripper'))
    await until(lambda: 1 in client.driver_types)
    request.cancel()
    write_ack.set()
    with pytest.raises(asyncio.CancelledError):
        await request
    assert torque_ids(client) == set(range(1, 9))
    assert not goal_steps(client.st3215_commands)


async def test_missing_state_after_stop_aborts_before_restoration_or_motion(model, solver):
    svc, client = make_service(model, solver, calibrated_frame(), queues=mirroring_queues('F1'))
    client.on_send = lambda _: client.queues.clear()
    with pytest.raises(ServiceError) as e:
        await operate(svc, 'gripper')
    assert e.value.status == 503  # a station fault, not a wrong arm id
    assert not client.st3215_commands
    assert 'F1' in svc._pending_handoffs


@pytest.mark.parametrize('restart_mirroring', [False, True])
async def test_unconfirmed_restore_retry_rechecks_mirroring(model, solver, restart_mirroring):
    svc, client = make_service(model, solver, calibrated_frame(), queues=mirroring_queues('F1'),
                               settings=Settings(**FAST, handoff_timeout_s=0.08))
    send = client.send_commands

    async def lose_servo_write(commands):
        if isinstance(commands[0], commands_pb2.DriverCommand):
            await send(commands)
        else:
            client.sent.append(list(commands))
    client.send_commands = lose_servo_write
    with pytest.raises(ServiceError, match='requested torque state'):
        await operate(svc, 'gripper')
    assert not goal_steps(client.st3215_commands)
    assert svc._pending_handoffs['F1'].released
    if restart_mirroring:
        client.queues[MIRRORING_QUEUE].append(make_mirroring_state(['F1']))
    client.send_commands = send
    client.arrive_at_goals()
    await operate(svc, 'gripper')
    assert client.driver_types.count(1) == (2 if restart_mirroring else 1)
    assert torque_ids(client) == set(range(1, 9))


async def test_unconfirmed_torque_enable_does_not_send_the_new_movement_goal(model, solver):
    svc, client = make_service(model, solver, frame_with_torque(set()),
                               settings=Settings(**FAST, handoff_timeout_s=0.08))

    async def acknowledge_only(commands):
        client.sent.append(list(commands))
    client.send_commands = acknowledge_only
    with pytest.raises(ServiceError, match='requested torque state'):
        await operate(svc, 'gripper')
    # Only the current-position hold goal, before enabling a released motor, may be written.
    assert goal_steps(client.st3215_commands) == {8: 2048}


@pytest.mark.parametrize('operation,ids', [('gripper', {8}), ('move', set(range(1, 8))),
                                         ('hold', set(range(1, 9)))])
async def test_disabled_commanded_motors_get_safe_goals_before_enable(model, solver, operation, ids):
    svc, client = make_service(model, solver, frame_with_torque(set()))
    client.arrive_at_goals()
    await operate(svc, operation)
    assert goal_steps([client.st3215_commands[0]]) == dict.fromkeys(ids, 2048)
    assert client.st3215_commands[1].sync_write.address == R.ADDR_TORQUE_ENABLE
    assert torque_ids(client) == ids


@pytest.mark.parametrize('bad', ['processing', 'failed', 'partial', 'wrong_bus', 'wrong_value', 'old_mixed'])
def test_release_receipt_rejects_incomplete_or_unrelated_commands(bad):
    client = FakeStationClient(calibrated_frame())
    client.complete_stop('F1')
    assert torque_release_receipt(client.latest_frame, 'F1') is not None
    frame = st3215_pb2.InferenceState.FromString(client.latest_frame)
    last = frame.buses[0].motors[0].last_command
    if bad == 'processing':
        last.result = st3215_pb2.CR_PROCESSING
    elif bad == 'failed':
        last.result = st3215_pb2.CR_FAILED
    elif bad == 'partial':
        del last.command.sync_write.motors[-1]
    elif bad == 'wrong_bus':
        last.command.target_bus_serial = 'L1'
    elif bad == 'wrong_value':
        last.command.sync_write.motors[0].value = b'\x01'
    else:
        last.command.monotonic_stamp_ns -= 1
    assert torque_release_receipt(frame.SerializeToString(), 'F1') is None


@pytest.mark.parametrize('states,expected_stop', [
    (None, False),
    ([], False),
    ([make_mirroring_state()], False),
    ([make_mirroring_state(['X1'])], False),
    ([make_mirroring_state(['F1'])], True),
    ([make_mirroring_state(['F1']), make_mirroring_state()], False),
    ([make_mirroring_state(), make_mirroring_state(['F1'])], True),
])
async def test_gripper_mirroring_matrix(model, solver, states, expected_stop):
    queues = {} if states is None else {MIRRORING_QUEUE: states}
    svc, client = make_service(model, solver, calibrated_frame(), queues=queues)
    client.arrive_at_goals()
    out = await svc.set_gripper('F1', 0.2, speed=200, accel=10)
    assert out['motion']['status'] == 'reached'
    assert (1 in client.driver_types) is expected_stop
    commands = client.st3215_commands
    if expected_stop:
        assert commands[0].sync_write.address == 0x28  # restore the previously enabled motors
        assert {m.motor_id for m in commands[0].sync_write.motors} == set(range(1, 9))
        commands = commands[1:]
    assert all({m.motor_id for m in c.sync_write.motors} == {8} for c in commands)


@pytest.mark.parametrize('operation', ['move', 'gripper', 'torque'])
@pytest.mark.parametrize('code', ['timeout', 'disconnected', 'server_error'])
async def test_read_error_aborts_before_motor_writes(model, solver, operation, code):
    svc, client = make_service(model, solver, calibrated_frame())
    async def broken_read(*args):
        raise StationError(code, 'injected queue read failure')
    client.read_tail = broken_read
    with pytest.raises(ServiceError) as exc:
        if operation == 'move':
            await point(svc, 0.21, 0.05, 0.05, execute=True)
        elif operation == 'gripper':
            await svc.set_gripper('F1', 0.2, speed=200, accel=10)
        else:
            await svc.set_torque('F1', True)
    assert exc.value.status == 503
    assert exc.value.code == 'station_' + code
    assert client.sent == []


@pytest.mark.parametrize('mirrored', [False, True])
async def test_torque_release_succeeds_while_a_motor_flags_an_error(model, solver, mirrored):
    """Releasing torque is how an operator relieves an overloaded servo, so a set status register
    (overload, overheat) must not keep the release from being sent and confirmed."""
    svc, client = make_service(model, solver, calibrated_frame(status=0x20),
                               queues=mirroring_queues('F1') if mirrored else {})
    res = await svc.set_torque('F1', False)
    assert res == {'id': 'F1', 'torque_enabled': False}
    assert torque_ids(client) == set()
    assert (1 in client.driver_types) is mirrored


async def test_retry_waits_for_the_echo_of_a_stop_the_driver_still_holds(model, solver):
    """A second stop behind one the driver has not processed yet would torque the bus off again after
    the first stop's receipt let the retry restore torque and move. So a retry sends nothing and waits
    for the driver to echo the stop; the echo means its torque-off is queued ahead of the restoration."""
    initial = {1, 3, 8}
    svc, client = make_service(model, solver, frame_with_torque(initial), queues=mirroring_queues('F1'),
                               settings=Settings(**FAST, handoff_timeout_s=0.3))
    client.auto_stop = False  # the driver sits on the stop: no echo, no torque-off
    client.arrive_at_goals()
    with pytest.raises(ServiceError, match='torque-off was not confirmed'):
        await operate(svc, 'gripper')
    assert client.driver_types.count(1) == 1
    retry = asyncio.create_task(operate(svc, 'gripper'))
    await asyncio.sleep(0.04)
    assert not retry.done() and client.driver_types.count(1) == 1 and not client.st3215_commands
    client.detach_mirroring('F1')  # the driver gets to the stop and echoes it
    assert (await retry)['motion']['status'] == 'reached'
    assert client.driver_types.count(1) == 1
    assert torque_ids(client) == initial | {8}
    assert not svc._pending_handoffs


async def test_first_stop_echo_is_required_even_with_a_receipt(model, solver):
    """A receipt and off bits alone could come from someone else's stop; the handoff also needs the
    driver to have processed its own stop before it restores torque."""
    svc, client = make_service(model, solver, calibrated_frame(), queues=mirroring_queues('F1'))
    client.auto_stop = False
    client.arrive_at_goals()
    request = asyncio.create_task(operate(svc, 'gripper'))
    await until(lambda: 1 in client.driver_types)
    client.queues[MIRRORING_QUEUE].append(make_mirroring_state())  # mirroring gone, but not by our stop
    client.complete_stop('F1')
    await asyncio.sleep(0.04)
    assert not request.done() and not client.st3215_commands
    client.detach_mirroring('F1')
    await request
    assert torque_ids(client) == set(range(1, 9))


async def test_retry_sends_the_stop_when_its_write_was_never_acknowledged(model, solver):
    """An unacknowledged stop write is not recorded as written: nothing says it was queued, so the
    retry sends the stop, this time waiting for its receipt like a first attempt."""
    svc, client = make_service(model, solver, calibrated_frame(), queues=mirroring_queues('F1'))
    send = client.send_commands

    async def lose_stop_write(commands):
        if isinstance(commands[0], commands_pb2.DriverCommand):
            raise StationError('timeout', 'station did not acknowledge the command write')
        await send(commands)
    client.send_commands = lose_stop_write
    with pytest.raises(ServiceError, match='did not acknowledge') as e:
        await operate(svc, 'gripper')
    assert e.value.code == 'station_timeout'
    assert 'F1' in svc._pending_handoffs and not svc._pending_handoffs['F1'].stop_written
    client.send_commands = send
    client.arrive_at_goals()
    await operate(svc, 'gripper')
    assert client.driver_types.count(1) == 1
    assert torque_ids(client) == set(range(1, 9))
    assert not svc._pending_handoffs

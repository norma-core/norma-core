"""ArmService: preconditions, IK solving, and motion execution for one request."""
from __future__ import annotations

import asyncio
import logging
import math
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass

import numpy as np

from elrobot_ik.calibration.mapper import MotorMapper, clamp_to_arc, step_distance
from elrobot_ik.config import ACCEL_RANGE, SPEED_RANGE, Settings, clamp
from elrobot_ik.kinematics.ik import IKResult, IKSolver
from elrobot_ik.kinematics.model import ElrobotModel
from elrobot_ik.kinematics.transforms import rotation_to_rpy
from elrobot_ik.station.arms import ELROBOT_MOTOR_IDS, BusSnapshot, find_arm, role
from elrobot_ik.station.cameras import (
    FF_JPEG,
    FF_VP8,
    INFERENCE_STATES_QUEUE,
    MAX_CHAIN,
    CameraEntry,
    CameraFrame,
    CameraQueue,
    decode_vp8_chain,
    entry_id,
    entry_id_bytes,
    parse_camera_entry,
    parse_camera_queues,
)
from elrobot_ik.station.client import StationError
from elrobot_ik.station.commands import drive_commands, goal_command, mirroring_stop_command, torque_command
from elrobot_ik.station.mirroring import MIRRORING_QUEUE, mirroring_targets, stop_acknowledged, torque_release_receipt

log = logging.getLogger(__name__)

PATH_CHECK_MAX_STEPS = 10
PATH_CHECK_STEP_RAD = math.radians(5)  # one collision check per 5 deg of the largest joint move
ARC_MISMATCH_WARN_DEG = 10.0
LIMIT_EPS_RAD = 1e-4
CAMERA_LIST_TTL_S = 3.0
MIRRORING_PAGE = 64  # entries per read when counting the driver's stop echoes during a handoff


class ServiceError(Exception):
    def __init__(self, status: int, code: str, detail: str, **extra):
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail
        self.extra = extra


@dataclass
class MotionResult:
    status: str  # reached | stalled | timeout | unknown | not_executed
    # reached: every commanded motor within tolerance of its goal.
    # stalled: the servos stopped moving outside tolerance even after re-commanding
    #          by the residual (blocked, gripping something, or steady-state error under load).
    # timeout: still moving when the per-attempt deadline passed.
    # unknown: the goal was written but the service stopped watching before arrival could be
    #          confirmed: the station disconnected, stopped publishing state, lost the arm's bus,
    #          or a newer command for this arm took over (its goals replace these).
    # not_executed: nothing was written: a dry run, or a newer command for this arm arrived
    #          while this one was still waiting for the arm.
    duration_ms: int = 0

    def public(self) -> dict:
        return {"status": self.status, "duration_ms": self.duration_ms}


@dataclass
class PendingHandoff:
    restore_ids: tuple[int, ...]
    previous_receipt: bytes | None
    mirroring_id: int  # the newest inference/mirroring entry when the handoff began; the driver's echo comes after it
    stop_written: bool = False  # the station acknowledged writing the stop; the driver echoes it once processed
    released: bool = False


NOT_EXECUTED = MotionResult("not_executed")


@dataclass
class SolveOutcome:
    joint_angles_rad: list[float]
    motor_steps: list[int]  # empty for a dry run on an uncalibrated arm
    tcp_pose: np.ndarray
    motion: MotionResult

    @property
    def executed(self) -> bool:
        return self.motion.status != "not_executed"


def pose_dict(T: np.ndarray) -> dict:
    R = T[:3, :3]
    roll, pitch, yaw = rotation_to_rpy(R)
    return {
        "position": {"x": float(T[0, 3]), "y": float(T[1, 3]), "z": float(T[2, 3])},
        "rpy": {"roll": roll, "pitch": pitch, "yaw": yaw},
        # Direction the jaws open in (gripper X axis) about the vertical: 0 = along world X (forward),
        # positive = counter-clockwise seen from above.
        "rotation_deg": math.degrees(math.atan2(float(R[1, 0]), float(R[0, 0]))),
    }


class ArmService:
    def __init__(self, client, model: ElrobotModel, solver: IKSolver, mapper: MotorMapper, settings: Settings):
        self.client = client
        self.model = model
        self.solver = solver
        self.mapper = mapper
        self.settings = settings
        self._warned_arcs: set[tuple[str, int]] = set()
        self._arm_locks: dict[str, asyncio.Lock] = {}
        self._pending_handoffs: dict[str, PendingHandoff] = {}
        self._tickets: dict[str, int] = {}  # per arm: the ticket of the newest motion/torque request
        self._camera_cache: tuple[float, list[CameraQueue]] | None = None
        # The placo model is one mutable object: solves run in a worker thread under this lock
        # (so the event loop keeps serving the station link), and the loop-side fk waits for them.
        self._model_lock = asyncio.Lock()

    @classmethod
    def build(cls, client, settings: Settings, model: ElrobotModel | None = None) -> ArmService:
        """Production wiring: one model, its solver and the step mapper."""
        model = model or ElrobotModel()
        mapper = MotorMapper(model.joint_limits)
        return cls(client, model, IKSolver(model), mapper, settings)

    # -- station errors and freshness --------------------------------------

    @staticmethod
    def _station_error(e: StationError) -> ServiceError:
        if e.code == "not_found":
            return ServiceError(404, "not_found", e.detail)
        return ServiceError(503, f"station_{e.code}", e.detail)

    def _fresh_buses(self) -> list[BusSnapshot]:
        if not self.client.connected:
            raise ServiceError(503, "station_disconnected", f"station {self.settings.station_url} not connected")
        age = self.client.frame_age_ms()
        if age is None:
            raise ServiceError(503, "no_frame", "no motor state received from station yet")
        if age > self.settings.stale_after_ms:
            raise ServiceError(503, "stale_frame", f"latest motor state is {age:.0f} ms old", age_ms=age)
        return self.client.buses()

    def resolve(self, arm_id: str) -> BusSnapshot:
        buses = self._fresh_buses()
        bus = find_arm(buses, arm_id)
        if bus is None:
            raise ServiceError(404, "not_found", f"arm '{arm_id}' not on station", candidates=[b.serial for b in buses if b.is_elrobot])
        return bus

    # -- read-only views -----------------------------------------------------

    def health(self) -> dict:
        return {
            "status": "ok" if self.client.connected else "degraded",
            "station_url": self.settings.station_url,
            "station_connected": bool(self.client.connected),
            "last_frame_age_ms": self.client.frame_age_ms(),
        }

    async def list_arms(self) -> list[dict]:
        """Every ElRobot arm the station sees: role, calibration, torque, joints and tool point pose."""
        buses = self._fresh_buses()
        async with self._model_lock:
            return [self._arm(b) for b in buses if b.is_elrobot]

    def _arm(self, bus: BusSnapshot) -> dict:
        calibrated = self.mapper.is_calibrated(bus)
        angles = self._current_angles(bus) if calibrated else None
        return {
            "id": bus.serial,
            "role": role(bus),
            "calibrated": calibrated,
            "torque_enabled": all(m.torque_enabled for m in bus.motors),
            "pose": pose_dict(self.model.fk(angles)) if calibrated else None,
            "gripper": self._gripper_fraction(angles[7]) if calibrated else None,
            "joints": [
                {"motor": motor_id, "angle_rad": angles[i] if calibrated else None, "steps": bus.motor(motor_id).steps}
                for i, motor_id in enumerate(ELROBOT_MOTOR_IDS)
            ],
        }

    # -- calibration preconditions ----------------------------------------------

    def _require_calibrated(self, bus: BusSnapshot) -> None:
        uncal = self.mapper.uncalibrated_motors(bus)
        if uncal:
            raise ServiceError(409, "not_calibrated", f"arm {bus.serial} is not calibrated", motors=uncal)

    def _require_movable(self, bus: BusSnapshot) -> None:
        """Calibrated and no motor reporting an error: the preconditions of every motion."""
        self._require_calibrated(bus)
        errored = [m for m in bus.motors if m.error]
        if errored:
            raise ServiceError(409, "motor_error", "motors report error flags",
                               motors=[m.id for m in errored], details={m.id: m.error_detail for m in errored})

    def _current_angles(self, bus: BusSnapshot) -> list[float]:
        self._require_calibrated(bus)
        for i, motor_id in enumerate(ELROBOT_MOTOR_IDS):
            mismatch = self.mapper.arc_mismatch_deg(i, bus.motor(motor_id))
            key = (bus.serial, motor_id)
            if abs(mismatch) > ARC_MISMATCH_WARN_DEG and key not in self._warned_arcs:
                self._warned_arcs.add(key)
                log.warning("arm %s motor %d: calibrated arc differs from URDF range by %.1f deg", bus.serial, motor_id, mismatch)
        return self.mapper.bus_angles(bus)

    # -- gripper -----------------------------------------------------------------

    def _gripper_fraction(self, angle: float) -> float:
        """0 = closed (URDF upper limit), 1 = open (URDF 0 rad)."""
        lim = self.mapper.limits[7]
        return min(1.0, max(0.0, (lim.upper - angle) / lim.span))

    def _gripper_angle(self, fraction: float) -> float:
        """The single validator of the 0..1 gripper rule, for every transport."""
        if not 0.0 <= fraction <= 1.0:
            raise ServiceError(422, "invalid_gripper", "gripper opening must be between 0 (closed) and 1 (open)")
        lim = self.mapper.limits[7]
        return lim.upper - fraction * lim.span

    # -- cameras ---------------------------------------------------------------------

    async def _camera_queues(self, *, refresh: bool = False) -> list[CameraQueue]:
        now = time.monotonic()
        if not refresh and self._camera_cache and now - self._camera_cache[0] < CAMERA_LIST_TTL_S:
            return self._camera_cache[1]
        try:
            entries = await self.client.read_tail(INFERENCE_STATES_QUEUE, 1)
        except StationError as e:
            raise self._station_error(e) from e
        cams = parse_camera_queues(entries[-1][1]) if entries else []
        self._camera_cache = (now, cams)
        return cams

    async def _latest_entry(self, queue: str) -> tuple[bytes, CameraEntry] | None:
        """The newest frame entry of a camera queue as (entry id, entry), or None when its recent entries hold no frame."""
        for n in (1, 3):  # the newest entry is almost always a frame; look further only for device events
            try:
                entries = await self.client.read_tail(queue, n)
            except StationError as e:
                if e.code == "not_found":
                    return None
                raise self._station_error(e) from e
            for id_, data in reversed(entries):
                if (entry := self._parse_entry(data)) is not None:
                    return id_, entry
            if len(entries) < n:
                return None
        return None

    @staticmethod
    def _parse_entry(data: bytes) -> CameraEntry | None:
        try:
            return parse_camera_entry(data)
        except ValueError as e:
            raise ServiceError(415, "unsupported_codec", str(e)) from e

    async def _latest_frame(self, queue: str) -> CameraFrame | None:
        """The newest frame of a camera queue as a JPEG, decoding a VP8 chain when the station stores VP8."""
        latest = await self._latest_entry(queue)
        if latest is None:
            return None
        id_, entry = latest
        if entry.kind == FF_JPEG:
            jpeg, width, height = entry.data, entry.width, entry.height
        else:
            jpeg, width, height = await self._decode_vp8(queue, id_, entry)
        return CameraFrame(jpeg, width, height, entry.camera_name, entry.camera_unique_id, entry.stamp_ns)

    async def _decode_vp8(self, queue: str, id_: bytes, entry: CameraEntry) -> tuple[bytes, int, int]:
        """Read the VP8 chain from its keyframe entry to `id_` and decode it to the picture at `id_`."""
        keyframe = entry.keyframe_id(id_)
        last = entry_id(id_)
        if keyframe is None or keyframe > last or last - keyframe >= MAX_CHAIN:
            raise ServiceError(503, "no_frame", f"camera frame {last} names no usable keyframe (chain start {keyframe})")
        try:
            chain = await self.client.read_from(queue, entry_id_bytes(keyframe), last - keyframe + 1)
        except StationError as e:
            raise self._station_error(e) from e
        packets = []
        expected = keyframe
        for raw_id, data in chain:
            if entry_id(raw_id) != expected:
                raise ServiceError(503, "no_frame", f"camera chain {keyframe}..{last} has a gap at entry {expected}")
            expected += 1
            member = self._parse_entry(data)
            if member is None:
                continue  # a device event inside the chain carries no frame
            if member.kind != FF_VP8 or member.keyframe_id(raw_id) != keyframe:
                raise ServiceError(503, "no_frame", f"camera chain {keyframe}..{last} holds a frame of another chain at entry {expected - 1}")
            packets.append(member.data)
        if expected != last + 1:
            raise ServiceError(503, "no_frame", f"camera chain {keyframe}..{last} is not fully stored yet")
        try:
            return await asyncio.to_thread(decode_vp8_chain, packets)
        except ValueError as e:
            raise ServiceError(503, "no_frame", str(e)) from e

    async def list_cameras(self) -> list[dict]:
        """Cameras the station is streaming, with the id to use in `camera_image`."""
        queues = await self._camera_queues()
        latest = await asyncio.gather(*(self._latest_entry(cq.queue) for cq in queues))
        frames = [e for _, e in (x or (None, None) for x in latest)]
        return [
            {"id": cq.id, "name": f.camera_name if f else "", "unique_id": f.camera_unique_id if f else "",
             "width": f.width if f else 0, "height": f.height if f else 0}
            for cq, f in zip(queues, frames)
        ]

    async def camera_image(self, camera_id: str) -> tuple[bytes, dict]:
        """(JPEG bytes, metadata) of the latest frame from one camera."""
        cams = await self._camera_queues()
        match = next((c for c in cams if c.id == camera_id), None)
        if match is None:  # a camera may have appeared since the cached listing: look again before refusing
            cams = await self._camera_queues(refresh=True)
            match = next((c for c in cams if c.id == camera_id), None)
        if match is None:
            raise ServiceError(404, "not_found", f"camera '{camera_id}' not on station", candidates=[c.id for c in cams])
        frame = await self._latest_frame(match.queue)
        if frame is None:
            raise ServiceError(503, "no_frame", f"camera '{camera_id}' has not published a frame yet")
        return frame.jpeg, {"id": camera_id, "name": frame.camera_name, "unique_id": frame.camera_unique_id,
                            "width": frame.width, "height": frame.height, "stamp_ns": frame.stamp_ns}

    # -- motion --------------------------------------------------------------------

    async def move_to(self, arm_id, T_world_tcp, *, gripper, execute, speed, accel) -> SolveOutcome:
        T = np.asarray(T_world_tcp, dtype=float)
        return await self._solve(arm_id, lambda seed: self.solver.solve_pose(T, seed, accept=self._collision_free),
                                 gripper=gripper, execute=execute, speed=speed, accel=accel)

    async def set_gripper(self, arm_id: str, open_fraction: float, *, speed, accel) -> dict:
        """Open (1.0) or close (0.0) the jaws without moving the arm."""
        angle = self._gripper_angle(open_fraction)
        bus = self.resolve(arm_id)
        self._require_movable(bus)
        steps = self.mapper.angle_to_steps(7, angle, bus.motor(8))
        async with self._exclusive(bus.serial) as ticket:
            motion = await self._execute(bus, {8: steps}, speed, accel, ticket)
        return {"id": bus.serial, "gripper": open_fraction, "motion": motion.public()}

    async def set_torque(self, arm_id: str, enabled: bool) -> dict:
        bus = self.resolve(arm_id)
        async with self._exclusive(bus.serial):
            await self._release_from_mirroring(bus.serial, restore=enabled)
            if enabled:
                await self._prepare_torque_on(self.resolve(bus.serial), ELROBOT_MOTOR_IDS)
            await self._send([torque_command(bus.serial, ELROBOT_MOTOR_IDS, enabled)])
            await self._wait_torque(bus.serial, ELROBOT_MOTOR_IDS, enabled)
        return {"id": bus.serial, "torque_enabled": enabled}

    # -- motion internals ----------------------------------------------------------

    def _collision_free(self, angles: list[float]) -> bool:
        """IK restart filter: reject solutions that collide at the target itself."""
        return not self.model.collisions(angles).any

    @asynccontextmanager
    async def _exclusive(self, serial: str) -> AsyncIterator[int]:
        """Serialize motion and torque requests per arm; the newest request wins.

        Every request takes a ticket. A motion in flight stops waiting as soon as a newer ticket
        exists (it reports `unknown`: the service no longer watches it), and a queued request whose
        ticket is already stale returns `not_executed` without driving the arm, so only the latest
        goals are written.
        """
        lock = self._arm_locks.setdefault(serial, asyncio.Lock())
        self._tickets[serial] = ticket = self._tickets.get(serial, 0) + 1
        async with lock:
            yield ticket

    def _superseded(self, serial: str, ticket: int) -> bool:
        return self._tickets.get(serial) != ticket

    def _seed(self, bus: BusSnapshot, gripper: float | None, calibrated: bool) -> list[float]:
        # Uncalibrated arms can still get a dry-run solve from the home pose.
        seed = self._current_angles(bus) if calibrated else [0.0] * 7 + [self.mapper.limits[7].lower]
        if gripper is not None:
            seed[7] = self._gripper_angle(gripper)
        return seed

    async def _solve(self, arm_id: str, solve: Callable[[list[float]], IKResult], *, gripper, execute, speed, accel) -> SolveOutcome:
        bus = self.resolve(arm_id)
        calibrated = self.mapper.is_calibrated(bus)
        seed = self._seed(bus, gripper, calibrated)
        async with self._model_lock:
            res, tcp_pose = await asyncio.to_thread(self._solve_and_check, solve, seed, calibrated)
        motor_steps = self.mapper.angles_to_steps(res.angles, bus) if calibrated else []
        outcome = SolveOutcome(list(res.angles), motor_steps, tcp_pose, NOT_EXECUTED)
        if not execute:
            return outcome
        self._require_movable(bus)
        goals = dict(zip(ELROBOT_MOTOR_IDS, motor_steps))
        if gripper is None:
            # "Omitted keeps the current opening": leave the gripper servo's goal alone. Re-writing its
            # present position as the goal would cancel the squeeze on anything the jaws are holding.
            del goals[8]
        async with self._exclusive(bus.serial) as ticket:
            outcome.motion = await self._execute(bus, goals, speed, accel, ticket)
        return outcome

    def _solve_and_check(self, solve: Callable[[list[float]], IKResult], seed: list[float], calibrated: bool) -> tuple[IKResult, np.ndarray]:
        """The CPU-bound part of a request (IK restarts plus collision checks), run off the event loop."""
        res = solve(seed)
        if not res.reachable:
            raise ServiceError(422, "unreachable", "target is out of reach or violates joint limits",
                               position_error=res.position_error, angle_error=res.angle_error)
        self._validate_solution(res, start=seed if calibrated else res.angles)
        return res, self.model.fk(res.angles)

    def _validate_solution(self, res: IKResult, start: list[float]) -> None:
        """Limits (belt and braces: the solver enforces them), collision at the target, then along the path."""
        violations = [(lim.name, a) for a, lim in zip(res.angles, self.mapper.limits)
                      if a < lim.lower - LIMIT_EPS_RAD or a > lim.upper + LIMIT_EPS_RAD]
        if violations:
            # A clamped goal would be a configuration the collision check never saw.
            raise ServiceError(500, "limit_violation", "solver returned angles outside joint limits", joints=violations)
        if not res.accepted:  # the solver's accept filter already cleared the target otherwise
            at_target = self.model.collisions(res.angles)
            if at_target.any:
                raise ServiceError(422, "collision", "solution collides with the robot or the table at the target",
                                   self_pairs=at_target.self_pairs, table_pairs=at_target.table_pairs)
        self_pairs, table_pairs = self._check_path(start, res.angles)
        if self_pairs or table_pairs:
            raise ServiceError(422, "collision", "the path to the target collides with the robot or the table",
                               self_pairs=self_pairs, table_pairs=table_pairs)

    def _check_path(self, start, target) -> tuple[list, list]:
        """Collision pairs that appear along the straight joint-space path, excluding pairs already
        in contact at the start pose: a resting arm often has touching brackets, and moving away from
        that is not a collision caused by the motion. Sampled every 5 deg of the largest joint move."""
        a, b = np.asarray(start, dtype=float), np.asarray(target, dtype=float)
        at_start = self.model.collisions(list(a))
        known = {frozenset(p) for p in at_start.self_pairs + at_start.table_pairs}
        steps = int(clamp(math.ceil(float(np.max(np.abs(b - a))) / PATH_CHECK_STEP_RAD), 1, PATH_CHECK_MAX_STEPS))
        found: dict[str, list] = {"self": [], "table": []}
        for k in range(1, steps + 1):
            rep = self.model.collisions(list(a + (b - a) * (k / steps)))
            for kind, pairs in (("self", rep.self_pairs), ("table", rep.table_pairs)):
                found[kind].extend(p for p in pairs if frozenset(p) not in known and p not in found[kind])
        return found["self"], found["table"]

    async def _mirroring_state(self) -> tuple[int, bytes] | None:
        """The newest `inference/mirroring` entry as (entry id, data); None when the driver never
        published, which means nothing is mirrored."""
        try:
            entries = await self.client.read_tail(MIRRORING_QUEUE, 1)
        except StationError as e:
            if e.code == "not_found":
                return None
            raise self._station_error(e) from e
        if not entries:
            return None
        entry_id, data = entries[-1]
        return int.from_bytes(entry_id, "little"), data

    async def _handoff_progress(self, serial: str, pending: PendingHandoff) -> tuple[bool, bool]:
        """Whether the mirroring driver has processed the handoff's stop, and whether the bus is still a
        target. The driver echoes every command it processes into `inference/mirroring`, so an entry
        written since the handoff began carrying our stop says it was processed, and the newest entry
        says what it mirrors now."""
        echoed, newest, first_id = False, None, pending.mirroring_id
        while True:
            try:
                page = await self.client.read_from(MIRRORING_QUEUE, first_id.to_bytes(8, "little"), MIRRORING_PAGE)
            except StationError as e:
                if e.code == "not_found":
                    raise ServiceError(503, "no_frame", "mirroring state disappeared during handoff") from e
                raise self._station_error(e) from e
            for eid, data in page:
                if int.from_bytes(eid, "little") > pending.mirroring_id and stop_acknowledged(data, serial):
                    echoed = True
                newest = data
            if len(page) < MIRRORING_PAGE:
                break
            first_id = int.from_bytes(page[-1][0], "little") + 1
        if newest is None:
            raise ServiceError(503, "no_frame", "mirroring state disappeared during handoff")
        return echoed, serial in mirroring_targets(newest)

    async def _release_from_mirroring(self, serial: str, *, restore: bool = True) -> None:
        """Stop only active mirroring; finish its asynchronous torque-off before restoring torque.

        Keep an unfinished handoff across failures so a retry cannot skip its pending torque-off
        just because mirroring is already absent. This is not a persistent control session.
        """
        first = serial not in self._pending_handoffs
        if first:
            newest = await self._mirroring_state()
            if newest is None or serial not in mirroring_targets(newest[1]):
                return
            bus = self.resolve(serial)
            self._pending_handoffs[serial] = PendingHandoff(
                tuple(m.id for m in bus.motors if m.torque_enabled),
                torque_release_receipt(self.client.latest_frame, serial),
                mirroring_id=newest[0],
            )
        # A disconnected HTTP caller must not cancel restoration halfway through the handoff.
        task = asyncio.create_task(self._finish_handoff(serial, restore=restore))
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            try:
                await task
            except ServiceError:
                log.exception("Mirroring handoff unfinished for %s after caller cancellation", serial)
            raise
        if not first:
            # A retry recovered an earlier handoff. Mirroring might have been restarted since
            # that stop completed, so apply the normal movement-triggered check once more.
            await self._release_from_mirroring(serial, restore=restore)

    async def _finish_handoff(self, serial: str, *, restore: bool) -> None:
        pending = self._pending_handoffs[serial]
        try:
            async with asyncio.timeout(self.settings.handoff_timeout_s):
                # One stop per handoff. A retry sends it only when no earlier write of it was acknowledged;
                # a stop the station holds is waited for, never doubled: a second one would torque the bus
                # off again after the restoration below.
                sent_now = not pending.released and not pending.stop_written
                if sent_now:
                    await self._send_stop(serial, pending)
                while not pending.released:
                    if await self._stop_landed(serial, pending, need_receipt=sent_now):
                        pending.released = True
                        break
                    await asyncio.sleep(0.02)
        except TimeoutError:
            raise ServiceError(503, "station_timeout",
                               "mirroring stop's torque-off was not confirmed; no movement sent; "
                               "torque may be released, check the arm before retrying") from None
        if restore and pending.restore_ids:
            # Preserve existing goals, including a gripper's squeeze on an object.
            await self._send([torque_command(serial, pending.restore_ids, True)])
            await self._wait_torque(serial, pending.restore_ids, True)
        del self._pending_handoffs[serial]

    async def _send_stop(self, serial: str, pending: PendingHandoff) -> None:
        await self._send([mirroring_stop_command(serial)])
        # Recorded only once the station acknowledged the write: one it did not acknowledge may or may
        # not be queued, and a retry sends it again (its echo, if it was, still counts).
        pending.stop_written = True

    async def _stop_landed(self, serial: str, pending: PendingHandoff, *, need_receipt: bool) -> bool:
        """Whether the handoff's whole-bus torque-off is behind us: the driver has processed the stop and
        the bus is no longer a target. The driver echoes the stop a moment before it enqueues the
        torque-off, so right after sending the stop that is not enough: a torque-off receipt newer than
        the one seen before the stop, with every motor reading torque off, shows it landed. On a retry the
        stop was written a whole handoff timeout ago; once echoed, its torque-off sits in the station's
        command queue ahead of anything sent from here (each bus is driven in order), so the echo
        suffices. Error flags are not a reason to wait: motion refuses them up front, and a torque
        release is how an overloaded servo gets relieved."""
        if need_receipt:
            bus = self.resolve(serial)
            receipt = torque_release_receipt(self.client.latest_frame, serial)
            if receipt is None or receipt == pending.previous_receipt or any(m.torque_enabled for m in bus.motors):
                return False
        echoed, target = await self._handoff_progress(serial, pending)
        return echoed and not target

    async def _wait_torque(self, serial: str, motor_ids, enabled: bool) -> None:
        deadline = time.monotonic() + self.settings.handoff_timeout_s
        while time.monotonic() < deadline:
            bus = self.resolve(serial)
            motors = [bus.motor(i) for i in motor_ids]
            if all(m is not None and m.torque_enabled == enabled for m in motors):
                return
            await asyncio.sleep(0.02)
        raise ServiceError(503, "station_timeout", "station did not confirm requested torque state",
                           motors=list(motor_ids), torque_enabled=enabled)

    async def _prepare_torque_on(self, bus: BusSnapshot, motor_ids) -> None:
        """Only newly enabled, commanded motors get a hold goal before torque is applied."""
        hold = {m.id: m.steps for m in bus.motors if m.id in motor_ids and not m.torque_enabled}
        if hold:
            await self._send([goal_command(bus.serial, hold)])

    async def _send(self, commands) -> None:
        try:
            await self.client.send_commands(commands)
        except StationError as e:
            raise self._station_error(e) from e

    async def _execute(self, bus: BusSnapshot, goals: dict[int, int], speed, accel, ticket: int) -> MotionResult:
        """Drive the motors in `goals` (motor id -> steps); others are left alone."""
        if self._superseded(bus.serial, ticket):  # a newer command arrived while queued: never drive stale goals
            return NOT_EXECUTED
        speed = clamp(self.settings.motion_speed if speed is None else int(speed), *SPEED_RANGE)
        accel = clamp(self.settings.motion_accel if accel is None else int(accel), *ACCEL_RANGE)
        t0 = time.monotonic()
        await self._release_from_mirroring(bus.serial)
        if self._superseded(bus.serial, ticket):
            return NOT_EXECUTED
        await self._prepare_torque_on(self.resolve(bus.serial), goals)
        # Torque, speed and accel in one write, then the goals.
        *setup, goal = drive_commands(bus.serial, goals, speed, accel)
        await self._send(setup)
        await self._wait_torque(bus.serial, goals, True)
        if self._superseded(bus.serial, ticket):
            return NOT_EXECUTED

        commanded = dict(goals)
        final = bus.steps()
        for attempt in range(self.settings.max_nudges + 1):
            await self._send([goal if attempt == 0 else goal_command(bus.serial, commanded)])
            status, final = await self._wait_settled(bus.serial, goals, final, ticket)
            if status != "settled":
                return MotionResult(status, int((time.monotonic() - t0) * 1000))
            # P-only servos stop short under load; push each goal by its residual and retry.
            commanded = {i: clamp_to_arc(commanded[i] + (goals[i] - final[k]), bus.motor(i).range_min, bus.motor(i).range_max)
                         for k, i in enumerate(ELROBOT_MOTOR_IDS) if i in commanded and final[k] >= 0}
        return MotionResult("stalled", int((time.monotonic() - t0) * 1000))

    async def _wait_settled(self, serial: str, goals: dict[int, int], last: list[int], ticket: int) -> tuple[str, list[int]]:
        """Poll until reached, settled (stopped short), timeout (still moving) or unknown.

        Arrival is judged on the commanded motors only (a gripper command sent mid-move must not
        be marked stalled because the arm is still travelling); settling looks at every motor,
        so the call returns once the whole arm is still.
        """
        tol = self.settings.arrival_tolerance_steps
        t0 = time.monotonic()
        deadline = t0 + self.settings.motion_timeout_s
        stable_since = t0
        final = list(last)
        while True:
            if self._superseded(serial, ticket):  # a newer command took over: stop watching, its goals win
                return "unknown", final
            age = self.client.frame_age_ms()
            if not self.client.connected or age is None or age > self.settings.stale_after_ms:
                return "unknown", final
            latest = find_arm(self.client.buses(), serial)
            if latest is None:  # the bus dropped off the station (USB unplugged): arrival can no longer be judged
                return "unknown", final
            now_steps = latest.steps()
            if any(step_distance(a, b) > self.settings.settle_jitter_steps for a, b in zip(now_steps, final)):
                stable_since = time.monotonic()
            final = now_steps
            if all(step_distance(final[k], goals[i]) <= tol for k, i in enumerate(ELROBOT_MOTOR_IDS) if i in goals):
                return "reached", final
            if time.monotonic() - stable_since >= self.settings.settle_window_s:
                return "settled", final
            if time.monotonic() >= deadline:
                return "timeout", final
            await asyncio.sleep(0.02)

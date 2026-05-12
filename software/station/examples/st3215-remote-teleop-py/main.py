"""Remote teleop: mirror leader bus motor positions onto a follower bus.

The leader and follower buses can live on different stations (true remote
teleop) or on the same station (local mirroring).

Usage:
    uv run python main.py \
        --leader-server ab-rpi5.server  --leader-bus auto \
        --follower-server ab-rpi5.server --follower-bus auto

Pass "auto" for a bus serial when the station has exactly one bus.
"""

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

# Add repo root so the generated protobuf and station_py imports resolve.
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from software.station.shared.station_py import new_station_client
from target.gen_python.protobuf.drivers.st3215 import st3215

from config import MAX_DATA_AGE_NS, MotorConfig, TELEOP_REFRESH_INTERVAL_S
from commands import send_motor_commands, set_torque
from mirror import ProtectionTable, compute_motor_command
from state import find_bus, parse_motor_state, resolve_bus_serial

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
logger = logging.getLogger(__name__)

# Warn at most once per second while a bus or its data is missing/stale,
# instead of spamming every tick.
WARN_INTERVAL_S = 1.0


class BusReader:
    """Subscribes to one station's st3215/inference and keeps the latest frame.

    The follower task reads from `latest` whenever its tick fires; this task
    just keeps draining the queue so we never fall behind.
    """

    def __init__(self, client, label: str):
        self.client = client
        self.label = label
        self.latest: st3215.InferenceStateReader | None = None
        self.latest_stamp_ns: int = 0
        self.frame_count: int = 0
        self._last_entry_id: bytes = b""
        self._queue: asyncio.Queue = asyncio.Queue()
        self._error_queue = client.follow("st3215/inference", self._queue)

    async def run(self):
        while True:
            if not self._error_queue.empty():
                err = self._error_queue.get_nowait()
                raise RuntimeError(f"[{self.label}] inference stream error: {err}")
            entry = await self._queue.get()
            if entry is None:
                raise RuntimeError(f"[{self.label}] inference stream closed")
            entry_id = bytes(entry.ID.ID)
            if entry_id == self._last_entry_id:
                continue
            self._last_entry_id = entry_id
            try:
                self.latest = st3215.InferenceStateReader(entry.Data)
                self.latest_stamp_ns = time.monotonic_ns()
                self.frame_count += 1
            except Exception:
                logger.exception("[%s] failed to decode inference frame", self.label)


async def _wait_for_first_frame(reader: BusReader, timeout_s: float = 10.0):
    deadline = time.monotonic() + timeout_s
    while reader.latest is None:
        if time.monotonic() > deadline:
            raise RuntimeError(f"[{reader.label}] no inference frames after {timeout_s}s")
        await asyncio.sleep(0.05)


class _Throttle:
    """Emit a callback at most once per `interval` seconds."""

    def __init__(self, interval: float = WARN_INTERVAL_S):
        self.interval = interval
        self._last = 0.0

    def ready(self) -> bool:
        now = time.monotonic()
        if now - self._last >= self.interval:
            self._last = now
            return True
        return False


STATS_INTERVAL_S = 1.0


class LatencyBucket:
    """Per-bus accumulator: frame age samples + frame count delta over a window.

    `record_if_new` only adds a sample when the frame index has advanced since
    the last observation, so a stale stream contributes 0 samples to age stats
    instead of 50 duplicate measurements of the same old frame.
    """

    def __init__(self, label: str):
        self.label = label
        self._samples_us: list[int] = []
        self._frames_at_window_start: int = 0
        self._last_seen_frame_count: int = 0

    def reset(self, frame_count_now: int) -> None:
        self._samples_us.clear()
        self._frames_at_window_start = frame_count_now
        self._last_seen_frame_count = frame_count_now

    def record_if_new(self, frame_count_now: int, age_ns: int) -> bool:
        if frame_count_now == self._last_seen_frame_count:
            return False
        self._last_seen_frame_count = frame_count_now
        self._samples_us.append(age_ns // 1000)
        return True

    def report(self, frame_count_now: int, window_s: float) -> str:
        n = len(self._samples_us)
        delta = frame_count_now - self._frames_at_window_start
        freq = delta / window_s
        if n == 0:
            return f"{self.label}: freq={freq:.1f} Hz (no new frames)"
        avg_us = sum(self._samples_us) / n
        return (
            f"{self.label}: freq={freq:.1f} Hz "
            f"age avg={avg_us/1000:.1f}ms "
            f"min={min(self._samples_us)/1000:.1f}ms "
            f"max={max(self._samples_us)/1000:.1f}ms"
        )


async def teleop_loop(
    leader: BusReader,
    leader_bus_serial: str,
    follower: BusReader,
    follower_bus_serial: str,
    follower_client,
    config: MotorConfig,
):
    """Read latest leader state, compute follower commands, send them. Repeat.

    The loop tolerates transient gaps: a missing bus or stale frame just causes
    the tick to be skipped, with a throttled warning so we don't flood the log.
    """
    protection = ProtectionTable()
    warn_stale = _Throttle()
    warn_missing_leader = _Throttle()
    warn_missing_follower = _Throttle()
    warn_no_motors = _Throttle()

    leader_stats = LatencyBucket(leader.label)
    follower_stats = LatencyBucket(follower.label)
    stats_emit = _Throttle(STATS_INTERVAL_S)
    last_stats_t = time.monotonic()
    leader_stats.reset(leader.frame_count)
    follower_stats.reset(follower.frame_count)

    while True:
        tick_start = time.monotonic()

        try:
            now_ns = time.monotonic_ns()

            if leader.latest is not None:
                leader_stats.record_if_new(
                    leader.frame_count, now_ns - leader.latest_stamp_ns,
                )
            if follower.latest is not None:
                follower_stats.record_if_new(
                    follower.frame_count, now_ns - follower.latest_stamp_ns,
                )

            if stats_emit.ready():
                window_s = time.monotonic() - last_stats_t
                last_stats_t = time.monotonic()
                logger.info(leader_stats.report(leader.frame_count, window_s))
                logger.info(follower_stats.report(follower.frame_count, window_s))
                leader_stats.reset(leader.frame_count)
                follower_stats.reset(follower.frame_count)

            if leader.latest is None or follower.latest is None:
                pass  # reader hasn't latched a frame yet
            elif (
                now_ns - leader.latest_stamp_ns > MAX_DATA_AGE_NS
                or now_ns - follower.latest_stamp_ns > MAX_DATA_AGE_NS
            ):
                if warn_stale.ready():
                    logger.warning(
                        "stale inference data: leader=%.0fms follower=%.0fms",
                        (now_ns - leader.latest_stamp_ns) / 1e6,
                        (now_ns - follower.latest_stamp_ns) / 1e6,
                    )
            else:
                leader_bus = find_bus(leader.latest, leader_bus_serial)
                follower_bus = find_bus(follower.latest, follower_bus_serial)

                if leader_bus is None:
                    if warn_missing_leader.ready():
                        logger.warning("leader bus '%s' not in latest frame", leader_bus_serial)
                elif follower_bus is None:
                    if warn_missing_follower.ready():
                        logger.warning("follower bus '%s' not in latest frame", follower_bus_serial)
                else:
                    cmds = _compute_tick_commands(
                        leader_bus, follower_bus, protection, config,
                    )
                    if cmds:
                        await send_motor_commands(follower_client, follower_bus_serial, cmds)
                    elif not (follower_bus.get_motors() or []):
                        if warn_no_motors.ready():
                            logger.warning("follower bus '%s' has no motors", follower_bus_serial)

        except Exception:
            logger.exception("teleop tick failed (continuing)")

        elapsed = time.monotonic() - tick_start
        sleep_for = TELEOP_REFRESH_INTERVAL_S - elapsed
        if sleep_for > 0:
            await asyncio.sleep(sleep_for)
        elif elapsed > TELEOP_REFRESH_INTERVAL_S * 2:
            logger.warning("tick took %.1fms", elapsed * 1000)


def _compute_tick_commands(leader_bus, follower_bus, protection, config):
    follower_motors = {
        m.get_id(): parse_motor_state(m)
        for m in (follower_bus.get_motors() or [])
    }

    cmds = []
    for leader_motor in leader_bus.get_motors() or []:
        motor_id = leader_motor.get_id()
        follower_state = follower_motors.get(motor_id)
        if follower_state is None:
            continue
        leader_state = parse_motor_state(leader_motor)
        cmd = compute_motor_command(
            motor_id, leader_state, follower_state,
            protection.get(motor_id), config,
        )
        if cmd is not None:
            cmds.append(cmd)
    return cmds


async def main_async(args):
    leader_client = await new_station_client(args.leader_server, logger)
    if args.follower_server == args.leader_server:
        follower_client = leader_client
    else:
        follower_client = await new_station_client(args.follower_server, logger)

    leader = BusReader(leader_client, label=f"leader@{args.leader_server}")
    follower = BusReader(follower_client, label=f"follower@{args.follower_server}")

    leader_task = asyncio.create_task(leader.run())
    follower_task = asyncio.create_task(follower.run())

    # Need a first frame from each reader so we can resolve "auto" and learn
    # which motor ids exist on the follower.
    await _wait_for_first_frame(leader)
    await _wait_for_first_frame(follower)

    leader_serial = resolve_bus_serial(leader.latest, args.leader_bus)
    follower_serial = resolve_bus_serial(follower.latest, args.follower_bus)

    follower_bus = find_bus(follower.latest, follower_serial)
    follower_motor_ids = (
        [m.get_id() for m in (follower_bus.get_motors() or [])]
        if follower_bus else []
    )
    if not follower_motor_ids:
        raise RuntimeError(f"Follower bus '{follower_serial}' has no motors")

    logger.info(
        "Teleop starting: leader=%s/%s -> follower=%s/%s, motors=%s",
        args.leader_server, leader_serial,
        args.follower_server, follower_serial,
        follower_motor_ids,
    )

    config = MotorConfig()

    await set_torque(follower_client, follower_serial, follower_motor_ids, enable=True)

    loop_task = asyncio.create_task(teleop_loop(
        leader, leader_serial,
        follower, follower_serial,
        follower_client, config,
    ))

    try:
        # Whichever task fails first surfaces here; .result() re-raises.
        done, _ = await asyncio.wait(
            {leader_task, follower_task, loop_task},
            return_when=asyncio.FIRST_EXCEPTION,
        )
        for t in done:
            t.result()
    except KeyboardInterrupt:
        logger.info("Interrupted, shutting down")
    finally:
        for t in (leader_task, follower_task, loop_task):
            t.cancel()
        try:
            await set_torque(
                follower_client, follower_serial, follower_motor_ids, enable=False,
            )
            logger.info("Follower torque disabled")
        except Exception:
            logger.exception("Failed to disable follower torque on shutdown")


def main():
    parser = argparse.ArgumentParser(description="ST3215 teleop (leader -> follower)")
    parser.add_argument("--leader-server", required=True, help="Station address for the leader bus")
    parser.add_argument("--leader-bus", default="auto", help='Leader bus serial, or "auto" for single-bus station')
    parser.add_argument("--follower-server", required=True, help="Station address for the follower bus")
    parser.add_argument("--follower-bus", default="auto", help='Follower bus serial, or "auto" for single-bus station')
    args = parser.parse_args()

    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

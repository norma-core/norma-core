"""arm2dog: bridge specific ST3215 leader-arm joints onto specific Dogzilla
follower-arm joints, across two stations.

The leader (Elrobot, ST3215 bus) and follower (robot dog's arm/gripper) speak
completely different protocols -- the dog's arm is not an ST3215 bus, it's
driven through the `yahboom-dogzilla-lite` driver's own servo registers
(ids 51/52/53, raw 0x00-0xFF each, no calibration, no current telemetry).
See `mirror.compute_follower_command` for how a leader's calibrated-arc
percentage gets projected onto that raw range, and `config.FollowerConfig`
for why a step-rate limiter stands in for ST3215-style overload protection
here.

Leader and follower motor ids are explicitly paired (they don't need to
match). Only `--map`-mapped servo ids plus `config.FOLLOWER_HOME_POSITIONS`
(51/52/53, written unconditionally at startup regardless of `--map` -- see
below) are ever written to; other servos on the follower (e.g. the dog's
legs) are never touched.

Beyond arm-joint mirroring, two optional rate-controlled movement axes can
be driven the same way -- a leader motor's deviation from its resting
position picks a direction (see `mirror.compute_axis_command`):
  - `--yaw-leader-id`: rotate in place (move_yaw), matches the web UI's Q/E.
  - `--fwd-leader-id`: forward/backward (move_x), matches the web UI's W/S.
Both share one `MovementCommand` register triple on the wire, so whenever
either changes, both axes' current values are sent together (see
`commands.send_follower_commands`).

Before live tracking starts, `startup.py` runs a pre-flight sequence: all
three of the follower's arm servos are ramped (not jumped) to a known-safe
home pose (unconditionally, not just whichever are mapped this session),
the leader's M1-M8 resting position is sampled (after an explicit SPACE-bar
confirmation) and median-filtered, and a preview of the first live command
is written to a calibration log.

Usage:
    uv run python main.py \
        --leader-server 192.168.68.66 --leader-bus auto \
        --follower-server 192.168.68.56 --follower-device auto \
        --map 8:51 \
        --follower-limits "52:80-220,53:20-180"
"""

import argparse
import asyncio
import logging
import sys
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable

# Add repo root so the generated protobuf and station_py imports resolve.
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from software.station.shared.station_py import new_station_client
from target.gen_python.protobuf.drivers.st3215 import st3215
from target.gen_python.protobuf.drivers.yahboom_dogzilla_lite import yahboom_dogzilla_lite

from config import (
    AXIS_CENTER_EXTREME_PCT, AxisConfig, ConfigFile, FOLLOWER_DEFAULT_LIMITS, FOLLOWER_HOME_POSITIONS,
    FollowerConfig, JointMap, LEADER_MAX_STEPS, LEADER_SMOOTHING_ALPHA_DEFAULT, MAX_DATA_AGE_NS,
    MOVEMENT_NEUTRAL, MixedAxisConfig, REST_SAMPLE_DURATION_S, TELEOP_REFRESH_INTERVAL_S,
    load_config_file, parse_follower_limits, parse_joint_map,
)
from commands import send_follower_commands
from mirror import (
    AxisState, LeaderSmoother, RateLimiterTable,
    compute_axis_command, compute_follower_command, compute_mixed_axis_command,
    get_steps_range, normalize_position, resolve_follower_range,
)
from startup import preview_follower_targets, reset_follower_to_home, sample_leader_rest_state, write_calib_log
from state import (
    FOLLOWER_SERVO_ID_ORDER,
    find_follower_device, find_leader_bus,
    parse_follower_positions, parse_leader_motor_state,
    resolve_follower_device_serial, resolve_leader_bus_serial,
)

logger = logging.getLogger(__name__)

# Warn at most once per second while a bus/device or its data is
# missing/stale, instead of spamming every tick.
WARN_INTERVAL_S = 1.0

DEFAULT_CALIB_LOG = Path(__file__).parent / "calib.log"


class FrameReader:
    """Subscribes to one station's inference topic and keeps the latest frame.

    The teleop task reads from `latest` whenever its tick fires; this task
    just keeps draining the queue so we never fall behind. `decode` turns the
    raw entry bytes into a protocol-specific reader (st3215 or
    yahboom_dogzilla_lite) -- everything else about frame bookkeeping is
    protocol-agnostic.
    """

    def __init__(self, client, label: str, topic: str, decode: Callable[[memoryview], object]):
        self.client = client
        self.label = label
        self.decode = decode
        self.latest = None
        self.latest_stamp_ns: int = 0
        self.frame_count: int = 0
        self._last_entry_id: bytes = b""
        self._queue: asyncio.Queue = asyncio.Queue()
        self._error_queue = client.follow(topic, self._queue)

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
                self.latest = self.decode(entry.Data)
                self.latest_stamp_ns = time.monotonic_ns()
                self.frame_count += 1
            except Exception:
                logger.exception("[%s] failed to decode inference frame", self.label)


async def _wait_for_first_frame(reader: FrameReader, timeout_s: float = 10.0):
    deadline = time.monotonic() + timeout_s
    while reader.latest is None:
        if time.monotonic() > deadline:
            raise RuntimeError(f"[{reader.label}] no inference frames after {timeout_s}s")
        await asyncio.sleep(0.05)


KEY_POLL_INTERVAL_S = 0.15


def _read_keys_blocking(stop_event: threading.Event, on_char: Callable[[str], None]):
    """Put stdin in cbreak mode and call `on_char(ch)` for each keypress,
    until `stop_event` is set or stdin closes. Always restores the
    terminal's settings on the way out, however we leave.

    Polls with `select()` on a short timeout instead of a bare blocking
    `read()` -- a bare `read()` can't be interrupted from outside the
    thread, so a cancelled asyncio task awaiting it (e.g. on Ctrl+C) leaves
    the underlying ThreadPoolExecutor worker still running. `asyncio.run()`'s
    own cleanup then calls `loop.shutdown_default_executor()`, which *waits*
    for every outstanding `to_thread()` call to finish before the process
    can exit -- so the whole interpreter would hang until another key was
    pressed. Polling lets the thread notice `stop_event` within one interval
    (default input latency is unaffected: `select()` returns immediately
    once a key is actually pressed, the timeout only matters when idle).
    """
    import select
    import termios
    import tty

    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        while not stop_event.is_set():
            ready, _, _ = select.select([fd], [], [], KEY_POLL_INTERVAL_S)
            if not ready:
                continue
            ch = sys.stdin.read(1)
            if not ch:
                return  # stdin closed
            on_char(ch)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


async def wait_for_space(prompt: str):
    """Print `prompt` and block (off the event loop) until SPACE is pressed.

    Falls back to Enter-to-continue if stdin isn't a real terminal (e.g.
    piped input) -- cbreak mode needs a tty, and this should degrade rather
    than crash if run non-interactively. The `finally` sets `stop_event`
    unconditionally, including when this coroutine itself is cancelled (e.g.
    Ctrl+C while still waiting at this prompt), so the background thread
    always gets told to stop rather than lingering -- see `_read_keys_blocking`.
    """
    print(f"\n{prompt}\n(press SPACE)")
    stop_event = threading.Event()

    def on_char(ch: str):
        if ch == " ":
            stop_event.set()

    try:
        await asyncio.to_thread(_read_keys_blocking, stop_event, on_char)
    except Exception:
        logger.warning("Couldn't read raw keypresses from this terminal -- press ENTER instead.")
        await asyncio.to_thread(input)
    finally:
        stop_event.set()


@dataclass
class PauseState:
    """Toggled by SPACE during the live control session (see `run_pause_watcher`).

    While paused, the teleop loop stops updating servo positions (the
    Dogzilla holds still on its own -- no torque-disable needed) and
    force-stops both movement axes via the existing `_force_movement_neutral`
    path, the same as a stale-data or missing-device gap.
    """
    paused: bool = False

    def toggle(self) -> bool:
        self.paused = not self.paused
        print("\n-- PAUSED (press SPACE to resume) --" if self.paused else "-- RESUMED --")
        return self.paused


async def run_pause_watcher(pause_state: PauseState, stop_event: threading.Event):
    """Background task: SPACE toggles `pause_state` for the rest of the session.

    Silently does nothing if stdin isn't a real terminal -- live pause needs
    raw keypresses; unlike the startup `wait_for_space` gate, there's no
    sensible Enter-key equivalent for a live toggle, so this just degrades
    to "pause unavailable" rather than crash. Ctrl+C still always works.
    `stop_event` is owned by the caller (`main_async`), which sets it during
    shutdown -- also set here on our own way out as a backstop, same
    reasoning as `wait_for_space`.
    """
    loop = asyncio.get_running_loop()

    def on_char(ch: str):
        if ch == " ":
            loop.call_soon_threadsafe(pause_state.toggle)

    try:
        await asyncio.to_thread(_read_keys_blocking, stop_event, on_char)
    except Exception:
        logger.warning("Live pause (SPACE) unavailable in this terminal.")
    finally:
        stop_event.set()


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
    """Per-side accumulator: frame age samples + frame count delta over a window.

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


def _compute_tick_commands(
    leader_bus, follower_device, joints, limits, rate_limiter, config, smoother,
    yaw_config, yaw_center, yaw_state, fwd_config, fwd_center, fwd_state,
):
    """Compute this tick's servo-position writes and update the two movement
    axis states in place. Returns (positions: dict, movement_changed: bool)
    -- `movement_changed` tells the caller whether to send a MovementCommand
    this tick (using yaw_state/fwd_state's current values, not just whichever
    one changed -- see `commands.send_follower_commands`).
    """
    leader_motors = {
        m.get_id(): parse_leader_motor_state(m)
        for m in (leader_bus.get_motors() or [])
    }
    # Smooth every leader reading we touch this tick (position joints and
    # movement axes alike) before any of the position/axis math sees it.
    for mid, state in leader_motors.items():
        state.present_position = smoother.update(mid, state.present_position)

    follower_positions = parse_follower_positions(follower_device)

    commands: dict[int, int] = {}
    for joint in joints:
        leader_state = leader_motors.get(joint.leader_id)
        telemetry_pos = follower_positions.get(joint.follower_id)
        if leader_state is None or telemetry_pos is None:
            continue
        last = rate_limiter.get(joint.follower_id, telemetry_pos)
        follower_range = resolve_follower_range(joint.follower_id, limits, config.margin)
        target = compute_follower_command(leader_state, last, joint, config, follower_range)
        if target is not None:
            rate_limiter.set(joint.follower_id, target)
            commands[joint.follower_id] = target

    movement_changed = False
    for axis_config, axis_center, axis_state in (
        (yaw_config, yaw_center, yaw_state),
        (fwd_config, fwd_center, fwd_state),
    ):
        target = _compute_axis_value(leader_motors, axis_config, axis_center, axis_state)
        if target is not None:
            axis_state.last_commanded = target
            movement_changed = True

    return commands, movement_changed


def _compute_axis_value(leader_motors, axis_config, axis_center, axis_state) -> int | None:
    """Dispatch to the right computation for one movement axis, whichever
    kind of config it is -- AxisConfig (single leader, binary target,
    `axis_center` from `_resolve_axis_center`) or MixedAxisConfig (two
    independent leaders, proportional, no external center needed).
    """
    if isinstance(axis_config, MixedAxisConfig):
        fwd_leader = leader_motors.get(axis_config.forward.leader_id) if axis_config.forward else None
        back_leader = leader_motors.get(axis_config.backward.leader_id) if axis_config.backward else None
        if fwd_leader is None and back_leader is None:
            return None
        return compute_mixed_axis_command(fwd_leader, back_leader, axis_state.last_commanded, axis_config)

    if axis_config.leader_id is None:
        return None
    leader_state = leader_motors.get(axis_config.leader_id)
    return compute_axis_command(leader_state, axis_center, axis_state.last_commanded, axis_config)


async def _force_movement_neutral(
    follower_client, follower_device_serial, yaw_config, yaw_state, fwd_config, fwd_state, reason,
):
    """Immediately (no ramp) command both movement axes back to neutral, if
    either isn't already.

    Unlike position joints -- which are safe to just stop updating (they
    hold their last commanded position) -- a non-neutral move_yaw/move_x is
    a standing command: the dog keeps moving until told otherwise. So gaps
    that are fine to just skip for position joints (stale data, a missing
    bus/device) have to actively stop movement instead.
    """
    yaw_active = yaw_config.enabled and yaw_state.last_commanded != MOVEMENT_NEUTRAL
    fwd_active = fwd_config.enabled and fwd_state.last_commanded != MOVEMENT_NEUTRAL
    if not (yaw_active or fwd_active):
        return
    logger.warning("Forcing movement to neutral (%s).", reason)
    try:
        await send_follower_commands(
            follower_client, follower_device_serial,
            movement=(MOVEMENT_NEUTRAL, MOVEMENT_NEUTRAL),
        )
        yaw_state.last_commanded = MOVEMENT_NEUTRAL
        fwd_state.last_commanded = MOVEMENT_NEUTRAL
    except Exception:
        logger.exception("Failed to force movement neutral")


async def teleop_loop(
    leader: FrameReader,
    leader_bus_serial: str,
    follower: FrameReader,
    follower_device_serial: str,
    follower_client,
    joints: list[JointMap],
    limits: dict[int, tuple[int, int]],
    rate_limiter: RateLimiterTable,
    config: FollowerConfig,
    smoother: LeaderSmoother,
    yaw_config: AxisConfig,
    yaw_center: int | None,
    yaw_state: AxisState,
    fwd_config: AxisConfig | MixedAxisConfig,
    fwd_center: int | None,
    fwd_state: AxisState,
    pause_state: PauseState,
):
    """Read latest leader state, compute follower commands, send them. Repeat.

    The loop tolerates transient gaps: a missing bus/device, a mapped motor
    id that hasn't shown up in a frame yet, or a stale frame just causes the
    tick to be skipped, with a throttled warning so we don't flood the log.
    The movement axes (yaw, forward/backward) are the exception -- see
    `_force_movement_neutral`. Pausing (`pause_state.paused`, toggled by
    SPACE -- see `run_pause_watcher`) is handled the same way: position
    joints just stop being updated, movement axes get force-stopped.
    """
    warn_stale = _Throttle()
    warn_missing_leader = _Throttle()
    warn_missing_follower = _Throttle()
    warn_slow_tick = _Throttle()

    leader_stats = LatencyBucket(leader.label)
    follower_stats = LatencyBucket(follower.label)
    stats_emit = _Throttle(STATS_INTERVAL_S)
    last_stats_t = time.monotonic()
    leader_stats.reset(leader.frame_count)
    follower_stats.reset(follower.frame_count)

    while True:
        tick_start = time.monotonic()

        try:
            if pause_state.paused:
                await _force_movement_neutral(
                    follower_client, follower_device_serial, yaw_config, yaw_state, fwd_config, fwd_state, "paused",
                )
            else:
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
                    await _force_movement_neutral(
                        follower_client, follower_device_serial, yaw_config, yaw_state, fwd_config, fwd_state, "stale data",
                    )
                else:
                    leader_bus = find_leader_bus(leader.latest, leader_bus_serial)
                    follower_device = find_follower_device(follower.latest, follower_device_serial)

                    if leader_bus is None:
                        if warn_missing_leader.ready():
                            logger.warning("leader bus '%s' not in latest frame", leader_bus_serial)
                        await _force_movement_neutral(
                            follower_client, follower_device_serial, yaw_config, yaw_state, fwd_config, fwd_state, "leader bus missing",
                        )
                    elif follower_device is None:
                        if warn_missing_follower.ready():
                            logger.warning("follower device '%s' not in latest frame", follower_device_serial)
                        await _force_movement_neutral(
                            follower_client, follower_device_serial, yaw_config, yaw_state, fwd_config, fwd_state, "follower device missing",
                        )
                    else:
                        cmds, movement_changed = _compute_tick_commands(
                            leader_bus, follower_device, joints, limits, rate_limiter, config, smoother,
                            yaw_config, yaw_center, yaw_state, fwd_config, fwd_center, fwd_state,
                        )
                        movement = (fwd_state.last_commanded, yaw_state.last_commanded) if movement_changed else None
                        if cmds or movement is not None:
                            await send_follower_commands(follower_client, follower_device_serial, cmds, movement)

        except Exception:
            logger.exception("teleop tick failed (continuing)")

        elapsed = time.monotonic() - tick_start
        sleep_for = TELEOP_REFRESH_INTERVAL_S - elapsed
        if sleep_for > 0:
            await asyncio.sleep(sleep_for)
        elif elapsed > TELEOP_REFRESH_INTERVAL_S * 2 and warn_slow_tick.ready():
            # Routine telemetry, not an actionable-by-default problem -- with
            # a continuously-changing axis (e.g. a MixedAxisConfig, which
            # sends nearly every tick instead of only on real change), this
            # is usually just network round-trip time for
            # send_follower_commands exceeding the 20ms tick budget, not a
            # bug. -v surfaces it; throttled either way so it can't spam.
            logger.info("tick took %.1fms (further overruns this second suppressed)", elapsed * 1000)


def _build_axis_config(args, prefix: str) -> AxisConfig:
    return AxisConfig(
        leader_id=getattr(args, f"{prefix}_leader_id"),
        invert=getattr(args, f"{prefix}_invert"),
        deadzone_steps=getattr(args, f"{prefix}_deadzone_steps"),
        ramp_step_per_tick=getattr(args, f"{prefix}_ramp_step"),
    )


def _resolve_joint_windows(rest_state, joints: list[JointMap]) -> list[JointMap]:
    """Resolve any `None` `leader_lo_pct`/`leader_hi_pct` endpoint (a YAML
    `"rest"` sentinel -- see `JointMap`'s docstring) into this session's
    live-sampled rest percentage for that joint's own leader_id, right after
    the operator's SPACE press -- the same safe-default posture already used
    for `AxisConfig.center_pct`/`MixedAxisInput.rest_pct`, generalized to
    joint windows for cases like "M6 rests at ~50%, but not exactly, so use
    wherever it actually rests as the reference point instead of a
    hardcoded assumption." `JointMap` is frozen, so this returns a new list
    (`dataclasses.replace`) rather than mutating in place.
    """
    resolved = []
    for joint in joints:
        if joint.leader_lo_pct is not None and joint.leader_hi_pct is not None:
            resolved.append(joint)
            continue
        rest = rest_state.get(joint.leader_id)
        if rest is None:
            raise RuntimeError(
                f"Couldn't characterize a resting position for joint M{joint.leader_id}->"
                f"{joint.follower_id} (no valid samples during the rest window) -- needed to "
                "resolve its 'rest' leader_range_pct endpoint"
            )
        if rest.range_min == rest.range_max:
            raise RuntimeError(
                f"Joint M{joint.leader_id}->{joint.follower_id} has no calibrated arc "
                f"(range_min == range_max == {rest.range_min}) -- a 'rest' leader_range_pct "
                "endpoint needs a calibrated motor to compute a percentage against."
            )
        sampled_pct = normalize_position(rest.median, rest.range_min, rest.range_max, LEADER_MAX_STEPS)
        lo = joint.leader_lo_pct if joint.leader_lo_pct is not None else sampled_pct
        hi = joint.leader_hi_pct if joint.leader_hi_pct is not None else sampled_pct
        logger.info(
            "Joint M%d->%d: resolved 'rest' leader_range_pct endpoint to %.1f%% "
            "(this session's live rest-sample) -- window now [%.1f, %.1f]",
            joint.leader_id, joint.follower_id, sampled_pct, lo, hi,
        )
        resolved.append(replace(joint, leader_lo_pct=lo, leader_hi_pct=hi))
    return resolved


async def _resolve_axis_center(rest_state, axis_config, label: str) -> int | None:
    if isinstance(axis_config, MixedAxisConfig):
        # No single external "center" for a mixed axis (unlike AxisConfig,
        # nothing gets returned/threaded through) -- but each input's
        # rest_pct still needs resolving here, in place, before the first
        # live tick: None means "use the live rest-sample" (safe default),
        # otherwise it's an explicit override, checked against what was
        # actually sampled. Getting this right matters more here than for
        # the single-leader axis -- a rest_pct-vs-limit_pct window can be
        # narrow, so a stale/wrong fixed guess turns into a large fraction
        # of full signal immediately, not a small error (this is exactly
        # what caused a real incident: a hardcoded rest_pct that didn't
        # match the arm's actual rest closely enough).
        for input_cfg, tag in ((axis_config.forward, "forward"), (axis_config.backward, "backward")):
            if input_cfg is None:
                continue
            rest = rest_state.get(input_cfg.leader_id)
            if rest is None:
                raise RuntimeError(
                    f"Couldn't characterize a resting position for {label} {tag} leader "
                    f"M{input_cfg.leader_id} (no valid samples during the rest window)"
                )
            if rest.range_min == rest.range_max:
                raise RuntimeError(
                    f"{label} {tag} leader M{input_cfg.leader_id} has no calibrated arc "
                    f"(range_min == range_max == {rest.range_min})"
                )
            sampled_pct = normalize_position(rest.median, rest.range_min, rest.range_max, LEADER_MAX_STEPS)
            if input_cfg.rest_pct is None:
                input_cfg.rest_pct = sampled_pct
                logger.info(
                    "%s %s leader M%d rest_pct: %.1f%% (from this session's live rest-sample, "
                    "limit_pct=%.1f%%)",
                    label, tag, input_cfg.leader_id, sampled_pct, input_cfg.limit_pct,
                )
            else:
                logger.info(
                    "%s %s leader M%d resting at %.1f%% (configured rest_pct=%.1f%%, limit_pct=%.1f%%)",
                    label, tag, input_cfg.leader_id, sampled_pct, input_cfg.rest_pct, input_cfg.limit_pct,
                )
                if abs(sampled_pct - input_cfg.rest_pct) > AXIS_CENTER_EXTREME_PCT:
                    logger.warning(
                        "%s %s leader M%d's actual resting position (%.1f%%) is far from the "
                        "configured rest_pct (%.1f%%) -- this session's live rest position will "
                        "NOT be used since rest_pct is explicitly set; omit it to use the live "
                        "sample instead, or double check this value against a fresh "
                        "calibration-dump reading.",
                        label, tag, input_cfg.leader_id, sampled_pct, input_cfg.rest_pct,
                    )
        return None

    if axis_config.leader_id is None:
        return None
    rest = rest_state.get(axis_config.leader_id)
    if rest is None:
        raise RuntimeError(
            f"Couldn't characterize a resting position for {label} leader M{axis_config.leader_id} "
            "(no valid samples during the rest window)"
        )

    if axis_config.center_pct is not None:
        # Explicit override: center is a fixed percentage of the motor's own
        # calibrated arc (read via the API, same as everywhere else -- never
        # assumed or hardcoded), not wherever it happens to naturally rest.
        # For a joint whose rest pose sits at a hard limit, this is how to
        # get a genuinely bidirectional axis: the operator actively holds
        # the arm at the chosen percentage instead of letting it settle.
        if rest.range_min == rest.range_max:
            raise RuntimeError(
                f"{label} leader M{axis_config.leader_id} has no calibrated arc "
                f"(range_min == range_max == {rest.range_min}) -- center_pct needs a "
                "calibrated motor to compute a percentage against."
            )
        width = get_steps_range(rest.range_min, rest.range_max, LEADER_MAX_STEPS)
        center = (rest.range_min + round(axis_config.center_pct / 100.0 * width)) % LEADER_MAX_STEPS
        rest_pct = normalize_position(rest.median, rest.range_min, rest.range_max, LEADER_MAX_STEPS)
        logger.info(
            "%s center (M%d): %d -- explicit %.1f%% of calibrated arc [%d,%d] "
            "(sampled rest position was %d / %.0f%%, not used since center_pct is set)",
            label, axis_config.leader_id, center, axis_config.center_pct,
            rest.range_min, rest.range_max, rest.median, rest_pct,
        )
        return center

    logger.info(
        "%s center (M%d resting position): %d (spread=%d over %d samples)",
        label, axis_config.leader_id, rest.median, rest.spread, rest.n_samples,
    )

    # If the resting position sits near either end of the motor's own
    # calibrated arc (read straight from the motor's own range_min/range_max
    # -- not assumed, not defaulted to mid-arc), there's no room to deviate
    # the *other* way from it, so this axis will only ever detect one
    # direction, regardless of --invert. That's not necessarily a problem --
    # a joint whose rest pose sits at a limit by design (e.g. M2 on this
    # rig) is expected to be one-directional -- so this is informational,
    # not a "go fix your calibration" warning.
    if rest.range_min != rest.range_max:
        sampled_pct = normalize_position(rest.median, rest.range_min, rest.range_max, LEADER_MAX_STEPS)
        if sampled_pct <= AXIS_CENTER_EXTREME_PCT or sampled_pct >= 100 - AXIS_CENTER_EXTREME_PCT:
            near_end = "range_min" if sampled_pct <= 50 else "range_max"
            logger.warning(
                "%s leader M%d rests at %.0f%% of its calibrated arc (range=[%d,%d] from the "
                "motor's own calibration), near %s -- this axis will only ever detect deviation "
                "toward the opposite end, never back past rest. If that's the intended behavior "
                "for this joint, no action needed -- otherwise set center_pct in a --config file "
                "to use a fixed percentage instead of the sampled rest position.",
                label, axis_config.leader_id, sampled_pct, rest.range_min, rest.range_max, near_end,
            )
    return rest.median


async def main_async(args):
    if args.config is not None:
        cfg: ConfigFile = load_config_file(args.config)
        # Overwrite so the rest of this function can keep referencing
        # args.leader_server etc. uniformly, regardless of where they came
        # from -- YAML is just an alternate source for the same fields.
        args.leader_server = cfg.leader_server
        args.leader_bus = cfg.leader_bus
        args.follower_server = cfg.follower_server
        args.follower_device = cfg.follower_device
        joints = cfg.joints
        limits = {**FOLLOWER_DEFAULT_LIMITS, **cfg.follower_limits}
        yaw_config = cfg.yaw
        fwd_config = cfg.fwd
        print(f"Loaded config from {args.config}")
    else:
        joints = parse_joint_map(args.map)
        # Explicit --follower-limits entries override the built-in
        # self-collision guard for that id; anything not mentioned keeps
        # the default.
        limits = {**FOLLOWER_DEFAULT_LIMITS, **parse_follower_limits(args.follower_limits)}
        yaw_config = _build_axis_config(args, "yaw")
        fwd_config = _build_axis_config(args, "fwd")
    yaw_enabled = yaw_config.enabled
    fwd_enabled = fwd_config.enabled

    if not joints and not yaw_enabled and not fwd_enabled:
        raise RuntimeError("Nothing to do: no joints mapped (--map/joints) and no movement axis enabled")

    unknown_follower_ids = sorted({j.follower_id for j in joints} - set(FOLLOWER_SERVO_ID_ORDER))
    if unknown_follower_ids:
        raise RuntimeError(
            f"--map has follower ids the Dogzilla driver doesn't recognize: {unknown_follower_ids} "
            f"(valid ids: {FOLLOWER_SERVO_ID_ORDER})"
        )
    unknown_limit_ids = sorted(set(limits) - set(FOLLOWER_SERVO_ID_ORDER))
    if unknown_limit_ids:
        raise RuntimeError(
            f"--follower-limits has ids the Dogzilla driver doesn't recognize: {unknown_limit_ids}"
        )

    leader_client = await new_station_client(args.leader_server, logger)
    if args.follower_server == args.leader_server:
        follower_client = leader_client
    else:
        follower_client = await new_station_client(args.follower_server, logger)

    leader = FrameReader(
        leader_client, label=f"leader@{args.leader_server}",
        topic="st3215/inference", decode=st3215.InferenceStateReader,
    )
    follower = FrameReader(
        follower_client, label=f"follower@{args.follower_server}",
        topic="yahboom-dogzilla-lite/inference", decode=yahboom_dogzilla_lite.InferenceStateReader,
    )

    leader_task = asyncio.create_task(leader.run())
    follower_task = asyncio.create_task(follower.run())

    # Need a first frame from each reader so we can resolve "auto" and check
    # every mapped motor id is actually present.
    await _wait_for_first_frame(leader)
    await _wait_for_first_frame(follower)

    leader_serial = resolve_leader_bus_serial(leader.latest, args.leader_bus)
    follower_serial = resolve_follower_device_serial(follower.latest, args.follower_device)

    leader_bus = find_leader_bus(leader.latest, leader_serial)
    follower_device = find_follower_device(follower.latest, follower_serial)
    leader_motor_ids = {m.get_id() for m in (leader_bus.get_motors() or [])} if leader_bus else set()
    follower_motor_ids = set(parse_follower_positions(follower_device).keys()) if follower_device else set()

    required_leader_ids = {j.leader_id for j in joints} | yaw_config.leader_ids | fwd_config.leader_ids
    missing_leader = sorted(required_leader_ids - leader_motor_ids)
    missing_follower = sorted({j.follower_id for j in joints} - follower_motor_ids)
    if missing_leader:
        raise RuntimeError(f"Leader bus '{leader_serial}' is missing required motor ids: {missing_leader}")
    if missing_follower:
        raise RuntimeError(f"Follower device '{follower_serial}' is missing mapped servo ids: {missing_follower}")

    joint_summary = ", ".join(
        f"{j.leader_id}->{j.follower_id}{'(inv)' if j.invert else ''}" for j in joints
    )
    print(
        f"arm2dog: leader={args.leader_server}/{leader_serial} (ST3215) -> "
        f"follower={args.follower_server}/{follower_serial} (Dogzilla), joints=[{joint_summary}]"
    )
    logger.info(
        "No current-based overload protection on the follower side (the Dogzilla "
        "driver exposes none) -- movement is bounded only by the %d-step-per-tick "
        "rate limiter%s.",
        FollowerConfig().max_step_per_tick,
        f" and configured limits {limits}" if limits else "",
    )
    if yaw_enabled:
        print(
            f"Yaw control: leader M{yaw_config.leader_id} -> move_yaw"
            f"{' (inverted)' if yaw_config.invert else ' (not inverted)'} "
            f"(confirmed on this rig with M1 -- toggle --no-yaw-invert/--yaw-invert if it spins "
            f"the wrong way on a different leader motor or rig)"
        )
        logger.info(
            "Yaw control detail: deadzone=%d steps, ramp=%d/tick.",
            yaw_config.deadzone_steps, yaw_config.ramp_step_per_tick,
        )
    if fwd_enabled and isinstance(fwd_config, MixedAxisConfig):
        # Printed later, after _resolve_axis_center -- rest_pct isn't known
        # yet at this point when it's defaulting to the live rest-sample
        # (None until resolved), and formatting None with :.0f crashes.
        logger.info(
            "Forward/backward control detail: ramp=%d/tick, deadband=%d, deadzone_pct=%.1f.",
            fwd_config.ramp_step_per_tick, fwd_config.deadband, fwd_config.deadzone_pct,
        )
    elif fwd_enabled:
        print(
            f"Forward/backward control: leader M{fwd_config.leader_id} -> move_x"
            f"{' (inverted)' if fwd_config.invert else ' (not inverted)'} "
            f"(direction unverified on this hardware -- toggle --no-fwd-invert/--fwd-invert if it moves the wrong way)"
        )
        logger.info(
            "Forward/backward control detail: deadzone=%d steps, ramp=%d/tick.",
            fwd_config.deadzone_steps, fwd_config.ramp_step_per_tick,
        )

    config = FollowerConfig()

    # (a0) Silence any movement left running from a previous session (no
    # torque-disable on this driver, so a stale non-neutral move_x/move_yaw
    # just keeps going) before anything else touches the follower.
    if yaw_enabled or fwd_enabled:
        try:
            await send_follower_commands(
                follower_client, follower_serial,
                movement=(MOVEMENT_NEUTRAL, MOVEMENT_NEUTRAL),
            )
            print("Follower movement stopped (neutral) as a startup precaution.")
        except Exception:
            logger.exception("Failed to send startup movement-neutral")

    # (a) Ramp all of FOLLOWER_HOME_POSITIONS to a known-safe pose,
    # unconditionally (not just this session's --map/joints -- see README
    # "Safety"), clamped only to an *explicit* limit for that id (not the
    # generic margin-padded default, which exists for live-tracked joints
    # with no more specific info, not for these already-known-safe values).
    home_targets = {}
    for sid, home_pos in FOLLOWER_HOME_POSITIONS.items():
        if sid in limits:
            low, high = limits[sid]
            clamped = max(low, min(high, home_pos))
        else:
            clamped = home_pos
        if clamped != home_pos:
            logger.warning(
                "Follower %d home position %d falls outside configured safe range "
                "[%d,%d] -- using %d instead.",
                sid, home_pos, low, high, clamped,
            )
        home_targets[sid] = clamped
    print(f"Resetting follower arm to home pose: {home_targets} ...")
    last_commanded = await reset_follower_to_home(
        follower_client, follower_serial, follower, find_follower_device, home_targets, config,
    )
    # Within-deadband, not strict equality: the ramp counter can stop a
    # couple raw units short of an exact target (step_toward's own deadband
    # semantics), which is expected, not a failure. Note this can't confirm
    # the *physical* arm arrived either way -- see reset_follower_to_home's
    # docstring, the driver has no real position feedback to check against.
    if all(abs(last_commanded.get(sid, t) - t) <= config.deadband for sid, t in home_targets.items()):
        print(f"Follower arm commanded to home pose (settled): {last_commanded}")
    else:
        print(
            f"Follower arm reset ramp did NOT converge -- target {home_targets}, "
            f"last commanded {last_commanded} (see warning above). Continuing anyway."
        )
    rate_limiter = RateLimiterTable()
    for sid, value in last_commanded.items():
        rate_limiter.set(sid, value)

    # (b)/(c) Characterize the leader's resting position (M1-M8) and preview
    # what it would command on the follower side. Gated on an explicit
    # keypress rather than sampling immediately -- the operator needs a beat
    # to actually get the arm into a resting pose first (reset-to-home above
    # can take a few seconds on its own, arm positioning takes longer).
    await wait_for_space(
        f"Move the leader arm to its resting position, then press SPACE here "
        f"and hold the arm still for {args.rest_sample_s:.0f}s."
    )
    logger.info("Sampling leader resting position for %.1fs -- keep the arm still...", args.rest_sample_s)
    rest_state = await sample_leader_rest_state(
        leader, leader_serial, find_leader_bus, duration_s=args.rest_sample_s,
    )
    joints = _resolve_joint_windows(rest_state, joints)
    preview = preview_follower_targets(rest_state, joints, limits, config)

    yaw_center = await _resolve_axis_center(rest_state, yaw_config, "Yaw")
    fwd_center = await _resolve_axis_center(rest_state, fwd_config, "Forward/backward")

    if fwd_enabled and isinstance(fwd_config, MixedAxisConfig):
        # rest_pct is guaranteed resolved (non-None) now, whichever way it
        # got there -- live-sampled default or an explicit YAML override.
        parts = []
        if fwd_config.forward is not None:
            parts.append(f"forward=M{fwd_config.forward.leader_id} ({fwd_config.forward.rest_pct:.1f}%->{fwd_config.forward.limit_pct:.0f}%)")
        if fwd_config.backward is not None:
            parts.append(f"backward=M{fwd_config.backward.leader_id} ({fwd_config.backward.rest_pct:.1f}%->{fwd_config.backward.limit_pct:.0f}%)")
        print(
            f"Forward/backward control (mixed, proportional): {', '.join(parts)} -> move_x "
            f"(direction unverified on this hardware)"
        )

    # (d) Log it.
    log_text = write_calib_log(args.calib_log, rest_state, preview, joints)
    logger.info("Calibration snapshot written to %s:\n%s", args.calib_log, log_text)
    print(f"Calibration snapshot written to {args.calib_log}")

    # (e) Start live control.
    smoother = LeaderSmoother(alpha=args.leader_smoothing_alpha)
    yaw_state = AxisState()
    fwd_state = AxisState()
    pause_state = PauseState()
    pause_stop_event = threading.Event()
    print("\nControl running. Press SPACE at any time to pause/resume motion mirroring; Ctrl+C to stop.")
    loop_task = asyncio.create_task(teleop_loop(
        leader, leader_serial,
        follower, follower_serial,
        follower_client, joints, limits, rate_limiter, config,
        smoother, yaw_config, yaw_center, yaw_state, fwd_config, fwd_center, fwd_state,
        pause_state,
    ))
    pause_task = asyncio.create_task(run_pause_watcher(pause_state, pause_stop_event))

    try:
        # Whichever task fails first surfaces here; .result() re-raises.
        # pause_task normally never finishes (or degrades to a no-op if
        # stdin isn't a tty) -- its own errors are caught internally, so it
        # never triggers this on its own.
        done, _ = await asyncio.wait(
            {leader_task, follower_task, loop_task, pause_task},
            return_when=asyncio.FIRST_EXCEPTION,
        )
        for t in done:
            t.result()
    except KeyboardInterrupt:
        logger.info("Interrupted, shutting down")
    finally:
        # Set explicitly (not just relying on run_pause_watcher's own
        # cancellation handling) so the background thread notices and exits
        # as early as possible in the shutdown sequence -- see
        # _read_keys_blocking for why a lingering thread here would hang
        # the whole interpreter on exit.
        pause_stop_event.set()
        for t in (leader_task, follower_task, loop_task, pause_task):
            t.cancel()
        if yaw_enabled or fwd_enabled:
            try:
                await send_follower_commands(
                    follower_client, follower_serial,
                    movement=(MOVEMENT_NEUTRAL, MOVEMENT_NEUTRAL),
                )
                print("Movement stopped (neutral).")
            except Exception:
                logger.exception("Failed to stop movement on shutdown")
        print(
            "Stopped sending. The Dogzilla driver has no torque-disable command, "
            "so the follower arm holds its last commanded position."
        )


def main():
    parser = argparse.ArgumentParser(description="arm2dog: ST3215 leader joints -> Dogzilla follower joints")
    parser.add_argument(
        "--config", type=Path, default=None,
        help="Load leader/follower servers, joints, and yaw/fwd axes from a YAML file instead of "
             "--leader-server/--follower-server/--map/--yaw-*/--fwd-*/--follower-limits (see "
             "config.load_config_file and configs/ in this directory for an example). Required "
             "if any of those flags aren't given; session-level flags (--verbose, --rest-sample-s, "
             "--calib-log, --leader-smoothing-alpha) still come from the CLI either way.",
    )
    parser.add_argument("--leader-server", default=None, help="Station address for the leader ST3215 bus (ignored if --config is set)")
    parser.add_argument("--leader-bus", default="auto", help='Leader bus serial, or "auto" for single-bus station (ignored if --config is set)')
    parser.add_argument("--follower-server", default=None, help="Station address for the follower Dogzilla device (ignored if --config is set)")
    parser.add_argument("--follower-device", default="auto", help='Follower device serial, or "auto" for single-device station (ignored if --config is set)')
    parser.add_argument(
        "--map", default=None,
        help='Comma-separated leader_id:follower_id[:inv] pairs, e.g. "8:51" or "8:51:inv,7:52" '
             "(ignored if --config is set)",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true",
        help="Show routine per-second health stats and detailed config echo. "
             "Default output is just startup confirmations, warnings, and errors.",
    )
    parser.add_argument(
        "--follower-limits", default="",
        help='Comma-separated follower_id:low-high safe-range overrides, e.g. "52:80-220,53:20-180". '
             "Use this to keep a joint out of a self-collision zone.",
    )
    parser.add_argument(
        "--rest-sample-s", type=float, default=REST_SAMPLE_DURATION_S,
        help=f"Seconds to sample the leader's resting position for at startup, after the SPACE "
             f"prompt (default: {REST_SAMPLE_DURATION_S})",
    )
    parser.add_argument(
        "--calib-log", type=Path, default=DEFAULT_CALIB_LOG,
        help=f"Path to append calibration snapshots to (default: {DEFAULT_CALIB_LOG})",
    )
    parser.add_argument(
        "--leader-smoothing-alpha", type=float, default=LEADER_SMOOTHING_ALPHA_DEFAULT,
        help=f"EMA smoothing factor for leader position readings, 0-1, 1=no smoothing (default: {LEADER_SMOOTHING_ALPHA_DEFAULT})",
    )
    parser.add_argument(
        "--yaw-leader-id", type=int, default=None,
        help="Leader motor id (e.g. 1 for M1) whose deviation from its resting position "
             "controls follower rotate-in-place (move_yaw). Omit to disable yaw control.",
    )
    parser.add_argument(
        "--yaw-invert", action=argparse.BooleanOptionalAction, default=True,
        help="Flip which direction (Q=255 vs E=1) a leader deviation maps to. Defaults to "
             "True: confirmed on this rig that M1 needs inverting (toward its calibrated "
             "range_min should yaw left/Q, toward range_max should yaw right/E). Pass "
             "--no-yaw-invert if that's backwards on your setup.",
    )
    parser.add_argument(
        "--yaw-deadzone-steps", type=int, default=AxisConfig().deadzone_steps,
        help=f"Raw ST3215 encoder steps (0-4095/turn) of deviation from the resting position "
             f"treated as 'centered, don't rotate'. Step-based, not calibration-relative -- "
             f"works even if the yaw leader motor was never calibrated (default: {AxisConfig().deadzone_steps})",
    )
    parser.add_argument(
        "--yaw-ramp-step", type=int, default=AxisConfig().ramp_step_per_tick,
        help=f"Max change in commanded move_yaw per tick -- the spin-up/spin-down smoothing "
             f"(default: {AxisConfig().ramp_step_per_tick})",
    )
    parser.add_argument(
        "--fwd-leader-id", type=int, default=None,
        help="Leader motor id (e.g. 2 for M2, the shoulder-pitch joint) whose deviation from "
             "its resting position controls follower forward/backward motion (move_x). "
             "Omit to disable.",
    )
    parser.add_argument(
        "--fwd-invert", action=argparse.BooleanOptionalAction, default=True,
        help="Flip which direction (W=255 vs S=1) a forward leader deviation maps to. "
             "Defaults to True: M2 rests at (near) its calibrated range_min on this rig, so "
             "the only physically-reachable deviation from the sampled center is pulling the "
             "arm back (delta>0, toward range_max) -- without inverting, that direction would "
             "map to forward (W), when pulling back should drive the dog backward. Pass "
             "--no-fwd-invert if that's backwards on your setup. Note: since the rest center "
             "sits at a hard joint limit, this axis is one-directional either way -- there's no "
             "room to deviate the other way from a position already at the joint's minimum, so "
             "M2 alone can never trigger the opposite direction, regardless of this flag.",
    )
    parser.add_argument(
        "--fwd-deadzone-steps", type=int, default=AxisConfig().deadzone_steps,
        help=f"Raw ST3215 encoder steps (0-4095/turn) of deviation from the resting position "
             f"treated as 'centered, don't move' (default: {AxisConfig().deadzone_steps})",
    )
    parser.add_argument(
        "--fwd-ramp-step", type=int, default=AxisConfig().ramp_step_per_tick,
        help=f"Max change in commanded move_x per tick -- the speed-up/slow-down smoothing "
             f"(default: {AxisConfig().ramp_step_per_tick})",
    )
    args = parser.parse_args()

    if args.config is None:
        missing = [
            flag for flag, value in (
                ("--leader-server", args.leader_server),
                ("--follower-server", args.follower_server),
                ("--map", args.map),
            ) if value is None
        ]
        if missing:
            parser.error(f"the following arguments are required: {', '.join(missing)} (or use --config)")

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s - %(message)s",
    )

    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

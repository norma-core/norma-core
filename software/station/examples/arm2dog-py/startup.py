"""Pre-flight sequence run once before live tracking starts:

  1. `reset_follower_to_home`: ramp the follower's mapped arm servos to a
     known-safe pose (gripper open), rate-limited the same way live tracking
     is -- never an instant jump, even at startup.
  2. `sample_leader_rest_state`: characterize the leader's M1-M8 resting
     position (median-filtered) and calibrated range, so we have a record of
     what "at rest" looked like and can sanity-check it before trusting the
     first live tick.
  3. `preview_follower_targets` + `write_calib_log`: compute what the
     resting leader position would command on the follower side, and record
     the whole pre-flight snapshot to a log file for audit/debugging.
"""

import asyncio
import logging
import statistics
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from config import (
    FollowerConfig, JointMap, LEADER_MOTOR_IDS, REST_JITTER_WARN_STEPS,
    REST_SAMPLE_DURATION_S, REST_SAMPLE_INTERVAL_S, RESET_SETTLE_S, RESET_TIMEOUT_S,
    TELEOP_REFRESH_INTERVAL_S,
)
from commands import send_follower_commands
from mirror import RateLimiterTable, leader_percent, project_percentage, resolve_follower_range, step_toward
from state import parse_follower_positions, parse_leader_motor_state

logger = logging.getLogger(__name__)


async def reset_follower_to_home(
    follower_client,
    follower_serial: str,
    follower_reader,
    find_follower_device: Callable,
    targets: dict[int, int],
    config: FollowerConfig,
    timeout_s: float = RESET_TIMEOUT_S,
    settle_s: float = RESET_SETTLE_S,
) -> dict[int, int]:
    """Ramp the given follower servos to `targets`, rate-limited, before live control starts.

    Returns the final commanded value per servo id, meant to seed the live
    loop's RateLimiterTable so tracking picks up smoothly from here.

    IMPORTANT: this cannot actually confirm the physical servo arrived.
    `parse_follower_positions` reads `YahboomDogzillaLiteStatus.servo_positions`,
    which is just an echo of the last-written byte off the driver's own
    feedback packet -- there is no closed-loop position sensor, current, or
    moving-status field anywhere in this protocol (confirmed by reading the
    Rust driver's protocol/feedback-packet code), so it converges to
    whatever we last commanded almost immediately regardless of whether the
    physical arm has actually caught up. An earlier version of this function
    tried to use that telemetry as a confirmation signal -- it was a no-op
    dressed up as a safety check. Instead: ramp the commanded value (rate
    limited, same as live tracking), then wait a fixed `settle_s` afterward
    for the physical servo to catch up, since that's the only lever
    available without real feedback.
    """
    if not targets:
        return {}

    device = find_follower_device(follower_reader.latest, follower_serial)
    telemetry = parse_follower_positions(device) if device is not None else {}
    last = {sid: telemetry.get(sid, target) for sid, target in targets.items()}

    logger.info("Resetting follower to home pose: %s", targets)

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        cmds = {}
        for sid, target in targets.items():
            nxt = step_toward(last[sid], target, config.max_step_per_tick, config.deadband)
            if nxt is not None:
                last[sid] = nxt
                cmds[sid] = nxt
        if not cmds:
            break
        await send_follower_commands(follower_client, follower_serial, cmds)
        await asyncio.sleep(TELEOP_REFRESH_INTERVAL_S)
    else:
        logger.warning(
            "Follower reset ramp did not converge after %.1fs, continuing from: %s", timeout_s, last,
        )
        return last

    logger.info(
        "Follower reset ramp commanded %s -- waiting %.1fs for the physical servo(s) to "
        "settle (no real position feedback exists to confirm this -- see config.RESET_SETTLE_S).",
        last, settle_s,
    )
    await asyncio.sleep(settle_s)
    return last


@dataclass
class LeaderRestInfo:
    median: int
    spread: int
    range_min: int
    range_max: int
    n_samples: int


async def sample_leader_rest_state(
    leader_reader,
    leader_bus_serial: str,
    find_leader_bus: Callable,
    duration_s: float = REST_SAMPLE_DURATION_S,
    interval_s: float = REST_SAMPLE_INTERVAL_S,
) -> dict[int, LeaderRestInfo]:
    """Sample M1-M8 present position for `duration_s`, return per-motor median + range.

    Intended to run while the operator holds the leader arm still at a
    natural resting pose. `spread` (max-min over the window) is a rough
    "was it actually still" signal -- callers should warn, not necessarily
    abort, when it's large (see REST_JITTER_WARN_STEPS).
    """
    samples: dict[int, list[int]] = {mid: [] for mid in LEADER_MOTOR_IDS}
    ranges: dict[int, tuple[int, int]] = {}

    deadline = time.monotonic() + duration_s
    while time.monotonic() < deadline:
        bus = find_leader_bus(leader_reader.latest, leader_bus_serial)
        if bus is not None:
            for m in bus.get_motors() or []:
                mid = m.get_id()
                if mid in samples:
                    state = parse_leader_motor_state(m)
                    if state.present_position != 0:
                        samples[mid].append(state.present_position)
                        ranges[mid] = (state.range_min, state.range_max)
        await asyncio.sleep(interval_s)

    result: dict[int, LeaderRestInfo] = {}
    for mid in LEADER_MOTOR_IDS:
        vals = samples[mid]
        if not vals:
            continue
        range_min, range_max = ranges[mid]
        result[mid] = LeaderRestInfo(
            median=round(statistics.median(vals)),
            spread=max(vals) - min(vals),
            range_min=range_min,
            range_max=range_max,
            n_samples=len(vals),
        )
    return result


@dataclass
class FollowerPreview:
    leader_id: int
    leader_pct: float
    follower_target: int


def preview_follower_targets(
    rest_state: dict[int, LeaderRestInfo],
    joints: list[JointMap],
    limits: dict[int, tuple[int, int]],
    config: FollowerConfig,
) -> dict[int, FollowerPreview]:
    """For each mapped joint, what would the follower be commanded to right now.

    Uses the median resting position captured by `sample_leader_rest_state`,
    projected the same way live tracking projects it -- a sanity-check
    preview of the very first live command, before anything is actually sent.
    """
    from mirror import LeaderMotorState  # local import: avoids a cycle at module load

    preview: dict[int, FollowerPreview] = {}
    for joint in joints:
        info = rest_state.get(joint.leader_id)
        if info is None:
            continue
        leader = LeaderMotorState(
            present_position=info.median, range_min=info.range_min, range_max=info.range_max,
        )
        pct = leader_percent(leader, joint.invert, joint.leader_lo_pct, joint.leader_hi_pct)
        low, high = resolve_follower_range(joint.follower_id, limits, config.margin)
        target = project_percentage(pct, low, high)
        preview[joint.follower_id] = FollowerPreview(
            leader_id=joint.leader_id, leader_pct=pct, follower_target=target,
        )
    return preview


def write_calib_log(
    path: Path,
    rest_state: dict[int, LeaderRestInfo],
    preview: dict[int, FollowerPreview],
    joints: list[JointMap],
    jitter_warn_steps: int = REST_JITTER_WARN_STEPS,
) -> str:
    """Append a timestamped calibration snapshot to `path`. Returns the text written."""
    lines = [f"=== arm2dog calibration {time.strftime('%Y-%m-%dT%H:%M:%S%z')} ==="]

    lines.append("Leader resting state (M1-M8):")
    for mid in LEADER_MOTOR_IDS:
        info = rest_state.get(mid)
        if info is None:
            lines.append(f"  M{mid}: no data")
            continue
        flag = "  ** NOT AT REST? **" if info.spread > jitter_warn_steps else ""
        lines.append(
            f"  M{mid}: median={info.median} spread={info.spread} "
            f"range=[{info.range_min},{info.range_max}] n={info.n_samples}{flag}"
        )

    lines.append("Leader -> follower preview (from resting position):")
    for joint in joints:
        p = preview.get(joint.follower_id)
        if p is None:
            lines.append(f"  M{joint.leader_id} -> {joint.follower_id}: no data")
            continue
        inv = " (inverted)" if joint.invert else ""
        lines.append(
            f"  M{p.leader_id} -> {joint.follower_id}{inv}: "
            f"leader_pct={p.leader_pct:.1f}% -> follower_target={p.follower_target}"
        )

    text = "\n".join(lines) + "\n\n"
    with open(path, "a") as f:
        f.write(text)
    return text

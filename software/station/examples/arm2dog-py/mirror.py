"""Per-joint goal computation: ST3215 leader position -> Dogzilla follower byte.

For each mapped (leader_id -> follower_id) pair we:
  1. Convert the leader's present position to a 0-100% within its own
     calibrated ST3215 arc (optionally flipped, see `invert`).
  2. Project that percentage linearly onto the follower's safe raw-byte range
     (see `resolve_follower_range` -- either the configured per-joint limit
     from `--follower-limits`, or the default margin-padded 0-255 span).
  3. Rate-limit the result against the last commanded value, so the follower
     never jumps more than `max_step_per_tick` in one tick. This is the
     stand-in for the ST3215 side's speed/accel envelope and current-based
     overload protection -- the Dogzilla driver exposes neither (its
     telemetry has no per-servo current field), so a bounded step size is
     the only guard available against a too-fast, too-forceful command.
"""

from dataclasses import dataclass, field

from config import AxisConfig, FollowerConfig, JointMap, LEADER_MAX_STEPS, MOVEMENT_NEUTRAL, MixedAxisConfig, MixedAxisInput


# Motor status register bit 0 = under-voltage. Common on leaders when their rail
# dips under load and not a real fault — mask it out before gating.
STATUS_VOLTAGE_BIT = 0x01


@dataclass
class LeaderMotorState:
    """Snapshot of one ST3215 leader motor extracted from an inference frame."""
    present_position: int = 0
    range_min: int = 0
    range_max: int = 0
    error_status: int = 0


def get_steps_range(range_min: int, range_max: int, max_steps: int) -> int:
    """Width of the calibrated arc in encoder steps, accounting for wrap-around."""
    if range_max >= range_min:
        return range_max - range_min
    return (max_steps - range_min) + range_max


def normalize_position(
    position: int, range_min: int, range_max: int, max_steps: int,
) -> float:
    """Map a raw encoder position to a 0-100% within [range_min, range_max].

    Handles wrap-around arcs (where range_max < range_min, e.g. the arc spans
    the encoder's zero crossing). Out-of-range positions clamp to the nearest
    end. Returns 50% when the arc has zero width (uncalibrated).
    """
    range_size = get_steps_range(range_min, range_max, max_steps)
    if range_size == 0:
        return 50.0

    if range_max >= range_min:
        if position < range_min:
            relative = 0
        elif position > range_max:
            relative = range_size
        else:
            relative = position - range_min
    else:
        # Wrap-around arc: valid region is [range_min, max_steps) U [0, range_max].
        if position >= range_min:
            relative = position - range_min
        elif position <= range_max:
            relative = (max_steps - range_min) + position
        else:
            # Outside the arc — clamp to whichever end is closer.
            dist_to_min = range_min - position
            dist_to_max = position - range_max
            relative = 0 if dist_to_min < dist_to_max else range_size

    pct = (relative / range_size) * 100.0
    return max(0.0, min(100.0, pct))


def rewindow_percentage(pct: float, lo_pct: float, hi_pct: float) -> float:
    """Rescale `pct` (0-100, within the sub-window [lo_pct, hi_pct]) onto a
    fresh 0-100 span, clamped. E.g. rewindow_percentage(50, 0, 50) == 100 --
    lets a joint's lower half alone drive a follower's full output range,
    with the upper half just clamping to the same endpoint as 50%.
    Identity when lo_pct=0, hi_pct=100 (the default -- no rewindowing).

    `lo_pct` may be greater than `hi_pct` -- a deliberately reversed window,
    e.g. (93, 50), meaning the output ramps from 0 to 100 as `pct` *decreases*
    from 93 toward 50 (used by mixed movement-axis inputs whose rest
    position is above their active limit -- see config.MixedAxisInput). Only
    exact equality (a zero-width window) is degenerate.
    """
    if hi_pct == lo_pct:
        return 50.0
    windowed = (pct - lo_pct) / (hi_pct - lo_pct) * 100.0
    return max(0.0, min(100.0, windowed))


def leader_percent(
    leader: LeaderMotorState, invert: bool, lo_pct: float = 0.0, hi_pct: float = 100.0,
) -> float:
    """Leader's present position as 0-100% of its own calibrated arc,
    optionally re-windowed onto [lo_pct, hi_pct] of that arc first (see
    `rewindow_percentage`) -- e.g. `JointMap.leader_range_pct`.
    """
    pct = normalize_position(
        leader.present_position, leader.range_min, leader.range_max, LEADER_MAX_STEPS,
    )
    if invert:
        pct = 100.0 - pct
    return rewindow_percentage(pct, lo_pct, hi_pct)


def resolve_follower_range(
    follower_id: int, limits: dict[int, tuple[int, int]], margin: int,
) -> tuple[int, int]:
    """The safe [low, high] raw-byte range for one follower servo.

    Uses the explicit override from `--follower-limits` if one was given for
    this id (e.g. to keep the gripper/arm out of a self-collision zone),
    otherwise falls back to the full 0-255 register range padded by
    `margin` on each end.
    """
    if follower_id in limits:
        return limits[follower_id]
    return (margin, 255 - margin)


def project_percentage(pct: float, low: int, high: int) -> int:
    """Project a 0-100% value linearly onto [low, high], clamped."""
    if high <= low:
        return low
    target = round(low + (pct / 100.0) * (high - low))
    return max(low, min(high, target))


def step_toward(
    last_commanded: int, target: int, max_step_per_tick: int, deadband: int,
) -> int | None:
    """Move at most `max_step_per_tick` from `last_commanded` towards `target`.

    Returns None when the (rate-limited) new value is within `deadband` of
    what was last commanded, i.e. no update is needed this tick.
    """
    delta = target - last_commanded
    if delta > max_step_per_tick:
        next_value = last_commanded + max_step_per_tick
    elif delta < -max_step_per_tick:
        next_value = last_commanded - max_step_per_tick
    else:
        next_value = target

    if abs(next_value - last_commanded) <= deadband:
        return None
    return next_value


def compute_follower_command(
    leader: LeaderMotorState,
    last_commanded: int,
    joint: JointMap,
    config: FollowerConfig,
    follower_range: tuple[int, int],
) -> int | None:
    """Decide the next raw byte to command on one follower servo.

    `last_commanded` is what we last told this follower motor to go to (not
    a telemetry read -- see `RateLimiterTable`), used as the rate-limiter's
    baseline. `follower_range` is the safe [low, high] span for this servo
    (see `resolve_follower_range`). Returns None when no update is needed
    (leader fault, stale zero position, or within the deadband).
    """
    # Skip if leader has a real fault (voltage dips don't count).
    if (leader.error_status & ~STATUS_VOLTAGE_BIT) != 0:
        return None

    # Zero position usually means the motor hasn't reported yet.
    if leader.present_position == 0:
        return None

    pct = leader_percent(leader, joint.invert, joint.leader_lo_pct, joint.leader_hi_pct)
    low, high = follower_range
    target = project_percentage(pct, low, high)
    return step_toward(last_commanded, target, config.max_step_per_tick, config.deadband)


@dataclass
class LeaderSmoother:
    """Exponential moving average per leader motor id, to take the edge off
    per-tick encoder noise before it ever reaches the position/yaw math.

    A raw present_position reading jitters by a few encoder steps tick to
    tick even when the leader is physically still; without filtering, that
    noise gets amplified by the percentage projection and shows up as visible
    twitch on the follower. `alpha` close to 1.0 is ~no smoothing (trusts
    each new sample fully); smaller values smooth more but add lag --
    roughly `tick_interval / alpha` of settling time.

    Averages in delta space via `signed_shortest_delta`, not a plain scalar
    average of the raw positions -- a joint can sit near the encoder's wrap
    point (e.g. center at step 4090), and a naive `alpha*new + (1-alpha)*prev`
    across that boundary (prev=4090, new=5) lands on a garbage midpoint
    (~2660) that's nowhere near either real reading, feeding a wrong
    direction to the wrap-aware math downstream (`signed_shortest_delta`,
    `normalize_position`) that assumes its input is a real position.

    Never returns exactly 0 for a genuinely-smoothed reading, even though 0
    is a mathematically valid point on the wrap. 0 is this codebase's "not
    reporting" sentinel (checked against `present_position` everywhere
    downstream, including the movement-axis fail-safe), so a smoothed value
    that legitimately lands there -- routine for a joint parked at the wrap
    point, not a rare coincidence -- would get misread as "leader gone" and
    spuriously drive an axis toward neutral. Nudged to the nearest
    non-sentinel step instead, in the direction the reading was already
    moving.

    Assumes `raw_position` is a real reading -- callers must not pass 0
    (not reporting) through here; skip the call entirely instead, same as
    `startup.sample_leader_rest_state` already does, so a dropout can't be
    smoothed into something that no longer looks like one. Deciding what
    counts as real data is the caller's job, not this class's.
    """
    alpha: float
    state: dict[int, float] = field(default_factory=dict)

    def update(self, motor_id: int, raw_position: int) -> int:
        prev = self.state.get(motor_id)
        if prev is None:
            self.state[motor_id] = float(raw_position)
            return raw_position

        delta = signed_shortest_delta(raw_position, round(prev) % LEADER_MAX_STEPS, LEADER_MAX_STEPS)
        self.state[motor_id] = (prev + self.alpha * delta) % LEADER_MAX_STEPS
        result = round(self.state[motor_id]) % LEADER_MAX_STEPS
        if result == 0:
            result = 1 if delta >= 0 else LEADER_MAX_STEPS - 1
        return result


@dataclass
class AxisState:
    """Tracks the last commanded byte for one rate-controlled movement axis
    (move_yaw or move_x) across ticks."""
    last_commanded: int = MOVEMENT_NEUTRAL


def signed_shortest_delta(position: int, center: int, max_steps: int) -> int:
    """Signed deviation of `position` from `center`, taking the encoder's

    shorter way around instead of the raw difference -- e.g. center=4090,
    position=5 is +11 (wrapped past the zero crossing), not -4085. Matters
    for a joint used as a rotation control, which can plausibly sit near or
    cross the encoder's wrap point during normal use.
    """
    delta = position - center
    half = max_steps / 2
    if delta > half:
        delta -= max_steps
    elif delta < -half:
        delta += max_steps
    return delta


def compute_axis_command(
    leader: LeaderMotorState | None,
    leader_center: int,
    last_commanded: int,
    config: AxisConfig,
) -> int | None:
    """Decide the next byte for one rate-controlled movement axis (move_yaw
    or move_x), binary-target style -- see README "Movement axes".

    `leader=None` (motor missing from this tick's frame), a real fault, or a
    stale zero-position reading all ramp toward neutral rather than
    returning None -- a movement axis is a standing command, so treating bad
    leader data as "skip this tick" would leave the dog moving indefinitely
    at whatever it was last told. Matches `_mixed_contribution`'s fail-safe
    posture (contributes 0, i.e. drives toward neutral).
    """
    if (
        leader is None
        or (leader.error_status & ~STATUS_VOLTAGE_BIT) != 0
        or leader.present_position == 0
    ):
        return step_toward(last_commanded, MOVEMENT_NEUTRAL, config.ramp_step_per_tick, config.deadband)

    delta = signed_shortest_delta(leader.present_position, leader_center, LEADER_MAX_STEPS)
    if config.invert:
        delta = -delta

    if abs(delta) <= config.deadzone_steps:
        target = MOVEMENT_NEUTRAL
    elif delta > 0:
        target = 255  # matches Q / W in the web UI
    else:
        target = 1  # matches E / S in the web UI

    return step_toward(last_commanded, target, config.ramp_step_per_tick, config.deadband)


def _mixed_contribution(
    leader: LeaderMotorState | None, input_cfg: MixedAxisInput | None, deadzone_pct: float,
) -> float:
    """One input's 0-100% contribution to a MixedAxisConfig -- see
    `compute_mixed_axis_command` and README "Mixed forward/backward". 0 if
    unconfigured, not reporting, faulted, or `rest_pct` unresolved -- fails
    toward "no push from this side" rather than raising.

    Dead-zones *before* rewindowing (`deadzone_pct` of raw deviation from
    `rest_pct`), not just the byte-level `deadband` at the output end --
    a narrow rest_pct-vs-limit_pct window would otherwise turn ordinary
    sensor noise into a meaningful fraction of full signal.
    """
    if input_cfg is None or leader is None or input_cfg.rest_pct is None:
        return 0.0
    if (leader.error_status & ~STATUS_VOLTAGE_BIT) != 0:
        return 0.0
    if leader.present_position == 0:
        return 0.0
    raw_pct = normalize_position(leader.present_position, leader.range_min, leader.range_max, LEADER_MAX_STEPS)
    if abs(raw_pct - input_cfg.rest_pct) <= deadzone_pct:
        return 0.0
    return rewindow_percentage(raw_pct, input_cfg.rest_pct, input_cfg.limit_pct)


def compute_mixed_axis_command(
    forward_leader: LeaderMotorState | None,
    backward_leader: LeaderMotorState | None,
    last_commanded: int,
    config: MixedAxisConfig,
) -> int | None:
    """Decide the next byte for a mixed/proportional movement axis -- see
    config.MixedAxisConfig and README "Mixed forward/backward". Unlike
    `compute_axis_command` (binary target pick), scales continuously:
    net = forward% - backward% (from `_mixed_contribution`, each already
    fail-safe to 0), mapped onto [1, 255] with 128 as the zero point.
    """
    fwd_pct = _mixed_contribution(forward_leader, config.forward, config.deadzone_pct)
    back_pct = _mixed_contribution(backward_leader, config.backward, config.deadzone_pct)
    net = max(-1.0, min(1.0, (fwd_pct - back_pct) / 100.0))

    target = MOVEMENT_NEUTRAL + round(net * (MOVEMENT_NEUTRAL - 1))
    target = max(1, min(255, target))

    return step_toward(last_commanded, target, config.ramp_step_per_tick, config.deadband)


@dataclass
class RateLimiterTable:
    """Tracks the last commanded raw position per follower motor id.

    Seeded from the follower's own telemetry (or a startup reset) the first
    time a motor id is set, so the first tracking tick doesn't jump from some
    arbitrary baseline.
    """
    last_commanded: dict[int, int] = field(default_factory=dict)

    def get(self, follower_id: int, telemetry_position: int) -> int:
        if follower_id not in self.last_commanded:
            self.last_commanded[follower_id] = telemetry_position
        return self.last_commanded[follower_id]

    def set(self, follower_id: int, value: int) -> None:
        self.last_commanded[follower_id] = value

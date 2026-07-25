"""Teleop tuning constants, per-side config, joint mapping, and startup tunables.

Leader (Elrobot) and follower (Dogzilla arm) speak completely different
protocols, so their tunables live in separate config objects:

  - LEADER_MAX_STEPS: the ST3215 encoder resolution used to interpret the
    leader's calibrated arc (range_min/range_max).
  - FollowerConfig: tuning for the Dogzilla's raw 0-255 servo registers,
    which have no calibration concept and no current telemetry.
"""

from dataclasses import dataclass, field
from pathlib import Path

# How often to recompute follower goals from the latest leader state.
TELEOP_REFRESH_INTERVAL_S = 0.020  # 50 Hz

# Inference data older than this is considered stale and skipped.
MAX_DATA_AGE_NS = 100_000_000  # 100 ms

# ST3215 encoder resolution, used only to interpret the leader's calibrated
# arc (range_min/range_max come from the leader station's own calibration).
LEADER_MAX_STEPS = 4096

# Leader motor ids to characterize at startup (M1-M8).
LEADER_MOTOR_IDS = list(range(1, 9))

# How long to sample the leader's resting position before starting live
# control, and at what cadence.
REST_SAMPLE_DURATION_S = 2.0
REST_SAMPLE_INTERVAL_S = 0.02

# If a leader motor's sampled positions span more than this many encoder
# steps during the rest window, it probably wasn't actually at rest --
# logged as a warning, not a hard failure.
REST_JITTER_WARN_STEPS = 15

# If a movement-axis leader motor's resting position falls within this many
# percentage points of either end of its own calibrated arc, the axis will
# only ever be able to detect deviation in one direction (there's no room to
# move the other way from a position already near a hard limit) -- flagged
# as a warning, not a hard failure, since a deliberately one-directional
# control might be exactly what's wanted.
AXIS_CENTER_EXTREME_PCT = 15.0

# Known-safe home pose for the follower's arm servos, sent once at startup
# before live tracking begins -- matches the Dogzilla driver's own
# DEFAULT_SERVO_POSITIONS for these ids (see
# software/drivers/yahboom-dogzilla-lite/src/shared.rs). Note: 52's value
# here (255) actually falls inside FOLLOWER_DEFAULT_LIMITS below -- it gets
# clamped to that range at reset time, same as any other target.
#
# 51 (gripper): per the real hardware (confirmed empirically, not from the
# proto/viewer docs, which say the opposite and are wrong for this rig --
# see "Gripper ranges and direction" in the README), 0 = closed, 255 = open.
# So 51: 0 below resets the gripper *closed*, not open -- despite this
# constant's own name, "home" here means "the driver's own default pose",
# not "safe/open". Watch for this on first run.
FOLLOWER_HOME_POSITIONS: dict[int, int] = {51: 0, 52: 255, 53: 0}

# No default self-collision guard -- explicitly disabled per user
# instruction (no automatic safety limits on any follower servo). There was
# previously a geometric estimate here (derived from the 3D model in
# software/station/clients/station-viewer/src/yahboom_dogzilla_lite/
# YahboomDogzillaLiteViewer.tsx, since there's no URDF for this robot)
# capping 52 (shoulder) at raw 200 to keep the gripper clear of the
# head/screen zone -- that was never verified against the real hardware's
# exact dimensions and has been removed. Every follower servo now uses only
# the generic margin-padded 0-255 span (see resolve_follower_range) unless
# you explicitly pass --follower-limits / a YAML follower_limits entry.
FOLLOWER_DEFAULT_LIMITS: dict[int, tuple[int, int]] = {}

# How long to let the startup reset's software ramp counter converge before
# giving up and starting live control anyway (this loop finishes in ~1.3s
# for a full 0-255 sweep at the default max_step_per_tick -- 8s is generous
# headroom, not a real physical bound).
RESET_TIMEOUT_S = 8.0

# Extra fixed wait after the reset ramp's commanded values reach their
# targets, to give the physical servo time to actually catch up before live
# tracking starts. This is a genuine gap: the yahboom-dogzilla-lite driver's
# servo_positions telemetry is just an echo of the last-written byte (no
# real closed-loop position sensing, no current/moving-status field either
# -- confirmed by reading the Rust driver's protocol/feedback-packet code),
# so there is no way to actually detect physical arrival. This value is
# sized from the driver's own simulator model (sim.rs: SIM_MAX_UNITS_PER_SEC
# = 255, scaled by arm_servo_speed/255 for the shoulder/base servos, default
# arm_servo_speed=127 -> ~127 raw units/sec -> ~2.0s for a full 0-255 sweep;
# the gripper always moves at the fixed 255 units/sec rate -> ~1.0s) plus
# margin -- NOT a verified real-hardware spec, since arm_servo_speed isn't
# currently set by this script and the real board's actual default speed is
# undocumented anywhere in this repo. If the arm still hasn't visibly
# finished moving by the time live control starts, raise this.
RESET_SETTLE_S = 2.5

# 0x80: neutral/stop for MovementCommand.move_x/move_y/move_yaw.
MOVEMENT_NEUTRAL = 128

# Default EMA smoothing factor applied to leader present-position readings
# before they're used for anything (position joints or yaw). 1.0 = no
# smoothing (trust every raw sample); lower values trade a bit of latency
# for less visible twitch from encoder/transport noise. See
# mirror.LeaderSmoother.
LEADER_SMOOTHING_ALPHA_DEFAULT = 0.35


@dataclass
class FollowerConfig:
    """Tuning for writes to the Dogzilla's raw 0x00-0xFF servo registers.

    Unlike the ST3215 side, there's no per-motor calibration to read (the
    driver just exposes a fixed 8-bit register) and no current telemetry, so
    there's no way to do current-based overload protection here. The rate
    limit (`max_step_per_tick`) is the substitute: it bounds how fast a
    commanded position can change, which is a soft-start/stop stand-in for
    the ST3215 side's speed/accel envelope and the closest thing to
    overload protection available on this driver.
    """

    # Ignore movement smaller than this many raw units (0-255).
    deadband: int = 2

    # Default padding from each end of the 0-255 register range, used for any
    # follower id that isn't given an explicit range via --follower-limits.
    margin: int = 5

    # Max change in raw position per tick. At the default 50 Hz refresh rate
    # this bounds a full 0->255 sweep to roughly (255 / max_step_per_tick)
    # ticks -- 4 gives ~64 ticks, ~1.3s full travel.
    max_step_per_tick: int = 4


@dataclass
class AxisConfig:
    """Tuning for one binary rate-controlled movement axis (yaw or forward/
    backward), driven by a leader motor's deviation from its resting
    position. Used for both --yaw-* and --fwd-* -- two independent
    instances, one per axis.

    Disabled unless `leader_id` is set. When enabled, the leader motor's
    deviation from its sampled resting position picks a direction, not a
    proportional rate: past `deadzone_steps` raw encoder steps from center
    it targets the same full-throw byte the web UI's keys send (255 or 1)
    -- Q/E for yaw, W/S for forward/backward, both using the identical
    convention -- exactly matching "press and hold" one of those keys.
    Within the deadzone it targets neutral (128, stop).

    Deliberately step-based rather than a percentage of the leader's
    calibrated arc: the leader motor driving an axis (e.g. a base-rotation
    or shoulder-pitch joint) may never have been calibrated, since
    calibration is otherwise only needed for position mirroring. An earlier
    percentage-based version silently never fired when
    range_min == range_max == 0 (uncalibrated) -- this doesn't depend on
    calibration at all.

    The web UI's keys themselves snap instantly with zero ramp --
    `ramp_step_per_tick` is what adds the missing "speed up / slow down"
    feel on top of that target.
    """

    leader_id: int | None = None
    invert: bool = False

    # Raw ST3215 encoder steps (0-4095 = one full revolution) of deviation
    # from the resting position treated as "still centered, don't move".
    deadzone_steps: int = 100

    # Max change in the commanded byte per tick -- the "momentum" knob. At
    # 50 Hz, 6/tick ramps from stop to full throw (127 units) in about 20
    # ticks (~0.4s).
    ramp_step_per_tick: int = 6

    deadband: int = 2

    # Override for where "center" (the deadzone's reference point) sits, as
    # a percentage of the leader motor's own calibrated arc. None (default)
    # means "wherever the operator actually rests the arm" -- the sampled
    # rest-position median (see startup.sample_leader_rest_state). Set this
    # when the natural rest position sits at (or near) a hard joint limit --
    # which makes the axis only ever detect one direction from *that* point
    # (see AXIS_CENTER_EXTREME_PCT) -- and you'd rather the operator actively
    # hold the arm at a chosen percentage of its arc to get both directions,
    # instead of wherever it naturally settles.
    center_pct: float | None = None

    @property
    def leader_ids(self) -> set[int]:
        return {self.leader_id} if self.leader_id is not None else set()

    @property
    def enabled(self) -> bool:
        return self.leader_id is not None


@dataclass
class MixedAxisInput:
    """One leader motor's contribution to a MixedAxisConfig movement axis.

    Contribution ramps linearly from 0% (no push) at `rest_pct` to 100%
    (full push) at `limit_pct`, clamped beyond `limit_pct`. `rest_pct` can
    be greater than `limit_pct` -- e.g. rest at 93%, limit at 50% -- meaning
    the contribution grows as the leader moves *down* toward 50%, not up.

    `rest_pct: None` (the default) means "use the live rest-sample" (see
    `main._resolve_axis_center`), the same safety posture the single-leader
    AxisConfig already uses -- resolved once at startup, filled into this
    field in place. Only set it explicitly if you deliberately want a fixed
    reference point instead of wherever the arm actually rests this session.
    A hardcoded value here previously caused a real incident: the follower
    immediately walked backward at full ramp because the configured
    rest_pct (a one-off earlier estimate) didn't match the arm's actual live
    rest position closely enough, and this input's zero-deadzone proportional
    math treated that gap as a deliberate command. Prefer the default.
    """
    leader_id: int
    limit_pct: float
    rest_pct: float | None = None


@dataclass
class MixedAxisConfig:
    """A proportional movement axis mixed from up to two independent leader
    inputs -- one pushing toward the follower's positive extreme (255), one
    toward its negative extreme (1), like a two-trigger RC throttle (one
    pedal for forward, one for reverse, sharing a single output).

    net = forward.contribution% - backward.contribution%, mapped linearly
    onto the follower byte (128=stop, 255=full one way, 1=full the other).

    Unlike AxisConfig (binary target pick, matches a single web-UI key),
    this is proportional -- push further into an input's [rest_pct,
    limit_pct] window, get a stronger signal, not just on/off. Only
    expressible via a YAML --config file (see load_config_file) -- there's
    no CLI-flag equivalent.
    """
    forward: MixedAxisInput | None = None
    backward: MixedAxisInput | None = None
    ramp_step_per_tick: int = 6
    deadband: int = 2

    # Percentage points of deviation from an input's rest_pct treated as
    # "still at rest, no push" -- a genuine buffer against sensor noise and
    # rest-position imprecision, applied *before* rewindowing (so it's a
    # real dead zone, not just the ~2-byte output deadband `deadband` gives
    # you). Given a rest_pct-vs-limit_pct window can be narrow (M3's is 43
    # points wide), even a few points of real-world mismatch is a
    # meaningful fraction of full signal without this.
    deadzone_pct: float = 5.0

    @property
    def leader_ids(self) -> set[int]:
        ids: set[int] = set()
        if self.forward is not None:
            ids.add(self.forward.leader_id)
        if self.backward is not None:
            ids.add(self.backward.leader_id)
        return ids

    @property
    def enabled(self) -> bool:
        return self.forward is not None or self.backward is not None


@dataclass(frozen=True)
class JointMap:
    """One leader-motor -> follower-motor pairing.

    Leader position is mapped as a percentage of its own calibrated arc
    (range_min/range_max from the leader station's calibration), then
    projected linearly onto the follower's safe raw-byte range (see
    `mirror.resolve_follower_range`).

    `invert` flips the leader's 0-100% position before projecting it onto
    the follower's range. Use it when the two mechanisms move in opposite
    senses, e.g. a leader gripper that opens as its position increases
    paired with a follower gripper that closes as its position increases.

    `leader_lo_pct`/`leader_hi_pct` re-window the leader's percentage before
    projection (see `mirror.rewindow_percentage`) -- default (0, 100) is a
    no-op (the full arc drives the full follower range). Set a narrower
    window, e.g. (0, 50), to let only part of the leader's travel drive the
    follower's *entire* output range, with the rest of the leader's travel
    clamping to the nearest endpoint. Only expressible via a YAML config
    file (see `load_config_file`) -- not the `--map` CLI flag.

    Either endpoint can be `None` instead of a fixed percentage, meaning
    "use this session's live rest-sample of `leader_id`" -- the same safe
    default posture `AxisConfig.center_pct`/`MixedAxisInput.rest_pct` already
    use, for when the "ideal" reference point (e.g. "M6 rests at 50%") is
    only approximately known and shouldn't be hardcoded. `main._resolve_joint_windows`
    resolves any `None` endpoint into a concrete percentage right after the
    startup rest-sample (i.e. right after the operator presses SPACE),
    replacing the `JointMap` with a resolved copy before live tracking
    starts -- nothing downstream of that (`mirror.py`, the teleop loop) ever
    sees `None`.
    """

    leader_id: int
    follower_id: int
    invert: bool = False
    leader_lo_pct: float | None = 0.0
    leader_hi_pct: float | None = 100.0


def parse_joint_map(spec: str) -> list[JointMap]:
    """Parse `--map` into a list of JointMap.

    Format: comma-separated `leader_id:follower_id[:inv]`, e.g.:
        "8:51"           leader motor 8 drives follower motor 51
        "8:51:inv,7:52"  motor 8->51 inverted, motor 7->52 direct
    """
    joints = []
    for raw in spec.split(","):
        raw = raw.strip()
        if not raw:
            continue
        parts = raw.split(":")
        if len(parts) not in (2, 3):
            raise ValueError(f"Invalid --map entry '{raw}', expected 'leader_id:follower_id[:inv]'")
        leader_id = int(parts[0])
        follower_id = int(parts[1])
        invert = False
        if len(parts) == 3:
            if parts[2] != "inv":
                raise ValueError(f"Invalid --map entry '{raw}', third field must be 'inv'")
            invert = True
        joints.append(JointMap(leader_id=leader_id, follower_id=follower_id, invert=invert))
    if not joints:
        raise ValueError("--map produced no joint pairs")
    return joints


def parse_follower_limits(spec: str) -> dict[int, tuple[int, int]]:
    """Parse `--follower-limits` into {follower_id: (low, high)}.

    Format: comma-separated `follower_id:low-high`, e.g.:
        "52:80-220,53:20-180"

    Restricts how far a follower servo is ever allowed to travel -- use this
    to keep a joint out of a known self-collision zone (e.g. the gripper
    hitting the dog's own screen at certain arm angles). Any follower id not
    listed here just uses FollowerConfig's default margin-padded 0-255 span.
    """
    limits: dict[int, tuple[int, int]] = {}
    spec = spec.strip()
    if not spec:
        return limits
    for raw in spec.split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            id_part, range_part = raw.split(":")
            low_str, high_str = range_part.split("-")
            follower_id = int(id_part)
            low, high = int(low_str), int(high_str)
        except ValueError:
            raise ValueError(f"Invalid --follower-limits entry '{raw}', expected 'follower_id:low-high'")
        if not (0 <= low < high <= 255):
            raise ValueError(f"Invalid --follower-limits entry '{raw}': need 0 <= low < high <= 255")
        limits[follower_id] = (low, high)
    return limits


@dataclass
class ConfigFile:
    """Everything a `--config path.yaml` file can specify -- see `load_config_file`.

    Covers the same ground as --leader-server/--follower-server/--map/
    --follower-limits/--yaw-*/--fwd-* combined, plus JointMap.leader_range_pct
    and AxisConfig.center_pct, which have no CLI-flag equivalent (the --map
    string syntax doesn't have room for them without getting unreadable).
    Session-level flags (--verbose, --rest-sample-s, --calib-log,
    --leader-smoothing-alpha) stay CLI-only regardless of --config.
    """

    leader_server: str
    follower_server: str
    leader_bus: str = "auto"
    follower_device: str = "auto"
    joints: list[JointMap] = field(default_factory=list)
    yaw: AxisConfig = field(default_factory=AxisConfig)
    fwd: AxisConfig | MixedAxisConfig = field(default_factory=AxisConfig)
    follower_limits: dict[int, tuple[int, int]] = field(default_factory=dict)


def _axis_config_from_dict(d: dict | None) -> AxisConfig:
    if not d:
        return AxisConfig()
    defaults = AxisConfig()
    center_pct = d.get("center_pct")
    return AxisConfig(
        leader_id=int(d["leader_id"]) if d.get("leader_id") is not None else None,
        invert=bool(d.get("invert", False)),
        deadzone_steps=int(d.get("deadzone_steps", defaults.deadzone_steps)),
        ramp_step_per_tick=int(d.get("ramp_step_per_tick", defaults.ramp_step_per_tick)),
        deadband=int(d.get("deadband", defaults.deadband)),
        center_pct=(float(center_pct) if center_pct is not None else None),
    )


def _mixed_input_from_dict(d: dict | None) -> MixedAxisInput | None:
    if not d:
        return None
    rest_pct_raw = d.get("rest_pct")
    rest_pct = float(rest_pct_raw) if rest_pct_raw is not None else None
    limit_pct = float(d["limit_pct"])
    if rest_pct is not None and rest_pct == limit_pct:
        raise ValueError(f"rest_pct and limit_pct must differ (both {rest_pct}) for leader_id {d.get('leader_id')}")
    return MixedAxisInput(leader_id=int(d["leader_id"]), rest_pct=rest_pct, limit_pct=limit_pct)


def _fwd_config_from_dict(d: dict | None) -> AxisConfig | MixedAxisConfig:
    """`fwd:` is either a single-leader AxisConfig (same shape as `yaw:`) or,
    if it has a `forward` and/or `backward` sub-key, a mixed two-leader
    MixedAxisConfig -- see MixedAxisConfig's docstring for when to use which.
    """
    if d and ("forward" in d or "backward" in d):
        defaults = MixedAxisConfig()
        return MixedAxisConfig(
            forward=_mixed_input_from_dict(d.get("forward")),
            backward=_mixed_input_from_dict(d.get("backward")),
            ramp_step_per_tick=int(d.get("ramp_step_per_tick", defaults.ramp_step_per_tick)),
            deadband=int(d.get("deadband", defaults.deadband)),
            deadzone_pct=float(d.get("deadzone_pct", defaults.deadzone_pct)),
        )
    return _axis_config_from_dict(d)


def _joint_range_endpoint(value) -> float | None:
    """One `leader_range_pct` endpoint: a percentage, or the string `"rest"`
    meaning "resolve from this session's live rest-sample of this joint's
    leader_id" (see `JointMap` and `main._resolve_joint_windows`).
    """
    if isinstance(value, str) and value.strip().lower() == "rest":
        return None
    return float(value)


def _joint_from_dict(d: dict) -> JointMap:
    lo, hi = d.get("leader_range_pct", [0.0, 100.0])
    return JointMap(
        leader_id=int(d["leader_id"]),
        follower_id=int(d["follower_id"]),
        invert=bool(d.get("invert", False)),
        leader_lo_pct=_joint_range_endpoint(lo),
        leader_hi_pct=_joint_range_endpoint(hi),
    )


def load_config_file(path: Path) -> ConfigFile:
    """Parse a `--config` YAML file into a ConfigFile.

    See `configs/` in this directory for an example. Required top-level
    keys: `leader_server`, `follower_server`. Everything else is optional
    with the same defaults as the equivalent CLI flags; `yaw`/`fwd` sections
    are simply omitted to disable that axis (matching --yaw-leader-id/
    --fwd-leader-id defaulting to None).
    """
    import yaml

    with open(path) as f:
        data = yaml.safe_load(f) or {}

    missing = [k for k in ("leader_server", "follower_server") if k not in data]
    if missing:
        raise ValueError(f"{path}: missing required key(s): {missing}")

    follower_limits: dict[int, tuple[int, int]] = {}
    for follower_id, bounds in (data.get("follower_limits") or {}).items():
        low, high = bounds
        follower_limits[int(follower_id)] = (int(low), int(high))

    return ConfigFile(
        leader_server=str(data["leader_server"]),
        follower_server=str(data["follower_server"]),
        leader_bus=str(data.get("leader_bus", "auto")),
        follower_device=str(data.get("follower_device", "auto")),
        joints=[_joint_from_dict(j) for j in data.get("joints", [])],
        yaw=_axis_config_from_dict(data.get("yaw")),
        fwd=_fwd_config_from_dict(data.get("fwd")),
        follower_limits=follower_limits,
    )

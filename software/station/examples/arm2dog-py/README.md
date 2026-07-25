# arm2dog

Bridge specific ST3215 leader-arm joints onto specific Dogzilla follower-arm
joints, across two stations, by explicit motor-id pairing.

The leader (Elrobot) and the follower (the robot dog's arm) speak two
completely different protocols, not just different motor ids:

- **Leader**: an ST3215 bus, read from `st3215/inference`. Each motor has a
  station-calibrated arc (`range_min`/`range_max`) and reports current draw.
- **Follower**: the dog's arm/gripper (ids `51`/`52`/`53`) is **not** an
  ST3215 bus, even though it uses ST3215-compatible servos physically. It's
  driven through the `yahboom-dogzilla-lite` driver's own protocol, read
  from `yahboom-dogzilla-lite/inference`. Each servo is a raw `0-255`
  register (`ServoCommand{servo_id, position}`, see
  `software/drivers/yahboom-dogzilla-lite/src/shared.rs`'s `SERVO_MAP`) with
  no calibration and no current telemetry.

Because of that, this isn't just an id remap of `st3215-remote-teleop-py` --
the follower side is a different command path entirely, and the "different
gripper ranges" problem is solved differently on each side (see below).

## Testing walkthrough

Work through these in order -- each step only adds one new thing to watch,
so if something looks wrong you know exactly which flag caused it. Ctrl+C
is always safe (see "Stop / pause" below); nothing here needs a clean
shutdown to be safe to interrupt. Add `-v`/`--verbose` to any of these if
you want the per-second connection health stats and full config echo --
default output is deliberately terse (see "What you'll see" below).

Substitute your own `--leader-server`/`--follower-server` throughout --
these examples use `192.168.68.66` (Elrobot) / `192.168.68.56` (dog).

**0. First-time setup**, if `uv run` fails with `ModuleNotFoundError` for
`yahboom_dogzilla_lite` -- see the subsection right below this list.

**1. Gripper only** -- the one pair whose direction is already confirmed
(see "Gripper ranges and direction" below), so this just proves the
plumbing (both stations reachable, protobufs generated, reset-to-home runs,
calib.log gets written):

```bash
uv run python main.py \
    --leader-server 192.168.68.66 --follower-server 192.168.68.56 \
    --map 8:51
```

Watch the console for the startup sequence (reset ramp -> SPACE prompt ->
rest-sample -> calibration snapshot written to `calib.log`),
then open `calib.log` and sanity-check the preview line for `8 -> 51`
against where the leader gripper actually was. Then open/close the leader
gripper and confirm the dog gripper follows the same way.

**2. Add the other two arm joints, watch direction.** `6:52` and `4:53`
haven't been empirically checked (unlike the gripper):

```bash
uv run python main.py \
    --leader-server 192.168.68.66 --follower-server 192.168.68.56 \
    --map "8:51,6:52,4:53"
```

Move M6 and M4 slowly, one at a time. If either joint moves opposite to the
leader, stop (Ctrl+C) and add `:inv` to that pair, e.g. `--map "8:51,6:52:inv,4:53"`.
Also watch `52` doesn't get anywhere near the dog's screen -- **there is no
default guard against this** (see "Safety" below), so this is on you to
confirm visually every time, not something the script prevents.

**3. Yaw alone, watch direction and feel.** Test this separately from the
arm joints first so an unexpected `--yaw-invert` doesn't compound with an
unconfirmed arm-joint direction:

```bash
uv run python main.py \
    --leader-server 192.168.68.66 --follower-server 192.168.68.56 \
    --map 8:51 --yaw-leader-id 1
```

Leave M1 centered (from the rest-sample) and confirm the dog doesn't
rotate. Then rotate M1 clockwise (viewed from above) and check which way the
dog spins -- if it's backwards, add `--no-yaw-invert` (confirmed on this rig
with M1, `--yaw-invert` is already `True` by default). Try `--yaw-ramp-step`
higher (snappier) or lower (gentler) to taste; `--yaw-deadzone-steps` higher
if it rotates when M1 is nominally centered but slightly jittery.

**3b. Forward/backward alone, same idea, separately from yaw:**

```bash
uv run python main.py \
    --leader-server 192.168.68.66 --follower-server 192.168.68.56 \
    --map 8:51 --fwd-leader-id 2
```

Leave M2 centered and confirm the dog stays put. Move M2 the one direction
it can actually go from rest (see "`--fwd-invert` defaults to `True`" below
-- M2 rests at a hard limit on this rig, so only one direction is
reachable) and check the dog moves the way you expect -- if it's backwards,
add `--no-fwd-invert`. Same `--fwd-ramp-step`/`--fwd-deadzone-steps` tuning
as yaw. Give it room -- unlike yaw (rotates in place), this one translates
the whole robot. Watch the console at startup too: if the resting position
turns out to be near a joint limit, it'll say so.

**4. Full combined run**, once 1-3b all look right:

```bash
uv run python main.py \
    --leader-server 192.168.68.66 --follower-server 192.168.68.56 \
    --map "8:51,6:52:inv,4:53" --yaw-leader-id 1 --fwd-leader-id 2
```

(`:inv` here is illustrative -- only include it if step 2 actually showed
you need it. `--yaw-invert`/`--fwd-invert` aren't shown because both are
already `True` by default -- add `--no-yaw-invert`/`--no-fwd-invert` instead
if steps 3/3b showed you need either off.)

**5. If motion looks twitchy**, see "Smoothing / jitter" below --
`--leader-smoothing-alpha` is the first thing to try (lower = smoother).

### First-time setup: generate the Dogzilla Python protobuf bindings

`target/gen_python/protobuf/drivers/yahboom_dogzilla_lite/` isn't generated
by default (unlike `st3215`, no prior Python example needed it). If `uv run`
fails with `ModuleNotFoundError` for `yahboom_dogzilla_lite`, generate it
from the repo root:

```bash
python3 shared/gremlin_py/gremlin.py \
    --proto-root protobufs/drivers \
    --target-root target/gen_python/protobuf/drivers \
    --project-root . \
    --gremlin-import-path "shared.gremlin_py.gremlin"
```

## YAML config files

`--map`'s `leader_id:follower_id[:inv]` string syntax can't express things
some mappings need:
- **A fixed percentage center for a movement axis**, instead of wherever the
  leader happens to rest -- e.g. a joint whose natural rest position sits at
  a hard limit (one-directional otherwise, see "Movement axes" below).
- **A leader-side percentage window** for a position joint -- letting only
  part of a leader motor's travel drive the follower's *entire* output
  range, with the rest clamping to the nearest endpoint.
- **Mixing two leader inputs into one proportional movement axis** -- one
  pushing forward, one pushing backward, like a two-trigger RC throttle,
  instead of the single-leader binary Q/E-style on/off (see "Movement axes"
  below for why this is a genuinely different control, not a variant of the
  single-leader one).

All three are YAML-only (`AxisConfig.center_pct`, `JointMap.leader_range_pct`,
`MixedAxisConfig`), loaded via `--config path.yaml` instead of
`--leader-server`/`--follower-server`/`--map`/`--yaw-*`/`--fwd-*`/
`--follower-limits` (which are all ignored when `--config` is given).
Session-level flags (`--verbose`, `--rest-sample-s`, `--calib-log`,
`--leader-smoothing-alpha`) still come from the CLI either way. See
`configs/three-axes-test.yaml` for a worked example currently covering yaw
and the arm (M1 -> yaw, M6 -> follower `52` using only the leader's lower
half of travel `[0, 50]`, M8 -> follower `51` gripper) -- forward/backward
(`MixedAxisConfig`) was tried and removed again while yaw + arm get proven
out on their own; the mixed-axis code is still there, just unused by this
file for now:

```bash
uv run python main.py --config configs/three-axes-test.yaml
```

`config.load_config_file` is the schema's source of truth --
`ConfigFile`/`_axis_config_from_dict`/`_fwd_config_from_dict`/
`_joint_from_dict` in `config.py` document every field and its default. A
`fwd:` section is parsed as a `MixedAxisConfig` if it has a `forward:` and/or
`backward:` sub-key, otherwise as the single-leader `AxisConfig` shape (same
as `yaw:`).

## Flags

| Flag                 | Required | Notes                                                      |
| -------------------- | -------- | ----------------------------------------------------------- |
| `--config`           | no*      | Load everything below from a YAML file instead -- see "YAML config files" above. |
| `--leader-server`    | yes*     | Station hostname/IP for the leader ST3215 bus (Elrobot arm). |
| `--leader-bus`       | no       | Bus serial, or `auto` (default) for a single-bus station.    |
| `--follower-server`  | yes*     | Station hostname/IP for the follower Dogzilla device.        |
| `--follower-device`  | no       | Device serial, or `auto` (default) for a single-device station. |
| `--map`              | yes*     | Comma-separated `leader_id:follower_id[:inv]` pairs.         |

<sup>* `--leader-server`/`--follower-server`/`--map` are required unless `--config` is given, in which case they (and `--leader-bus`/`--follower-device`/`--follower-limits`/`--yaw-*`/`--fwd-*`) are ignored.</sup>
| `-v`, `--verbose`    | no       | Show per-second connection health stats and detailed config echo. Default output is startup confirmations, warnings, and errors only -- see "What you'll see" below. |
| `--follower-limits`  | no       | Comma-separated `follower_id:low-high` safe-range overrides, e.g. `"52:80-220,53:20-180"`. No default limits are applied to any id -- see "Safety" below. Any id not listed uses the margin-padded `0-255` span. |
| `--rest-sample-s`    | no       | Seconds to sample the leader's resting position at startup (default `2.0`). |
| `--calib-log`        | no       | Path to append calibration snapshots to (default `calib.log` next to `main.py`). |
| `--leader-smoothing-alpha` | no | EMA smoothing factor (`0-1`) applied to leader position readings before any other math sees them, `1.0` = no smoothing (default `0.35`). See "Smoothing / jitter" below. |
| `--yaw-leader-id`    | no       | Leader motor id (e.g. `1` for M1) that drives follower rotate-in-place. Omit to disable yaw control entirely (default). |
| `--yaw-invert`       | no       | Flip which direction a leader deviation maps to. Defaults to `True` -- confirmed on this rig (M1) -- pass `--no-yaw-invert` to disable. See "Movement axes" below. |
| `--yaw-deadzone-steps` | no     | Raw ST3215 encoder steps (`0-4095`/turn) of deviation from center treated as "don't rotate" (default `100`). Step-based, not calibration-relative -- see "Movement axes" below for why. |
| `--yaw-ramp-step`    | no       | Max change in commanded `move_yaw` per tick -- the spin-up/spin-down smoothing (default `6`). |
| `--fwd-leader-id`    | no       | Leader motor id (e.g. `2` for M2, shoulder-pitch) that drives follower forward/backward motion. Omit to disable (default). |
| `--fwd-invert`       | no       | Flip which direction a forward leader deviation maps to. Defaults to `True` on this rig (M2 rests at a joint limit) -- pass `--no-fwd-invert` to disable. See "Movement axes" below. |
| `--fwd-deadzone-steps` | no     | Same idea as `--yaw-deadzone-steps`, for the forward/backward axis (default `100`). |
| `--fwd-ramp-step`    | no       | Max change in commanded `move_x` per tick -- the speed-up/slow-down smoothing (default `6`). |

## Startup sequence

Before live tracking begins, `main.py` runs a fixed pre-flight sequence
(see `startup.py`):

1. **Stop any movement, then reset the follower's whole arm to a known-safe
   home pose.** First, an immediate neutral `move_x`/`move_yaw` is sent if
   either axis is enabled -- guards against a stale non-neutral command left
   over from a previous session that didn't shut down cleanly (the Dogzilla
   has no torque-disable, so it would otherwise just keep moving). Then all
   three arm servos in `config.FOLLOWER_HOME_POSITIONS` (`51:0, 52:255,
   53:0`) are ramped -- using the same rate limiter as live tracking, never
   an instant jump -- to that pose, clamped to any `--follower-limits` you
   configured. Deliberately **all three, unconditionally** -- not just
   whichever ones this session's `--map`/`joints` actually drives -- so a
   servo left out of this session's mapping doesn't just sit wherever a
   previous session left it. Leg servos are never touched either way (they
   aren't in `FOLLOWER_HOME_POSITIONS`). Note `51: 0` resets the gripper
   *closed*, not open, despite the name -- see "Gripper ranges and
   direction" below. After the ramp's commanded values reach their targets,
   the script waits a fixed `config.RESET_SETTLE_S` (default 2.5s) before
   continuing -- a rough estimate for the physical servo to actually catch
   up, since the driver has no real position feedback to confirm arrival
   (see "Safety" below). This whole step runs before the leader is touched
   at all.
2. **Wait for SPACE, then sample the leader's resting position.** The
   script prints "Move the leader arm to its resting position, then press
   SPACE here..." and blocks (no Enter needed, single keypress) until you
   do -- positioning the arm takes longer than the reset ramp above, so
   sampling doesn't start on a timer you have to race. Once pressed, M1-M8
   present positions are sampled for `--rest-sample-s` seconds (default 2s)
   and median-filtered per motor -- hold the arm still during this window.
   A per-motor spread (max-min over the window) above
   `config.REST_JITTER_WARN_STEPS` is flagged in the log as
   possibly-not-actually-at-rest, but doesn't abort the run. (If stdin isn't
   a real terminal -- e.g. piped input -- this falls back to Enter-to-continue
   instead of hanging.)
3. **Preview and log.** For each mapped pair, the resting leader position is
   projected onto the follower's range the same way live tracking does --
   a preview of the very first live command -- and the whole snapshot
   (all 8 leader motors' median + calibrated range, plus the preview) is
   appended to `--calib-log`.
4. **Start live control**, seeded from wherever the reset ramp left off (not
   from a fresh telemetry read), so tracking picks up smoothly.

## Gripper ranges and direction

The leader gripper and the dog gripper have different physical mechanisms
and different position encodings (leader: 12-bit calibrated arc; follower:
raw `0-255` byte), so this example doesn't copy positions across directly.
Each tick:

1. Reads the leader motor's own calibrated arc (`range_min`/`range_max`) and
   converts its present position to a 0-100% value within that arc.
2. Projects that percentage linearly onto the follower's `0-255` range
   (padded by a small margin so a literal `0` or `255` is never commanded).

So as long as the **leader gripper is calibrated** on its own station (fully
open/closed taught, e.g. via `st3215-calibration-dump-py` or the station's
calibration flow), "leader fully closed" maps to "follower fully closed"
regardless of how different the raw ranges are. The follower side has no
calibration to read -- `0x00`/`0xFF` are its actual fully-closed/fully-open
endpoints by hardware design, not arbitrary raw values.

**Direction**, confirmed on this rig: the leader's station-viewer reports
`0% = closed, 100% = open`, and the dog gripper is `0 = closed, 255 = open`.
Both sides already agree on sense, so the default (no `:inv`) is correct for
`8:51` -- **no inversion needed for the gripper**. Use `:inv` only for a pair
where the two mechanisms disagree on which end is "closed".

## Movement axes: yaw and forward/backward

Two independent, optional rate-controlled axes, on top of the arm-joint
mirroring above -- e.g. reach for an object by leaning the leader arm
forward, the whole dog creeps toward it:

```bash
uv run python main.py \
    --leader-server 192.168.68.66 --follower-server 192.168.68.56 \
    --map "8:51,6:52,4:53" --yaw-leader-id 1 --fwd-leader-id 2
```

Both work identically, just wired to different `MovementCommand` fields and
different web-UI keys -- `mirror.compute_axis_command` is the same function
for both, called twice with two independent `config.AxisConfig` instances:

| Axis | Flag | Register | Web UI keys | Leader joint |
| --- | --- | --- | --- | --- |
| Rotate in place | `--yaw-leader-id` | `move_yaw` (`0x32`) | Q=`255` / E=`1` | M1 (base rotation) |
| Forward/backward | `--fwd-leader-id` | `move_x` (`0x30`) | W=`255` / S=`1` | M2 (shoulder pitch) -- from `hardware/elrobot/simulation/elrobot_follower.urdf`, the most proximal joint that changes how far the arm reaches |

This is a fundamentally different kind of mapping from the arm joints above:
these are **rate/direction** commands, not positions -- `128` = stop, and
the dog keeps moving for as long as a non-neutral value keeps being sent.
So the leader joint doesn't drive a follower *position*; its deviation from
its own resting position (captured during the startup rest-sample, same as
every other leader motor) picks a **direction**:

- Within `--yaw-deadzone-steps`/`--fwd-deadzone-steps` raw encoder steps of
  center: neutral (`128`, no motion).
- Past the deadzone either way: the *same full-throw byte the web UI's keys
  send* (`255` or `1`) -- see `YahboomDogzillaLiteDesktopMovementPanel.tsx`,
  where e.g. `KeyQ` sets `move_yaw=255` and `KeyE` sets `move_yaw=1`, both
  instantly, no ramp. So this isn't a proportional "move faster the more you
  lean" control, it's "leader off-center = equivalent of holding one of
  those keys down."

**Bug found and fixed (applies to both axes): the deviation used to
silently never trigger if the leader motor wasn't calibrated.** The first
version measured "how far off center" as a percentage of the leader motor's
*calibrated arc* (`range_min`/`range_max`), reusing the same math as the
position joints. But a joint used only for yaw/forward-backward has no
reason to ever have been calibrated (calibration is otherwise only needed
for position mirroring) -- and an uncalibrated motor reports
`range_min == range_max == 0`, which made the old code divide by a
zero-width range and bail out (`return None`) on every single tick,
regardless of how far you moved it. It now measures the deadzone in raw
encoder steps (`--yaw-deadzone-steps`/`--fwd-deadzone-steps`, default `100`
out of 4095/turn) instead, which doesn't depend on calibration at all. It
also correctly handles the resting position sitting near the encoder's wrap
point (e.g. center at step 4090, a small move reading as step 5) -- the
earlier version would have read that as a huge jump in the wrong direction.

**"Momentum" -- added, doesn't exist natively.** Checked: the web UI's keys
snap `move_yaw`/`move_x` straight to `1`/`255` with zero ramping.
`--yaw-ramp-step`/`--fwd-ramp-step` (default `6`/tick at 50 Hz, ~0.4s
stop-to-full) is what `compute_axis_command` in `mirror.py` adds on top --
`step_toward` (the same rate limiter the arm joints use) ramps the
commanded value smoothly toward whichever target the deadzone picked,
instead of snapping.

**Direction was inferred from `sim.rs`, not verified against the real
robot, before testing** -- `move_yaw=255` (Q, "rotate left") increases
`orientation.yaw`, which by the standard right-hand-rule/top-down convention
is counterclockwise; W/`move_x=255` is read the same way as "forward." That
was a simulator-convention + naming-convention guess, and it turned out
backwards for yaw on this rig: M1 needs inverting, confirmed on real
hardware -- see "`--yaw-invert` defaults to `True`" below. Forward/backward
direction with a fresh `--fwd-leader-id` on a different joint is still
unverified -- use `--fwd-invert`/`--no-fwd-invert` if it turns out backwards.

**`--yaw-invert` defaults to `True`** (use `--no-yaw-invert` to disable),
confirmed empirically on this rig: M1 toward its calibrated `range_min`
should yaw left (Q, `move_yaw=255`), toward `range_max` should yaw right (E,
`move_yaw=1`) -- the opposite of the uninverted `sim.rs`-inferred mapping
above. If yaw is driven from a different leader motor on another rig,
re-verify this rather than assuming it carries over.

**`--fwd-invert` defaults to `True`** (use `--no-fwd-invert` to disable),
because on this rig M2 rests at (near) its calibrated `range_min` --
pulling the arm back is the only physically-reachable deviation from that
resting center (there's no room to go the other way from a position
already at the joint's minimum). Uninverted, that pull-back gesture would
map to forward (`W`); inverted, it maps to backward (`S`), which is the
pairing that actually makes sense for "pull the reaching arm back."

**A resting position at (or near) a hard joint limit makes that axis
one-directional, regardless of `--*-invert`.** If the sampled center sits
close to `range_min` or `range_max` (read straight from the motor's own
calibration via the station API -- never assumed to be mid-arc), there's no
room to deviate the *other* way from it -- so the axis can only ever detect
one direction of motion, e.g. M2 above can drive the dog backward but can
never trigger forward, no matter how `--fwd-invert` is set. `main.py`
checks this automatically after the rest-sample (works for whichever leader
id you actually configure, not just M2) and logs it if a configured axis's
center falls within `config.AXIS_CENTER_EXTREME_PCT` (default `15%`) of
either end of that motor's calibrated arc. **This is informational, not a
"go fix your calibration" warning** -- a joint whose rest pose sits at a
limit by design (M2 on this rig does) is *expected* to be one-directional.
Only recalibrate that leader motor's arc if you actually want bidirectional
control from it; there's no assumption anywhere that mid-arc is the
"correct" resting pose.

**Or use `center_pct` instead of recalibrating.** A YAML `--config` can set
`AxisConfig.center_pct` to anchor the deadzone at a fixed percentage of the
leader's calibrated arc, instead of wherever it's sampled to be resting --
lets the operator get bidirectional control by actively holding the arm at
a chosen point, without touching the leader's own calibration. **Note this
changes what `invert` needs to be**, since it changes which side of center
counts as "positive": the `--fwd-invert` default above assumes center is
wherever M2 naturally rests (near `range_min`), where pulling back is the
only reachable direction and should mean backward. With `center_pct: 60`
instead, moving *past* 60% (further from `range_min` than the old rest
point) is what should mean forward -- the opposite polarity, i.e.
`invert: false`. This was the first approach tried for M2 specifically, but
see below for why forward/backward on this rig ended up using the mixed
two-leader shape instead.

### Mixed forward/backward: M2 + M3

**Not currently wired into `configs/three-axes-test.yaml`** -- that config
was simplified back down to yaw + arm only (see the note at the top of the
file). This section documents the mixed-axis approach that was tried and
removed; the code (`config.MixedAxisConfig` / `mirror.compute_mixed_axis_command`)
is still in place if forward/backward comes back later. When it was active,
it used two separate leader joints, mixed, rather than `center_pct`, because
a single joint's deviation-from-center can't naturally express "resting
position already sits near a hard limit *and* I want proportional speed, not
just binary on/off":

```yaml
fwd:
  forward:
    leader_id: 2
    limit_pct: 50    # M2 at 50% (or beyond, clamped) -- full forward push
    # rest_pct omitted: resolved from this session's live rest-sample
  backward:
    leader_id: 3
    limit_pct: 50    # M3 at 50% (or below, clamped) -- full backward push
    # rest_pct omitted: resolved from this session's live rest-sample
  deadzone_pct: 5    # percentage points of deviation from rest_pct treated
                      # as still-at-rest, no push -- default, shown here
```

This is a **different control model entirely**, not a variant of the
single-leader `AxisConfig` above -- `config.MixedAxisConfig` /
`mirror.compute_mixed_axis_command`:

- **Proportional, not binary.** The single-leader axis picks a direction
  and always commands the same full-throw byte (matching Q/E/W/S snapping
  instantly) -- deliberately, to match the web UI's key behavior. The mixed
  axis instead scales continuously: `net = forward_contribution% -
  backward_contribution%` (each leader's own position rewindowed onto its
  `[rest_pct, limit_pct]` span via `mirror.rewindow_percentage`, clamped
  beyond `limit_pct`), mapped linearly onto `[1, 255]` with `128` as the
  zero point. Push M2 a quarter of the way from `rest_pct` to `limit_pct`
  and you get a quarter-strength forward command, not an all-or-nothing
  jump.
- **Two independent leaders, not one.** `rewindow_percentage` already
  handled a *reversed* window (`rest_pct > limit_pct`, as M3's `93 -> 50`
  is) correctly by construction -- rescaling still works out when the high
  and low ends of the window are swapped -- so no new math was needed
  there, just a fix to a guard clause that had incorrectly rejected that
  case (treated any `hi_pct <= lo_pct` as degenerate; only exact equality
  actually is).
- **They mix, not override.** If both M2 and M3 are ever pushed into their
  active range at once, their contributions subtract rather than one
  winning outright -- matching "M2 and M3 act like mixing signals that
  balance each other."
- **`rest_pct` defaults to this session's live rest-sample, not a fixed
  config value.** `_resolve_axis_center` in `main.py` resolves it in place
  from the startup rest-sample (same safe default the single-leader axis's
  `center_pct: null` already used) unless you explicitly set `rest_pct` in
  YAML, in which case it's used as given and checked against what was
  actually sampled, warning if they disagree by more than
  `config.AXIS_CENTER_EXTREME_PCT`.
- **A faulted or not-yet-reporting leader contributes 0**, not an error --
  the other side (if healthy) keeps working, and "no signal" fails toward
  "no push" rather than blocking the whole axis or propagating a fault.
- **`deadzone_pct` (default `5`) is a real dead zone**, applied to the raw
  percentage *before* rewindowing, not just the ~2-byte output deadband
  `deadband` gives you. Because a `rest_pct`-to-`limit_pct` window can be
  narrow (M3's here is 43-50 points), a couple of points of sensor noise or
  rest-position imprecision would otherwise be a meaningful fraction of full
  signal, not truly zero.

**Bug found and fixed: a hardcoded `rest_pct` caused the follower to
immediately walk backward at nearly full speed the moment live control
started.** The first version of this config set `rest_pct: 0` for M2 and
`rest_pct: 93` for M3 from a one-off earlier reading, taken once and never
re-verified. In practice the arm's actual rest position didn't match those
numbers closely enough, and with a 43-50-point-wide window and (at the
time) *zero* deadzone at the percentage level, that mismatch alone was
enough to produce a strong, immediately-ramping backward command on tick
one of `teleop_loop` -- ramped over `ramp_step_per_tick`, so not literally
instantaneous, but well under a second to reach a strong signal, which
reads as "violent" and "immediate" watching a robot suddenly walk backward
unprompted. Fixed two ways, together: `rest_pct` now defaults to `None`
(resolved from the live rest-sample every session, the same safe pattern
the single-leader axis already used successfully), and `deadzone_pct` adds
a genuine buffer so small mismatches -- from either sensor noise or an
explicit `rest_pct` that's slightly off -- can't produce any signal at all.
If you ever see unexpected motion right as control starts again, **press
SPACE to pause or Ctrl+C immediately** (see "Stop / pause" below) -- both
force `move_x`/`move_yaw` to neutral right away.

**Safety -- this is why these axes get different treatment from the
position joints elsewhere in this doc.** A position joint is safe to just
stop updating (it holds still). A non-neutral `move_yaw`/`move_x` is a
standing command that keeps the dog moving until something says otherwise,
so:
- Stale leader/follower data, a missing bus/device -- cases where position
  joints just skip the tick -- force an **immediate, unramped** neutral on
  *both* axes together if either wasn't already neutral (see
  `_force_movement_neutral` in `main.py`). Stopping is never subject to the
  smoothing ramp, only starting is.
- On shutdown (Ctrl+C or any fatal error), an explicit neutral write for
  both axes is sent as part of cleanup, unconditionally, best-effort.
- The two axes share one `MovementCommand` wire message (`move_x`/`move_y`/
  `move_yaw` together, `move_y`/strafe always neutral, unused here). Since
  it's a full overwrite, not a per-field patch, whenever either axis's
  commanded value changes, the write always carries *both* axes' current
  values together -- otherwise the one that didn't change that tick would
  round-trip through protobuf as `0` (full-reverse-power) instead of `128`
  (neutral), since zero-valued fields aren't encoded. See
  `commands.send_follower_commands`.

## Smoothing / jitter

If motion looks twitchy, two independent causes are worth separating:

1. **Leader reading noise.** Even a stationary ST3215 motor's
   `present_position` jitters by a few encoder steps tick to tick; that
   noise gets amplified through the percentage projection. `LeaderSmoother`
   in `mirror.py` applies an exponential moving average to every leader
   reading (position joints and movement axes alike) before anything else sees it --
   tune with `--leader-smoothing-alpha` (lower = smoother but more lag,
   roughly `20ms / alpha` settling time at the default 50 Hz tick rate;
   `1.0` disables it).
2. **Follower servo response.** Each tracking tick sends an *absolute*
   position write (`ServoCommand{servo_id, position}`) -- there's no
   ST3215-style speed/accel envelope on this protocol for individual
   position commands, only a single global rate register
   (`ServoSpeedCommand.arm_servo_speed`, `0x75`) that isn't currently used
   by this script. If the servo's own internal response is fast relative to
   our `max_step_per_tick` steps, each intermediate target can be reached
   and then waited-on rather than smoothly interpolated through, which can
   look like stutter even at a steady 50 Hz command rate. Not wired up yet,
   but worth trying if (1) doesn't fully fix it: setting `arm_servo_speed`
   once at startup to a moderate (not max) value might let the servo's own
   firmware smooth between our step targets. Untested here -- register
   units/direction (higher = faster vs. higher = slower) aren't documented
   anywhere in this repo, so it'd need empirical tuning on the real dog.

## Safety

- Only the follower servo ids listed in `--map` are ever written to --
  other servos on the follower (e.g. the dog's leg servos) are never
  touched.
- **No current-based overload protection on the follower side.** The
  `yahboom-dogzilla-lite` driver's telemetry (`YahboomDogzillaLiteStatus`)
  has no per-servo current field, unlike ST3215 -- there's no signal to
  detect a stall or a pinched gripper. The only guard is a **step-rate
  limiter** (`config.FollowerConfig.max_step_per_tick`, default `4`/tick at
  50 Hz, ~1.3s for a full 0-255 sweep): it bounds how fast a commanded
  position can change, but it cannot sense force. Watch the gripper on
  first run, especially if it might close on something.
- **`servo_positions` telemetry is a command echo, not real position
  feedback.** Confirmed by reading the Rust driver's protocol/feedback-packet
  code: the register map has exactly one register per arm servo, used for
  *writing* a commanded position, and the feedback packet's per-servo bytes
  line up 1:1 with that same write ordering -- there's no distinct
  "read actual position" register, and no current/moving-status field
  either. In practice this means `parse_follower_positions` reports
  whatever was last commanded almost immediately, regardless of whether the
  physical arm has actually caught up -- it cannot be used to confirm real
  arrival (an earlier version of `reset_follower_to_home` tried exactly
  this and it was a no-op dressed up as a safety check). `reset_follower_to_home`
  instead waits a fixed `config.RESET_SETTLE_S` after the ramp's commanded
  values reach target, sized from the driver's own simulator model (not a
  verified real-hardware spec) -- see that function's docstring.
- **No torque-disable on exit.** The Dogzilla driver has no torque-enable/
  disable command (unlike ST3215's `RAM_TORQUE_ENABLE`) -- servos are always
  under position control. On Ctrl+C the script just stops sending new
  commands; the follower arm holds wherever it was last commanded, it does
  not go limp.
- At startup, if a mapped motor id isn't present on its bus/device, the
  script fails fast with a clear error rather than silently ignoring that
  joint.
- **No default gripper-vs-screen self-collision guard.** `config.FOLLOWER_DEFAULT_LIMITS`
  is empty -- every follower servo, including `52`, uses only the generic
  margin-padded `0-255` span unless you explicitly pass `--follower-limits`
  (or a YAML `follower_limits` entry). There *was* a default cap here,
  derived geometrically (no URDF exists for the dog -- its 3D view in
  `station-viewer` is a separate hand-built Three.js model,
  `YahboomDogzillaLiteViewer.tsx`, not URDF-driven, so there was no real
  collision mesh to check against, just that model's own dimensions): both
  arm servos `52` (shoulder) and `53` (base) rotate about a shared Z axis
  with no other axis rotation anywhere in the chain, confining the
  gripper's reach to a single 2D plane, and forward kinematics through that
  chain showed the gripper tip entering the head/screen bounding box only
  when raw `52` got roughly above `204` (15mm safety pad), regardless of
  `53`. That was a geometric estimate from the *visualization* model, never
  verified against the real hardware's exact dimensions, and has been
  removed at the operator's explicit instruction -- add it back yourself
  via `--follower-limits "52:5-200"` (or tighter/looser, per your own
  judgment of the real dog's clearance) if you want it.

## What you'll see

Default output is deliberately terse -- a handful of one-line startup
confirmations (config summary, calibration snapshot path, the pause/Ctrl+C
reminder), plus warnings and errors if something's actually wrong. Nothing
scrolls once the session is running normally.

Add `-v`/`--verbose` for the full picture: detailed config echo for each
enabled axis, and once-a-second per-side connection health:

```
leader@192.168.68.66:   freq=20.0 Hz age avg=12.4ms min=4.2ms max=27.0ms
follower@192.168.68.56: freq=20.0 Hz age avg=58.1ms min=43.0ms max=98.0ms
```

- **freq**: inference frames received in the last second.
- **age**: time between frame arrival and when the loop sampled it
  (only counted when the frame index advanced).

A side whose connection stalls prints `(no new frames)` -- this one always
shows (it's a warning), regardless of `-v`.

## Stop / pause

**Pause**: press SPACE at any point during a live session to pause motion
mirroring, and again to resume. While paused, arm-joint position tracking
just stops updating (the Dogzilla holds its current position on its own --
no torque-disable needed) and both movement axes (yaw, forward/backward) are
immediately force-stopped, the same safety path used for a stale-data or
missing-device gap. Resuming picks back up smoothly from wherever things
were, no re-centering needed. (If stdin isn't a real terminal, live pause is
silently unavailable -- Ctrl+C still always works.)

**Stop**: Ctrl+C. See "No torque-disable on exit" above -- the gripper/arm
hold their last commanded position rather than going limp. The movement axes
are the exception: both are always explicitly stopped (neutral) on the way
out, since a rotation or drive command left running would keep the dog
moving.

**Bug found and fixed: Ctrl+C used to leave the process hanging.** Both the
startup SPACE-bar gate and the live pause watcher read raw keypresses via
`asyncio.to_thread(...)` wrapping a blocking `sys.stdin.read(1)`. A bare
blocking read can't be interrupted from outside its thread -- cancelling the
asyncio task awaiting it only stops *waiting*, the underlying thread just
keeps blocking. `asyncio.run()`'s own cleanup then calls
`loop.shutdown_default_executor()`, which waits for every outstanding
`to_thread()` call to finish before the process can exit -- so on Ctrl+C the
whole interpreter would hang until another key happened to be pressed.
Fixed by polling with `select()` on a short timeout (`main.KEY_POLL_INTERVAL_S`,
`0.15s`) against a `threading.Event` instead of blocking indefinitely --
keypress detection latency is unaffected (`select()` still returns
immediately once a key is actually pressed), but the thread now notices
"please stop" and exits within one poll interval instead of never.

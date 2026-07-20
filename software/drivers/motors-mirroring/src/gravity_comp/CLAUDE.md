# Gravity Compensation

Opt-in mode that makes the ElRobot leader arm hold its pose against gravity
while remaining easy to move by hand, instead of the default fully
torque-disabled ("floppy") leader behavior. Toggled from the "Gravity Comp"
button in station-viewer's `BusCard.tsx`, scoped to whichever bus that's
clicked on — independent of whether that bus is currently mirroring to a
follower.

## The constraint that shapes everything here

Feetech ST3215 servos have **no native torque/current-setpoint register** —
only a position-control loop with a `TorqueLimit` effort clamp
(`software/drivers/st3215/src/protocol/memory.rs`). There is no way to tell a
motor "apply 0.4 Nm"; you can only tell it "go to position X" and "don't push
harder than Y". So gravity compensation is *approximated*: every 20ms, compute
how hard gravity is currently pulling on each joint, then nudge
`GoalPosition` a little further in that same direction. The servo's own
internal position gain then supplies a restoring torque roughly proportional
to that offset — a virtual spring, not a real torque source. This only
approximates *static* holding torque; it is not a substitute for real
closed-loop torque control and will not behave correctly under fast dynamic
motion.

## Module layout

- **`elrobot_dynamics.rs`** — static data tables (joint origins/axes/limits,
  per-link mass and center-of-mass) extracted by hand from
  `hardware/elrobot/simulation/elrobot_follower.urdf`, plus
  `forward_kinematics()` and `gravity_torques()`. Gravity torque is computed
  via the virtual-work / Jacobian-transpose method: for each joint, sum the
  moment every *outboard* link's weight exerts about that joint's axis. No
  inertia tensors or velocity terms — this is a static model only.
- **`kinematics.rs`** — minimal hand-rolled `Vec3`/`Mat3` (Rodrigues rotation).
  No `nalgebra`/`urdf-rs` dependency: the chain is fixed at 7 joints and the
  math is small enough to hand-roll, matching this codebase's existing style
  (see `st3215::protocol::units`'s manual bit-twiddling).
- **`control.rs`** — the control law: raw servo ticks → joint angle (mirrors
  the frontend's `resolveElrobotJointValue` sign convention exactly), and
  torque → clamped `GoalPosition` offset using each motor's *live calibrated*
  range (not a fixed tick-per-radian constant).
- **`mod.rs`** — orchestration: per-bus background task lifecycle
  (`GravityComp::start`/`stop`), the 20ms control loop, and the safety
  cutoffs (below). This is also where `MotorCommand::TorqueLimit` gets sent
  before `Torque(1)` on start, and torque gets disabled + `TorqueLimit`
  restored to the ST3215 default on stop.

## Known approximations (deliberate, not bugs)

- **Follower masses, not leader masses.** The URDF models the *follower*
  arm's servos (12V/30kg). The leader uses physically lighter,
  different-gear-ratio servos (per the hardware BOM) chosen for
  backdrivability. Reusing follower link masses is a first-pass
  approximation — `gain_rad_per_nm` (see Tuning below) is the intended lever
  for correcting the residual error on real hardware, not this mass table.
- **Lumped gripper tip.** Motor 8 (gripper) and its gear/jaws are collapsed
  into one fixed point mass attached at the `ST3215_8_v1_1` frame, rather
  than modeled per-gripper-angle. The URDF's inertial data for the jaw links
  contains physically implausible offsets (larger than the arm's own 430mm
  reach — a known artifact of this URDF's CAD export for prismatic/mimic
  joints), so those numbers aren't usable directly. Motor 8 itself is never
  enabled or commanded by gravity comp in either direction.
- **ElRobot only.** SO101 has no mass/inertia data checked into this repo, so
  it isn't supported. Gating is in the frontend's
  `devices/registry.ts::supportsGravityComp()`.
- **Gravity is assumed along -Z in the URDF's own base frame** — consistent
  with joint 1's axis being ~(0,0,1) (a base "yaw" joint on an arm bolted to
  a table, output shaft vertical). If a future arm variant is mounted
  differently, this assumption needs revisiting.

## Command / mode plumbing

Modeled as an **orthogonal per-bus boolean**, entirely separate from
`BusMode` (`BR_LEADER`/`BR_FOLLOWER`) — a bus can be a mirroring leader *and*
gravity-comp'd at the same time, so this is not a `BusMode` variant. See
`GravityCompState`/`GravityCompCommand`/`GravityCompBusState` in
`protobufs/drivers/motors-mirroring/mirroring.proto`, routed via its own
`StationCommandType::STC_GRAVITY_COMP_COMMAND` (a dedicated command type
rather than overloading `STC_MOTOR_MIRRORING_COMMAND`, to avoid proto3
decode ambiguity between two different message shapes on the same wire
type). Handlers live in `../lib.rs`
(`handle_start_gravity_comp`/`handle_stop_gravity_comp`/
`deactivate_gravity_comp`).

Mode *state* is persisted to its own normfs queue
(`motors_mirroring/gravity_comp_modes`) and restored on backend restart for
**display purposes only** — restoring never calls `start_gravity_comp()`
again. Unlike mirroring pairs (inert until a live loop reads fresh leader
data), gravity comp actively drives motors the instant its task starts, so
silently re-arming it after a restart with no fresh operator confirmation
would be unsafe. An explicit command is always required to (re-)enable it.

## Safety cutoffs (all in `mod.rs::run_control_loop`)

- **Staleness**: if `st3215/inference` data for the bus goes stale
  (`MAX_DATA_AGE_NS`, shared with the mirroring loop) for
  `stale_cutoff_cycles` consecutive iterations, hard torque-off — not "hold
  last goal".
- **Overcurrent**: if any arm motor's current exceeds `current_cutoff` for
  `stale_cutoff_cycles` consecutive cycles, hard torque-off. Below that
  threshold, the whole arm holds position that cycle rather than sending new
  goals.
- **Self-stop notification**: either cutoff calls `on_self_stop`, a callback
  wired in `lib.rs` that reuses the exact same teardown path as an
  operator-issued stop command (`deactivate_gravity_comp`), so the mode
  displayed in the UI never drifts from what's actually running.
- **Hard ceilings independent of config**: `GravityCompConfig::clamped()` in
  `../config.rs` clamps `torque_limit`/`max_offset_ticks` to fixed ceilings
  regardless of what a YAML config supplies.
- **Explicit shutdown**: `Inference::stop_all_gravity_comp()` (called from
  `station`'s `Station::shutdown()` in `main.rs`, via the `Arc<Inference>`
  now returned by `motors_mirroring::start()`) stops every running task and
  disables torque before the process exits, rather than relying on implicit
  task-drop when the tokio runtime tears down.
- **Mutual exclusion with other GoalPosition writers**: gravity comp and
  mirroring/"Web-controlled" both continuously write `GoalPosition` to the
  same bus's motors, so leaving both active fights every ~20ms. The frontend
  (`BusCard.tsx::handleControlSourceChange`) sends `GCT_STOP_GRAVITY_COMP`
  first whenever the control-source dropdown changes for a bus with gravity
  comp enabled.

## A reentrancy pitfall already avoided here

`GravityComp::start()`/`stop()` are invoked synchronously from
`lib.rs::process_command_pack`, which is itself the "commands" normfs
queue's own subscription callback. `send_setup_commands`/
`send_teardown_commands` call `Inference::send_st3215_commands`, which
enqueues onto that *same* "commands" queue. Calling them inline would
re-enter that queue's enqueue/subscribe machinery from within its own
callback stack. Both are deferred onto their own `tokio::spawn`'d task to
break that reentrancy — matching the pattern `Inference::start`/`stop`
already use for mirroring's equivalent sends. If you add a new gravity-comp
code path that calls `send_st3215_commands` (or anything that calls
`normfs.enqueue` on the commands queue) from a handler in `lib.rs`, defer it
the same way rather than calling it inline.

## Tuning

`gain_rad_per_nm` (in `GravityCompConfig`, default `0.05`, hard ceiling
`GRAVITY_COMP_GAIN_CEILING = 1.0` in `../config.rs`) cannot be derived from
the ST3215's internal PID coefficients — those are undocumented firmware
units. It must be tuned empirically on real hardware: start low, increase
until the arm feels weightless without oscillating.

**Per-joint, not global.** A single gain cannot satisfy every joint at once —
different joints carry very different gravity-torque magnitudes and see the
saturating `max_offset_ticks` clamp at different points. `gain_rad_per_nm` is
therefore a `[f64; 7]` (`JointGains`, one value per arm motor 1-7), not a
scalar. A saturated joint doesn't just fail to hold its own pose — through
the rigid kinematic chain it can drag an unsaturated downstream joint along
with it (observed on hardware: joints 2/3/4 pinned at the ±60-tick ceiling
under a high global gain caused joint 5 to drift/rotate on its own even
though its individual offset was shrinking). Lowering the gain on the
saturating upstream joints, rather than raising the downstream one further,
is the fix.

**Live, from the UI, without a restart** — this is the expected way to tune
it day-to-day. `MotorDataTable.tsx` has a "GRAV" column (between MAX and
STATUS) with one gain input per arm motor (1-7; the gripper, motor 8, shows
"-" and is never editable). Changing a value sends a per-motor `GCT_SET_GAIN`
command (`motor_id` + `gain_rad_per_nm`) that always updates the staged
per-bus `GravitySettings` server-side, and additionally updates the running
control loop in-place if gravity comp is currently enabled
(`GravityComp::set_gain` → `Arc<RwLock<JointGains>>`, indexed by
`motor_id_to_index`, read once per 20ms cycle in `run_control_loop` — never
re-read from the static `MotorConfig`). `BusCard.tsx` also has a global
"Torque Limit" input (`GCT_SET_TORQUE_LIMIT`) next to the "Gravity Comp"
toggle — unlike gain, this is real hardware register state, so setting it
immediately re-sends a `TorqueLimit` write regardless of whether the loop is
running. Starting gravity comp (`GCT_START_GRAVITY_COMP`) never carries a
gain/torque-limit payload itself; the backend always seeds the new task from
whatever is currently staged for that bus (`ensure_gravity_settings` in
`../lib.rs`, falling back to `Inference::gravity_comp_defaults()` if nothing
has ever been staged). The active values are broadcast back in
`GravityCompBusState.joint_gains_rad_per_nm`/`torque_limit` so the UI
reflects reality (e.g. after a page reload) rather than only its own
locally-remembered value.

**Persisting across restarts**: staged edits (per-joint gains and torque
limit) live only in the in-memory `gravity_settings` map until the operator
clicks "SAVE GRAVITY" (`BusCard.tsx` → `GCT_SAVE_SETTINGS` →
`handle_save_gravity_comp_settings` in `../lib.rs`), which writes a
`GravityCompSettingsEnvelope` to its own normfs queue
(`motors_mirroring/gravity_comp_settings`). That queue is restored on
startup the same way the gravity-comp *mode* queue is — display/pre-fill
only, so a restart shows the last-saved values in the table without ever
re-arming the control loop itself.

Since the default gain is quite conservative, a fresh install will likely
feel like *nothing is happening* at first — this is expected, not a bug; see
the worked example below.

**Config-file default** (used only as the starting point before anything has
ever been staged/saved for a bus): `gravity-comp:` under `drivers.st3215` in
the station YAML config (see
`software/station/shared/station-iface/src/config.rs::GravityCompConfig`) —
applied uniformly to all 7 joints via `Inference::gravity_comp_defaults()`.

**Sanity-checking the numbers**: for a horizontal-reach pose
(`theta = [0, 1.5, 0, 0, 0, 0, 0]`), `gravity_torques()` gives roughly
0.55 Nm at the shoulder (joint 2), the largest of any joint. At the default
gain (0.05 rad/Nm) that's only ~0.028 rad (~1.6°) of commanded offset —
tens of ticks, well under `max_offset_ticks` (60) — combined with the
servo's own low proportional gain (`ELROBOT_PID.p = 16`, chosen for
backdrivability) this can be too weak to feel by hand. Try roughly
0.2–0.4 rad/Nm as a more noticeable starting point, watch for oscillation,
and back off if the arm hunts/vibrates rather than settling.

## Testing

Unit tests cover the dynamics/control math only (no hardware needed):
`cargo test -p motors-mirroring`. They check things like joint 1's
near-vertical axis producing ~0 gravity torque, and shoulder torque growing
with horizontal reach — sanity checks on the sign/axis conventions, not a
substitute for on-arm validation.

**Not yet tested on real hardware**: a bus simultaneously gravity-comp'd and
mirrored to a follower. This is a genuinely new code path — before this
module existed, `Inference` never wrote `GoalPosition` to a *source* bus's
own motors, only to *targets*.

**On-hardware diagnostics**: `run_control_loop` logs a rate-limited (once/
second, not every 20ms cycle) summary at `INFO` level covering exactly what
each branch is doing that cycle - staleness, which motor IDs are missing (if
any), overcurrent readings per motor, and for the normal path, each motor's
computed gravity torque/offset/goal and whether commands were actually sent.
Check the `station` process's own log output (not the browser console) when
gravity comp seems to have no effect - this tells you definitively whether
the loop is stuck waiting on motor data, tripping the overcurrent cutoff, or
genuinely sending goals that are just too small to feel (a gain problem, not
a code problem).

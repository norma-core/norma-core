# Gravity Compensation (ElRobot leader arm)

Lets an operator hold the leader arm's pose against gravity by hand-feel
instead of it always going fully limp, without adding any new hardware. It's
opt-in per bus, toggled from a UI button, and today only implemented for
ElRobot (7-DOF arm + gripper, Feetech ST3215 servos) — SO101 has no mass/CoM
data checked into the repo, so it isn't supported.

Code lives in `software/drivers/motors-mirroring/src/gravity_comp/` (see the
sibling `CLAUDE.md` there for the terse agent-facing version of this doc).
This file is the fuller writeup: the math, the architecture, what we learned
tuning it on real hardware, and how it's wired into the UI.

## The constraint that shapes everything

Feetech ST3215 servos have **no native torque/current-setpoint register** —
only a position-control loop plus a `TorqueLimit` effort clamp
(register `0x30`, `software/drivers/st3215/src/protocol/memory.rs`). You
cannot tell the servo "push with 0.4 Nm"; you can only tell it "go to
position X" and "don't push harder than Y%". So gravity compensation here is
*approximated*: every 20ms, compute how hard gravity is pulling on each
joint right now, then nudge `GoalPosition` a little further in that
direction. The servo's own internal position gain supplies a restoring
torque roughly proportional to that offset — a virtual spring, not a real
torque source. It only approximates *static* holding torque (no inertia
terms, no velocity feedback) — adequate for slow manual posing, not for
fighting fast motion.

## The math

### 1. Forward kinematics

`elrobot_dynamics::forward_kinematics()` walks the arm as a serial chain of
7 revolute joints, using per-link translation offsets, joint origins/axes,
and joint limits hand-extracted from
`hardware/elrobot/simulation/elrobot_follower.urdf`. For a joint-angle
vector `theta: [f64; 7]`, it returns, all expressed in the `base_link`
frame:

- each joint's pivot position and rotation axis
- the center-of-mass (CoM) of every gravity-relevant link (14 of them —
  see "known approximations" below for what's excluded/lumped)

Rotation is accumulated with a hand-rolled `Mat3`/`Vec3` (Rodrigues'
rotation formula) in `kinematics.rs` — no `nalgebra`/`urdf-rs` dependency;
the chain is fixed at 7 joints and the math is small enough to hand-roll,
matching this codebase's existing low-level style.

### 2. Gravity torque via virtual work / Jacobian transpose

`elrobot_dynamics::gravity_torques(theta) -> [f64; 7]` computes the static
gravity torque felt at each joint without ever building an explicit
Jacobian matrix. For every link, its weight `(0, 0, -m·g)` (g = 9.81 m/s²)
exerts a moment about every joint it is outboard of:

```
for each link L (mass m_L, CoM position com_L):
    weight = (0, 0, -m_L * g)
    for each joint J that L is outboard of (J's index <= L's last actuating joint):
        arm    = com_L - joint_pos_J
        moment = arm × weight
        tau[J] += moment · joint_axis_J        // component along J's own axis
```

This is summed over all 14 links for all 7 joints in one pass
(`LINK_LAST_JOINT_INDEX` records, per link, the index of the last/most
distal joint whose rotation actually moves it — e.g. the housing for joint 2
is itself only moved by joint 1, so it must not contribute to joint 2's own
torque sum). The result, `tau: [f64; 7]`, is each joint's instantaneous
static holding torque in Nm.

Sanity checks living in `elrobot_dynamics.rs`'s unit tests: joint 1's axis
is near-vertical (~`(0, 0, 1)`), so gravity (along -Z) should produce almost
no torque about it regardless of pose; the shoulder (joint 2) should see
more torque extended horizontally than folded straight up. Both hold.

### 3. Torque → servo goal offset

`control::gravity_torque_to_goal_offset_ticks()` turns a torque into a
clamped tick offset to add to the servo's current measured position:

```
delta_theta_rad = gain_rad_per_nm * tau_nm
delta_ticks     = -(delta_theta_rad * ticks_per_radian)      // sign flip, see below
offset_ticks    = clamp(delta_ticks, -max_offset_ticks, +max_offset_ticks)
goal            = clamp(present_position + offset_ticks,
                         range_min + safety_margin, range_max - safety_margin)
```

- `gain_rad_per_nm` is the empirically-tuned lever (see "what we learned"
  below) — there's no way to derive it analytically from the servo's
  internal (undocumented, firmware-only) PID coefficients.
- `ticks_per_radian` is derived per-motor from its *live calibrated* range
  divided by its URDF joint-angle span (`control::ticks_per_radian`), not a
  fixed global constant — a real unit's calibrated range rarely matches the
  servo's full 4096-tick sweep exactly.
- The sign flip matches `raw_to_joint_angle`'s own `joint_upper -
  joint_position` inversion, which mirrors the exact convention the
  frontend already uses in `devices/elrobot/config.ts`'s
  `resolveElrobotJointValue` — both sides of the wire must agree on which
  tick direction is "more positive angle."
- `goal` is additionally wrapped into tick-space (`rem_euclid` against the
  4096-step servo range) before the range clamp, and if a motor's
  calibrated range is too narrow (`< safety_margin * 2`) or wraps across the
  0/4096 boundary, that motor is skipped for the cycle (holds position)
  rather than risking a bad clamp.

## Implementation

### Module layout

- `elrobot_dynamics.rs` — the static data tables + `forward_kinematics`/
  `gravity_torques` above.
- `kinematics.rs` — minimal `Vec3`/`Mat3` primitives.
- `control.rs` — tick ↔ angle conversion and the torque→offset control law.
- `mod.rs` — task orchestration: per-bus background `tokio` task lifecycle
  (`GravityComp::start`/`stop`), the 20ms control loop
  (`run_control_loop`), and the safety cutoffs.

### Per-bus task lifecycle

`GravityComp` (in `mod.rs`) holds a `HashMap<BusKey, GravityCompTask>`. Each
running task owns:

- `gains: Arc<RwLock<[f64; 7]>>` — one gain per arm motor (index 0 = motor
  1 … index 6 = motor 7), read fresh every 20ms cycle so it can be tuned
  live without restarting the loop.
- `torque_limit: Arc<RwLock<u16>>` — also live-tunable, but semantically
  different: it's real servo register state (the `TorqueLimit` effort
  clamp), not a pure software multiplier, so changing it immediately
  re-sends a `TorqueLimit` write rather than just updating a value the loop
  reads.
- `stop_flag` / `JoinHandle` for shutdown.

`start()` does a one-shot setup (write `TorqueLimit`, then enable torque,
for arm motors 1–7 only — motor 8, the gripper, is never touched in either
direction) before spawning the 20ms loop. `stop()` flips the stop flag,
aborts the task, disables torque, and restores the servo's normal
`TorqueLimit` (`st3215::presets::DEFAULT_TORQUE_LIMIT = 500`) for hygiene.
Both the setup and teardown sends are deferred onto their own `tokio::spawn`
rather than called inline, because `start`/`stop` are themselves invoked
synchronously from within the "commands" normfs queue's own subscription
callback (`lib.rs::process_command_pack`) — calling something that enqueues
onto that same queue inline would re-enter its own callback stack.

### The 20ms control loop (`run_control_loop`)

Per cycle, per arm motor: read present position/current from the latest
`st3215/inference` broadcast, convert to a joint angle
(`control::raw_to_joint_angle`), and check two safety conditions before
computing anything:

- **Staleness** — if the bus's motor data hasn't updated within
  `MAX_DATA_AGE_NS` for `stale_cutoff_cycles` (default 5) consecutive
  cycles, hard torque-off, not "hold last goal."
- **Overcurrent** — if any arm motor's current exceeds `current_cutoff`
  (default 60, raw units) for `stale_cutoff_cycles` consecutive cycles, hard
  torque-off. Below that, the whole arm holds position that cycle instead of
  issuing new goals.

If both checks pass, `gravity_torques()` runs on the full 7-angle pose, each
motor's offset/goal is computed as in the math section above, and a batch of
`Goal` commands is sent. Either cutoff calls the `on_self_stop` callback
wired from `lib.rs`, which reuses the exact same teardown path as an
operator-issued stop, so the UI's displayed mode never drifts from what's
actually running.

A rate-limited (once/second, not every 20ms) `INFO`-level log line records
exactly what each branch decided that cycle — staleness, missing motor IDs,
overcurrent readings, or for the normal path each motor's
`(gain, torque_nm, present, offset_ticks, goal)`. This was the actual
diagnostic tool used to confirm the loop was running correctly during
hardware bring-up, before it was known to just be under-tuned.

### Command / mode / settings plumbing

Gravity comp is modeled as an **orthogonal per-bus flag**, not a `BusMode`
variant — a bus can be a mirroring leader *and* gravity-comp'd
simultaneously. Everything routes through its own
`StationCommandType::STC_GRAVITY_COMP_COMMAND` and
`motors_mirroring::GravityCompCommand` message
(`protobufs/drivers/motors-mirroring/mirroring.proto`), with five command
types:

| `GravityCompCommandType` | Payload | Effect |
|---|---|---|
| `GCT_START_GRAVITY_COMP` | bus | Starts the loop, seeded from staged/saved settings (see below) |
| `GCT_STOP_GRAVITY_COMP` | bus | Stops the loop, torque off |
| `GCT_SET_GAIN` | bus, `motor_id` (1–7), `gain_rad_per_nm` | Per-joint live gain update |
| `GCT_SET_TORQUE_LIMIT` | bus, `torque_limit` | Global live torque-limit update (real register write) |
| `GCT_SAVE_SETTINGS` | bus | Persists current staged settings to normfs |

There are **two** separate normfs queues, each restored on backend startup
for **display purposes only** — restoring never re-arms the control loop
itself, since gravity comp actively drives motors the instant it starts, and
silently re-enabling it after a restart with no fresh operator confirmation
would be unsafe:

- `motors_mirroring/gravity_comp_modes` — last known enabled/disabled state
  per bus (`GravityCompModeEnvelope`).
- `motors_mirroring/gravity_comp_settings` — last-saved per-joint gains +
  torque limit per bus (`GravityCompSettingsEnvelope`), written only when
  the operator explicitly saves (see below).

## What we learned tuning this on real hardware

- **The default gain is deliberately conservative and will feel like
  nothing is happening at first.** At the default `0.05 rad/Nm`, a
  horizontal-reach pose (`theta = [0, 1.5, 0, 0, 0, 0, 0]`) produces only
  ~0.55 Nm at the shoulder — about 1.6° of commanded offset, tens of ticks,
  well under the 60-tick default ceiling. Combined with the servo's own low
  proportional gain (`ELROBOT_PID.p = 16`, chosen for backdrivability), this
  is genuinely too weak to feel by hand. This is expected, not a bug — start
  around 0.2–0.4 rad/Nm to actually feel it.

- **A single global gain can't satisfy every joint.** Different joints see
  very different gravity-torque magnitudes and hit the `max_offset_ticks`
  saturation ceiling at different gains. This is why gain became a
  `[f64; 7]` (per-joint) rather than one scalar, editable from a new column
  in the motor table (see UI section).

- **Saturated joints can drag their neighbors.** On hardware, running
  joints 2/3/4 pinned at the ±60-tick ceiling under one high global gain
  (0.6) caused joint 5 to visibly drift/rotate on its own, even though
  joint 5's *own* computed offset was shrinking over the same interval.
  Root cause: `goal = present_position + offset` is recomputed every cycle
  from the servo's *just-measured* actual position, not a fixed reference —
  and a joint's torque is computed via full forward kinematics of
  everything upstream of it. If upstream joints are saturated (not holding,
  slowly losing to gravity), the pose used to compute a downstream joint's
  torque keeps shifting underneath it, so that joint keeps chasing a moving
  target instead of settling at one fixed equilibrium, even while its own
  offset value looks like it's converging. Net effect: it behaves more like
  a slow rate command than a spring, for as long as the upstream saturation
  persists.

  Practical fix, confirmed to work: don't run all 7 joints at one high
  gain. Lower the gain specifically on joints that are saturating (in this
  case 2/3/4) so they stop pinning at the ceiling, and tune the rest
  independently. This removes the "moving ground" the dragged joint was
  chasing.

- **The torque limit ceiling is a deliberate, non-adjustable safety
  boundary, not a tuning parameter.** `TorqueLimit` here is capped in code
  at 150 (`GRAVITY_COMP_TORQUE_LIMIT_CEILING`), on the servo's own 0–1000
  effort scale (~15% of max), regardless of what's requested via the UI or
  a config file. For comparison: normal mirrored/follower operation uses
  500 (50%), and calibration sweeps use 300 (30%). Gravity comp is meant to
  lightly assist a leader arm someone's hand is on, not fight them — the
  ceiling is set well below what would make the arm hard to backdrive, and
  raising it would be a deliberate safety tradeoff, not a routine tuning
  change.

## UI

All of this lives in `software/station/clients/station-viewer/src/st3215/`.

- **`BusCard.tsx`** — the "Gravity Comp" toggle button, next to the 3D/
  camera view switch. Color-coded so its state is unambiguous: amber/filled
  when enabled ("Gravity Comp: ON", with a pulsing dot), muted/outlined
  when disabled. Disabled entirely if the bus is currently a mirroring
  *follower* (gravity comp only makes sense on a backdrivable leader).
  Next to it: a global **Torque Limit** number input (0–150, live —
  changing it sends `GCT_SET_TORQUE_LIMIT` immediately, applied whether or
  not gravity comp is currently running) and a **SAVE GRAVITY** button
  (sends `GCT_SAVE_SETTINGS`).
- **`MotorDataTable.tsx`** — a new **GRAV** column, inserted between the
  existing MAX and STATUS columns, with one gain input (0.00–1.00) per arm
  motor row (1–7). Motor 8 (gripper) shows `-` and is never editable, since
  gravity comp never touches it. Editing a cell sends a per-motor
  `GCT_SET_GAIN`. This table is shared across the 3D view
  (`BusWebGLRenderer.tsx`) and the camera-first view (`RobotCameraView.tsx`)
  — both were threaded with the same `gravityCompJointGains`/
  `onGravityCompJointGainChange` props so the column appears consistently
  wherever the motor table is shown for a gravity-comp-capable bus.
- Changing the mirroring/"Web-controlled" source for a bus with gravity
  comp enabled sends `GCT_STOP_GRAVITY_COMP` first
  (`handleControlSourceChange`) — gravity comp and mirroring both write
  `GoalPosition` continuously, so leaving both active on the same bus would
  fight every ~20ms.

## How settings are read and written

Three layers, in order of persistence:

1. **Live control-loop state** (in-memory, only while a task is running) —
   `Arc<RwLock<[f64; 7]>>` for gains and `Arc<RwLock<u16>>` for torque
   limit, owned by the running `GravityCompTask`. Read once per 20ms cycle.
   Gone the instant the task stops.

2. **Staged settings** (in-memory, per-bus, survives stop/start but not a
   process restart) — a `HashMap<BusKey, GravitySettings>` in `lib.rs`,
   populated lazily by `ensure_gravity_settings()` (first touch for a bus
   seeds it from `Inference::gravity_comp_defaults()`, i.e. the config-file
   default gain applied uniformly to all 7 joints). Every `GCT_SET_GAIN` /
   `GCT_SET_TORQUE_LIMIT` command updates this map *unconditionally* — even
   if gravity comp isn't currently running on that bus — and additionally
   applies live to the running task if there is one
   (`Inference::set_gravity_comp_gain`/`set_gravity_comp_torque_limit`,
   returning whether it actually applied live). `GCT_START_GRAVITY_COMP`
   always seeds the new task from this map rather than always resetting to
   config defaults, so table edits made before pressing "Gravity Comp"
   already take effect the moment it starts.

3. **Saved settings** (on disk, via normfs, survives a restart) — only
   written when the operator explicitly clicks **SAVE GRAVITY**
   (`GCT_SAVE_SETTINGS` → `handle_save_gravity_comp_settings`), which reads
   the current staged entry for that bus and enqueues a
   `GravityCompSettingsEnvelope` onto the
   `motors_mirroring/gravity_comp_settings` queue. No-op (logged) if
   nothing has ever been staged for that bus. On the next backend startup,
   this queue (and the separate `gravity_comp_modes` queue for the
   enabled/disabled display state) is replayed to repopulate the in-memory
   staged-settings map — restoring is display/pre-fill only; it never calls
   `start_gravity_comp()` on its own. An explicit `GCT_START_GRAVITY_COMP`
   command is always required to actually drive motors again after a
   restart.

Every state-changing command also triggers `merge_modes()`, which
rebuilds and broadcasts `InferenceState.gravity_comp` (a
`GravityCompBusState` per bus, carrying `joint_gains_rad_per_nm` and
`torque_limit`) so every connected UI reflects the current staged/live
values, not just the client that made the change.

Not everything is exposed to the UI today. Per-joint `gain_rad_per_nm` and
the global `torque_limit` are the only two live/UI-tunable knobs. The
remaining `GravityCompConfig` fields — `max_offset_ticks` (60), the
overcurrent `current_cutoff` (60), and `stale_cutoff_cycles` (5) — are
config-file-only (`gravity-comp:` under `drivers.st3215` in the station YAML,
see `software/station/shared/station-iface/src/config.rs`), set once at
startup and not currently changeable while running.

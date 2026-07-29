# PWM (Open-Loop) Gravity Compensation (ElRobot leader arm)

A second, independent implementation of leader-arm gravity compensation,
alongside the position-offset approach in `GRAVITY_COMPENSATION.md`. Same
goal — hold the arm's pose against gravity while it stays easy to move by
hand — but a genuinely different control law: instead of nudging a position
setpoint and letting the servo's own PID act as an implicit spring, this
switches the servo into an open-loop PWM mode and writes a duty cycle
directly proportional to the computed gravity torque. True feedforward
torque, not an approximation routed through a position controller.

Code lives in `software/drivers/motors-mirroring/src/gravity_comp_pwm/` (see
the sibling `CLAUDE.md` there for the terse agent-facing version of this
doc). Read `GRAVITY_COMPENSATION.md` first if you haven't — this doc assumes
familiarity with that one and focuses on what's different.

**Status: not yet validated on real hardware.** The original gravity-comp
feature was tuned and confirmed on a physical arm before merge. This one has
only been checked with the unit tests in `control_pwm.rs`. If you're the one
testing this on hardware for the first time: start `duty_per_nm` at `0` (the
default), raise it in small steps, and keep a hand near the arm's power
switch — open-loop PWM has no position feedback stopping a joint at a
mechanical limit if something is misconfigured.

## Why this is possible: the servo's other mode

`GRAVITY_COMPENSATION.md` explains that the ST3215 has no torque/current
setpoint register — true, and still the reason the position-offset approach
exists. But the servo has a third `Mode` (`EepromRegister::Mode`, address
`0x21`) beyond the position mode (`0`) this codebase used exclusively before:
mode `2`, open-loop PWM. This was cross-checked against three independent
Feetech SMS/STS SDK sources (a C++ header, its implementation, and a
tutorial) — all agree with each other and with this repo's own register
table in `software/drivers/st3215/src/protocol/memory.rs`.

In mode `2`, `RamRegister::GoalTime` (`0x2C`) — a register that means
something else entirely in position mode — is reinterpreted as a signed PWM
duty-cycle command, native range roughly ±1000. The sign isn't encoded the
way `PresentPosition`'s wraparound sign is (bit 15, see
`st3215::protocol::units::normal_position`); it's a *direction bit* at bit
position 10, with the magnitude in bits 0–9. The new
`st3215::protocol::encode_direction_bit(value, bit_pos)` helper implements
this generically. `Mode` is an EEPROM register, so switching it needs the
same unlock-EEPROM / write / re-lock sequence (`RamRegister::Lock`) that
`port.rs`'s calibration flow already uses for other EEPROM writes.

## What's shared with the position-offset module, and what isn't

The physics is identical — gravity doesn't care how the resulting torque gets
applied. `gravity_comp::elrobot_dynamics::gravity_torques()` (forward
kinematics + virtual-work torque model) and `gravity_comp::control::
raw_to_joint_angle` (servo ticks → joint angle) are reused directly via
`pub(crate)` visibility on `gravity_comp`'s submodule declarations, not
duplicated. See `GRAVITY_COMPENSATION.md`'s "The math" section for the full
derivation — none of it changed.

What's different is entirely on the actuation side:

```
duty = clamp(duty_per_nm * tau_nm, -max_duty, +max_duty)
```

(`control_pwm::gravity_torque_to_pwm_duty`) — no offset-to-position math, no
`ticks_per_radian`, no sign flip to match a position convention. `duty` *is*
the command; there's no implicit spring turning an offset into a restoring
force, because there's no position loop left to supply one.

## New safety mechanisms (and why the old ones don't carry over)

Every protection the position-offset module got for free from the servo's
own position loop had to be reimplemented here, because open-loop PWM has no
feedback of its own:

- **Joint-limit-margin cutoff** (`control_pwm::within_limit_margin`). The
  offset-based module's `clamp_goal` always confines `GoalPosition` inside
  the calibrated range — the servo's own position loop physically cannot
  drive past it. There is no equivalent constraint on a raw duty cycle: a
  joint sitting at its mechanical limit keeps receiving whatever duty was
  computed, regardless of direction. So this module checks every joint,
  every cycle, and forces `duty = 0` for any joint within `safety_margin`
  ticks of either end of its calibrated range.
- **Overcurrent → explicit `Pwm(0)`, not "hold".** The offset-based module's
  overcurrent handling just skips sending a new `GoalPosition` that cycle —
  safe, because the servo's position loop keeps holding the last goal on its
  own. There is no "hold" in open-loop mode; skipping a cycle just repeats
  last cycle's torque. This module explicitly zeroes every arm motor's duty
  on overcurrent instead.
- **Zero-PWM-first teardown.** Stopping (operator command, staleness
  self-stop, or overcurrent self-stop) sends `Pwm(0)` to all 7 arm motors in
  its own message, before anything else — before disabling torque, before
  touching `Mode`/`Lock`. A stuck nonzero duty actively drives the motor for
  as long as it's in effect, unlike a stuck `GoalPosition` (which just holds
  a pose). This is the single most time-sensitive write the module makes.
- **`max_duty` is a pure software clamp**, not a hardware register — unlike
  the offset module's `torque_limit` (a real `TorqueLimit` register write on
  every change), updating `max_duty` just changes what the control loop
  reads next cycle. A conservative fixed `TorqueLimit` write still happens
  once at setup, as defense in depth, but it isn't the lever that matters
  here.
- **A lower hard ceiling.** `PWM_GRAVITY_COMP_MAX_DUTY_CEILING = 100` (out of
  the servo's native ±1000 range) is deliberately more conservative than the
  offset module's `TorqueLimit` ceiling ratio (150/1000) — this control law
  is both newer and structurally more dangerous.
- **Default `duty_per_nm` is exactly `0.0`.** The offset module's default
  gain (0.05 rad/Nm) was chosen, after hardware tuning, as "probably too weak
  to feel, but not zero." This module has had no hardware tuning at all, so
  its default does nothing at all until an operator deliberately raises it.

## Mutual exclusion with the offset-based module

The original gravity-comp feature and mirroring/"Web-controlled" can coexist
on the same bus, because both only ever write `GoalPosition` — redundant, not
harmful. This module switches the servo's `Mode` register away from position
control entirely, so running it alongside the offset-based module on the
*same* bus isn't merely redundant, it's actively broken: one control loop
writes `GoalPosition` to a servo that's ignoring it (wrong mode), the other
writes `GoalTime` to a servo that's ignoring *that* (wrong mode), and both
loops fight over `Mode`/`Lock`/`TorqueLimit` every cycle.

`Inference::start_gravity_comp` and `start_pwm_gravity_comp` each stop the
other one on the same bus before starting (`software/drivers/motors-mirroring/
src/inference/mod.rs`), and the frontend enforces the same rule both ways: the
two toggle buttons in `BusCard.tsx`, and `handleControlSourceChange` (which
already stopped the offset-based module on any control-source change, and now
stops this one too).

## Command / mode / settings plumbing

Structurally identical to the offset-based module — a dedicated command type
(`STC_PWM_GRAVITY_COMP_COMMAND`, carrying `PwmGravityCompCommand`), five
command types, two normfs queues restored for display only:

| `PwmGravityCompCommandType` | Payload | Effect |
|---|---|---|
| `PGCT_START_PWM_GRAVITY_COMP` | bus | Starts the loop, seeded from staged/saved settings |
| `PGCT_STOP_PWM_GRAVITY_COMP` | bus | Zeroes PWM, disables torque, restores position mode |
| `PGCT_SET_DUTY_GAIN` | bus, `motor_id` (1–7), `duty_per_nm` | Per-joint live gain update |
| `PGCT_SET_MAX_DUTY` | bus, `max_duty` | Global live max-duty update (software clamp only, no register write) |
| `PGCT_SAVE_SETTINGS` | bus | Persists current staged settings to normfs |

Queues: `motors_mirroring/pwm_gravity_comp_modes`
(`PwmGravityCompModeEnvelope`) and `motors_mirroring/pwm_gravity_comp_settings`
(`PwmGravityCompSettingsEnvelope`). Same restore-is-display-only rule as the
offset-based module, for the same reason: this control law drives motors the
instant its loop starts, so silently re-arming it after a restart with no
fresh operator confirmation would be unsafe.

## UI

- **`BusCard.tsx`** — a second toggle button, "PWM Grav Comp (experimental)",
  styled with a distinct (red/critical) accent rather than the offset
  module's amber, since this is a materially less-proven control mode and
  shouldn't be visually confusable with the validated one. Next to it: a
  **Max Duty** number input (0–100, live) and a **SAVE PWM SETTINGS** button.
  Disabled whenever the bus is a mirroring follower, same as the offset
  module.
- **`MotorDataTable.tsx`** — a **PWM** column, one duty-gain input per arm
  motor (1–7; motor 8/gripper shows `-`). Threaded through
  `BusWebGLRenderer.tsx` and `RobotCameraView.tsx` the same way
  `gravityCompJointGains` already was, so it appears consistently wherever
  the motor table is shown.

## Settings persistence

Same three-layer model as the offset-based module (live control-loop state →
staged in-memory settings, seeded lazily via `ensure_pwm_gravity_settings` →
saved-to-normfs on explicit "Save PWM Settings"). See
`GRAVITY_COMPENSATION.md`'s "How settings are read and written" section — the
mechanics are identical, just for `PwmGravitySettings { joint_duty_gains,
max_duty }` instead of `GravitySettings { joint_gains, torque_limit }`.

Config-file defaults live under `pwm-gravity-comp:` alongside `gravity-comp:`
in `drivers.st3215` (station YAML config,
`software/station/shared/station-iface/src/config.rs::PwmGravityCompConfig`).

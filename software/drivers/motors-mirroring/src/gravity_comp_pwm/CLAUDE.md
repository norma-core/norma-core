# PWM (Open-Loop) Gravity Compensation

A direct feedforward-torque alternative to `../gravity_comp` (the
position-offset approximation from the original leader-arm gravity comp
feature). Same goal - the ElRobot leader arm holds its pose against gravity
while remaining easy to move by hand - but a fundamentally different, more
direct control law, and a fundamentally more dangerous one: it takes the
servo's own position-control loop out of the picture entirely.

**Not yet validated on real hardware.** Unlike `gravity_comp` (hardware-tested
before merge), this module has only been verified with the unit tests in
`control_pwm.rs`. Start `duty_per_nm` at 0 (the default) and raise it in small
increments; stay near a physical way to cut power to the arm for the first
test.

## The mechanism

`gravity_comp`'s `CLAUDE.md` explains that ST3215 servos have no native
torque/current-setpoint register - only a position loop with a `TorqueLimit`
effort clamp. That's still true. But the servos *do* support a second
operating mode that bypasses the position loop altogether:

- `EepromRegister::Mode` (`software/drivers/st3215/src/protocol/memory.rs`,
  address `0x21`) accepts `0` (position/servo mode, the only value this
  codebase used before this module) and `2` (open-loop PWM mode). Verified
  against three independent Feetech SMS/STS SDK sources (a header, its `.cpp`
  implementation, and a tutorial), all of which agree with each other and
  with this driver's own register table.
- In mode `2`, `RamRegister::GoalTime` (address `0x2C` - a different register
  than the position-mode-only `GoalPosition`) is reinterpreted as a signed PWM
  duty-cycle command, native range roughly ±1000. Sign is encoded as a
  *direction bit* at bit position 10 (magnitude in bits 0-9), not the bit-15
  sign-extension convention `st3215::protocol::units::normal_position` uses
  for `PresentPosition` - see the new `st3215::protocol::encode_direction_bit`
  helper.
- `Mode` is an EEPROM register, so switching it requires unlocking EEPROM
  first (`RamRegister::Lock` = 0), writing `Mode`, then re-locking
  (`Lock` = 1) - the same unlock/write/re-lock sequence
  `port.rs`'s calibration flow already uses for other EEPROM writes.

So instead of nudging a position setpoint and letting the servo's PID supply
an implicit restoring force, this module computes the same gravity torque
model (`gravity_comp::elrobot_dynamics::gravity_torques`, reused - not
duplicated, see below) and writes a duty cycle directly proportional to it,
every 20ms. This is genuine feedforward torque, not an approximation routed
through a position controller - and it sidesteps the specific failure mode
`gravity_comp`'s hardware notes describe (a joint saturated against its
offset ceiling dragging a downstream joint through the kinematic chain),
because there's no offset or ceiling being fought against.

## What's shared with `gravity_comp`, and why

The physics doesn't change based on how torque gets applied. `elrobot_dynamics`
(forward kinematics + virtual-work gravity torque model) and `control`'s
`raw_to_joint_angle` (servo ticks -> joint angle, matching the frontend's sign
convention) are reused via `pub(crate)` visibility on `gravity_comp`'s
submodule declarations - not duplicated. Only the *actuation* half - torque ->
command, and what "command" even means - differs, which is what
`control_pwm.rs` and this file's control loop own.

## What's new here, and why (safety)

Open-loop PWM has no position feedback of its own, so several protections
that came for free in `gravity_comp` (via the servo's position loop and
`clamp_goal`'s range clamping) have to be reimplemented in software:

- **Joint-limit-margin cutoff** (`control_pwm::within_limit_margin`): a
  nonzero duty keeps being applied even if a joint is already at or past its
  mechanical limit, since nothing local to the servo stops it. Every cycle,
  any joint within `safety_margin` ticks of either end of its calibrated
  range gets its duty forced to `0`, regardless of which direction the
  computed torque points. `gravity_comp` never needed this: `GoalPosition`
  was always clamped inside the calibrated range by `clamp_goal`, so the
  servo's own position loop physically couldn't drive past it.
- **Overcurrent -> explicit zero, not "hold".** `gravity_comp`'s overcurrent
  handling skips sending a new `GoalPosition` that cycle, which is safe
  because the servo's position loop keeps holding the last goal on its own.
  There is no equivalent "hold" in open-loop PWM - skipping a cycle just
  repeats last cycle's torque. So this module explicitly sends `Pwm(0)` to
  every arm motor on overcurrent instead of skipping.
- **Zero-PWM-first teardown.** `send_teardown_commands` sends `Pwm(0)` to all
  7 arm motors in its own call, *before* disabling torque or touching `Mode`/
  `Lock` - a stuck nonzero duty is actively driving the motor the whole time
  it's in effect, unlike a stuck `GoalPosition` (which just holds a pose).
  This is the single most time-sensitive write this module makes.
- **`max_duty` is a software clamp, not a hardware register.** Unlike
  `gravity_comp::set_torque_limit` (which re-sends a real `TorqueLimit`
  register write), `set_max_duty` just updates an `Arc<RwLock<u16>>` the
  control loop reads each cycle - there's nothing to re-send. A conservative
  fixed `TorqueLimit` write still happens once at setup (see below) as
  defense in depth, but the real ceiling that matters day-to-day is
  `max_duty`.
- **Temperature cutoff.** Continuous PWM drive has no natural "settled and
  coasting" phase the way position mode does - a joint fighting gravity at a
  nonzero duty is dissipating heat the whole time it's enabled, not just
  while actively moving. Every cycle, if any arm motor's `PresentTemperature`
  (`RamRegister::PresentTemperature`, populated into
  `MotorState::temperature` in `inference/model.rs`) reaches
  `temperature_cutoff_celsius` for `stale_cutoff_cycles` consecutive cycles,
  hard torque-off via the same self-stop path as staleness/overcurrent -
  zeroing duty immediately, not "holding," for the same reason overcurrent
  does. Default cutoff is 55C, hard-ceilinged at 70C
  (`PWM_GRAVITY_COMP_TEMPERATURE_CUTOFF_CEILING`) - comfortably below where a
  hobby servo's own internal thermal protection would typically trip, so the
  software cutoff acts first.
- **Hard ceiling below `gravity_comp`'s ratio.**
  `PWM_GRAVITY_COMP_MAX_DUTY_CEILING` (100, out of the servo's native ±1000)
  is deliberately more conservative than `GRAVITY_COMP_TORQUE_LIMIT_CEILING`'s
  ratio (150/1000) - this control law is both newer and structurally more
  dangerous (no position-loop backstop at all).
- **Default `duty_per_nm` is exactly `0.0`, not a small nonzero guess.**
  `gravity_comp`'s default gain (0.05 rad/Nm) was chosen as "probably too weak
  to feel, but not zero" after hardware tuning. This module has had no
  hardware tuning at all, so its default does *nothing* until an operator
  deliberately raises it - "no default guess" beats "an unvalidated guess" for
  a fully open-loop torque source.

## Mode/command plumbing

Mirrors `gravity_comp`'s exactly, duplicated rather than shared (see
`GravityCompState`/`PwmGravityCompCommand`/`PwmGravityCompBusState` in
`protobufs/drivers/motors-mirroring/mirroring.proto`, routed via its own
`StationCommandType::STC_PWM_GRAVITY_COMP_COMMAND`): an orthogonal per-bus
flag, mode state persisted for *display only* and never auto-resumed, staged
settings + explicit "Save" to persist across restarts, live per-joint tuning
from the UI.

**Mutual exclusion, not orthogonality, with `gravity_comp`.** The original
gravity-comp feature and mirroring/"Web-controlled" could coexist on the same
bus because both only ever wrote `GoalPosition` - two writers of the same
register are merely redundant. This module switches the servo's `Mode`
register away from position control entirely, so running it at the same time
as `gravity_comp` on the same bus isn't redundant, it's actively broken (one
loop writing `GoalPosition` a servo in mode 2 is ignoring, the other writing
`GoalTime` a servo in mode 0 is ignoring, and both are toggling `Mode` and
`TorqueLimit` out from under each other). `Inference::start_gravity_comp` and
`start_pwm_gravity_comp` each stop the other one on the same bus first, and
the frontend enforces the same exclusion between the two toggle buttons and
`handleControlSourceChange`.

## Testing

`cargo test -p motors-mirroring` covers `control_pwm.rs`'s duty
conversion/clamping and the limit-margin cutoff, plus
`st3215::protocol::encode_direction_bit`'s bit-10 sign/magnitude encoding
(`software/drivers/st3215/src/protocol/units_test.rs`) - none of this needs
hardware. What's *not* covered by any test, and can only be checked on a real
arm: that `Mode` actually switches cleanly, that `GoalTime` actually drives
the motor as PWM once in that mode, and that toggling this off cleanly
restores normal position-mode backdrivability.

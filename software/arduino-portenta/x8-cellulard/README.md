# x8-cellulard model

This directory contains the Lean 4 policy model for the Portenta cellular
supervisor. The production daemon can be implemented later, likely in Rust, but
this model is the current executable specification for dual-cellular failover,
recovery, and reboot decisions.

The model is intentionally board-specific. It assumes two cellular slots:

- `external`: primary LTE/GNSS modem on the Max Carrier expansion path
- `sara`: onboard SARA-R4 backup/control modem

The model does not try to prove a Linux implementation. It defines the policy
shape the daemon should follow when it observes modem, Linux, resource, and
platform states.

## Build

```sh
lake build
```

Expected result:

```text
Build completed successfully
```

The project is pinned by `lean-toolchain`. Lake build artifacts are ignored via
`.gitignore`.

## File Map

- `X8Cellulard/Types.lean`: core enums for slots, services, modem layers,
  faults, recoverability, platform state, and reboot reasons.
- `X8Cellulard/State.lean`: modem, system, and world state plus derived
  predicates such as usable link, all-links-down, and recovery exhaustion.
- `X8Cellulard/Policy.lean`: one-step policy decisions: route repair, modem
  recovery, service restart, clock sync, and forced reboot.
- `X8Cellulard/Invariants.lean`: general properties checked by Lean.
- `X8Cellulard/Scenarios.lean`: small baseline scenarios.
- `X8Cellulard/FaultMatrix.lean`: one-shot fault matrix.
- `X8Cellulard/Transition.lean`: event/time observation model.
- `X8Cellulard/TraceScenarios.lean`: multi-event traces.
- `X8Cellulard/Actuation.lean`: simplified action effects.
- `X8Cellulard/ClosedLoopScenarios.lean`: observe, decide, apply scenarios.
- `X8Cellulard/ActionFailure.lean`: failed action effects.
- `X8Cellulard/ActionFailureScenarios.lean`: action failure coverage.

## Modeled State

The modem model is layered. It does not treat "connected" as sufficient for a
working link.

Each modem tracks:

- board power state
- USB / ModemManager presence
- SIM state
- radio registration
- data bearer state
- IP and route state
- health-check state
- route metric
- recovery attempts
- power-cycle count
- cooldown flag

The system model tracks:

- `dbus`
- `modemManager`
- `tailscaled`
- `ntpClient`
- stale route state
- resource state: normal, storage full, `/run` unavailable, OOM pressure,
  cannot fork
- platform state: normal, low power suspected, thermal stress, USB controller
  wedged, fatal
- clock state: unknown, sync needed, syncing, valid, failed

## Policy Defaults

The default policy is conservative:

- external LTE is preferred when healthy
- SARA-R4 is backup when healthy
- no SIM, PUK, denied registration, and rejected APN are held instead of
  reset-looped
- only one modem is hard power-cycled at a time
- no forced reboot happens while any modem has a usable route
- if every path is unusable and budgets are exhausted, forced reboot is allowed
  after boot grace and reboot-rate guards
- clock sync is started after cellular connectivity is usable, but clock sync
  failure does not make cellular connectivity unusable

## Modeled Decisions

The policy can emit these actions:

- `hold slot fault`
- `powerOn slot`
- `reconnect slot`
- `connect slot`
- `configureIp slot`
- `installRoute slot metric`
- `removeRoute slot`
- `powerCycle slot`
- `restartService service`
- `reconcileRoutes`
- `syncClock`
- `forceReboot reason`

## Coverage

The one-shot fault matrix covers:

- SIM missing
- SIM PIN required
- SIM PUK required
- SIM failure
- APN rejected
- registration denied
- no signal
- bearer lost
- IP configuration failure
- route missing
- failed health checks
- USB vanished
- USB present but not seen by ModemManager
- dbus restart
- ModemManager restart
- tailscaled restart
- NTP client restart
- stale route reconciliation
- cannot fork
- `/run` unavailable
- storage full
- OOM pressure
- low power suspected
- thermal stress
- USB controller wedged
- fatal platform state
- boot grace reboot guard
- short outage reboot guard
- max reboots per hour guard
- both modems no SIM
- external broken while SARA has no SIM

The trace model covers:

- route metric repair
- stale route reconciliation
- helper timeouts for `mmcli`, `ip`, `udhcpc`, `gpioset`, and health checks
- link flapping and primary restoration
- all-links-down timer crossing reboot threshold
- daemon restart reconciliation
- ModemManager modem ID changes
- reboot guard counter behavior
- external modem physically absent while SARA works
- long no-coverage outage on both modems
- NTP sync after a route becomes usable

The closed-loop model covers simplified action effects:

- route plans repair metrics
- route actions clear stale-route state
- `syncClock` moves clock to `syncing`
- service restart actions set modeled services back to `running`
- forced reboot resets volatile state and increments the reboot guard counter
- dual power-cycle requests still actuate only one modem
- a boot-to-healthy trace converges to external preferred

The action-failure model covers:

- failed route installation
- failed IP / DHCP configuration
- failed ModemManager connect
- failed ModemManager reconnect
- failed GPIO power-cycle
- failed clock sync
- failed service restart
- failed reboot
- partial success when one action in a plan fails and another succeeds

## Checked Invariants

Lean currently checks these general properties:

- external is preferred whenever external is usable
- SARA is preferred when external is not usable and SARA is usable
- no reboot reason is produced while any usable link exists
- `decide` never emits forced reboot while any usable link exists
- non-recoverable modem faults do not produce power-cycle actions
- `recoverBoth` never hard power-cycles both modems in the same plan

## Deliberately Not Modeled Yet

These are intentionally outside the current model:

- exact ModemManager DBus object semantics
- QMI vs MBIM vs PPP bearer details
- exact GPIO electrical truth or power-good feedback
- cooldown expiry as real time counters
- persistent reboot history stored on disk
- DNS resolver state
- detailed Tailscale DERP/direct/login state
- signal quality thresholds and roaming policy
- Tokio task races, locks, and command cancellation
- invalid SIM PIN retry counters and PUK lockout behavior
- status-file and logging write failures

The next high-value additions are cooldown/backoff counters, watchdog-feed
policy, DNS state, and QMI/MBIM/PPP mode distinctions.

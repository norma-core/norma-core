# x8-watchdogd

Plain C network watchdog daemon for the Arduino Portenta X8.

The daemon owns `/dev/watchdog0` and feeds it while the Linux system has global
internet reachability. If all configured IP targets fail continuously for the
offline window, the daemon stops feeding the watchdog and lets the i.MX watchdog
reset the board.

It is intentionally separate from `x8-cellulard`: cellular reconnects remain a
modem concern, while this daemon handles whole-system recovery.

## Build

```sh
cmake -S . -B build
cmake --build build
```

## Safe Checks

Run one network check without opening `/dev/watchdog0`:

```sh
./build/x8-watchdogd --once
```

Run the policy loop without arming the hardware watchdog:

```sh
./build/x8-watchdogd --no-watchdog
```

## Run

Production-style run:

```sh
./build/x8-watchdogd
```

Defaults:

- watchdog device: `/dev/watchdog0`
- watchdog feed interval: 10 seconds
- network check interval: 60 seconds
- continuous offline window before reset: 10800 seconds
- `ping` timeout: 10 seconds
- hard process timeout around each `ping`: 30 seconds
- watchdog open/feed retry interval: 5 seconds

Current target:

- `100.100.100.100` - Tailscale DNS

The daemon uses global network checks:

```text
ping -c 1 -W 10 <target>
```

It does not bind checks to `ppp0`, because whole-system watchdog policy should
not reboot the board when another working route, such as Ethernet, is available.

## Options

- `--device PATH`: watchdog device, default `/dev/watchdog0`
- `--feed-sec SECONDS`: watchdog feed interval
- `--check-sec SECONDS`: network check interval
- `--offline-reboot-sec SECONDS`: continuous offline window before reset
- `--ping-timeout-sec SECONDS`: `ping -W` timeout
- `--ping-hard-timeout-sec SECONDS`: process-level timeout around `ping`
- `--watchdog-retry-sec SECONDS`: retry interval for watchdog open/feed failures
- `--no-watchdog`: run checks but do not open or feed the watchdog
- `--once`: run one network check and exit without opening the watchdog
- `--help`: show options

## Recovery Contract

When at least one target replies, the system is healthy and the watchdog is fed.
When every target fails, the daemon records the monotonic time of the first
failure and keeps feeding while the offline window has not elapsed. One later
successful target clears the offline state.

After the offline window elapses, the daemon logs the reason and stops feeding
the watchdog. It stays alive and waits for the hardware reset.

## Yocto Integration

The `x8-normacore` image installs this daemon and its SysV init script, but does
not enable autostart. Enable it on the device when watchdog resets are desired:

```sh
update-rc.d x8-watchdogd defaults 80 20
/etc/init.d/x8-watchdogd start
```

Device path and timing policy are embedded defaults in the source for this
hardware target.

## Runtime Resilience

The daemon is designed to stay alive by itself. Runtime watchdog open/feed
failures are retried internally instead of exiting. The service should be
started once by init, not wrapped in a respawn supervisor.

## Failure Matrix

- Watchdog device missing at boot: daemon keeps running and retries opening it.
- Watchdog feed fails: daemon closes the broken fd, retries opening the device,
  and continues running.
- `ping` target unreachable: offline timer starts or continues.
- `ping` process hangs: daemon kills it after the hard timeout and records a
  failed check.
- `ping` binary missing or cannot execute: check fails and the offline timer is
  allowed to trip the reboot policy.
- Network recovers before 10800 seconds: offline timer is cleared.
- Network remains down for 10800 seconds: daemon stops feeding the watchdog and
  waits for the hardware reset.
- Daemon crashes: the hardware watchdog is expected to reset the board after its
  timeout because feeding stops.
- Clean service stop after arming the watchdog may still reboot the board on
  this hardware, because the i.MX watchdog may not be stoppable once enabled.

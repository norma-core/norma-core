# x8-cellulard

Plain C cellular supervisor for the Arduino Portenta X8 with the Max Carrier.

The daemon is board-specific and manages two known modem slots:

- `external`: Max Carrier LTE/GNSS modem, matched as `[Quectel] EC200A`
- `sara`: onboard Portenta X8 SARA-R4 modem, matched as `[u-blox] SARA-R412M-02B`

There is no external runtime config file. The command-line APN parameters are
the source of truth: a slot is managed only when its APN is provided.

## Build

```sh
cmake -S . -B build
cmake --build build
```

Run one supervisor cycle:

```sh
./build/x8-cellulard --once --external-apn internet
```

Run continuously:

```sh
./build/x8-cellulard --external-apn internet
./build/x8-cellulard --external-apn internet --sara-apn backup.apn
```

Options:

- `--external-apn APN`: enable and manage the Max Carrier external modem
- `--sara-apn APN`: enable and manage the onboard SARA modem
- `--interval-sec SECONDS`: supervisor interval for continuous mode
- `--once`: run one supervisor cycle and exit

At least one APN must be provided.

## Supervisor Flow

Each supervisor cycle applies the same recovery chain:

1. Reconcile board GPIO power for enabled and disabled slots.
2. Ask ModemManager for the configured modems.
3. Enable configured modems when ModemManager reports them disabled.
4. Connect each configured modem with its explicit APN.
5. Start or maintain per-slot PPP when the bearer requires PPP.
6. Ensure an IPv4 default route through ready PPP interfaces.
7. Check internet reachability over each ready PPP interface.

Failures are logged and the next supervisor cycle retries the recovery chain.

## GPIO Ownership

The daemon owns and reapplies these board GPIO outputs:

- `/dev/gpiochip5` line `29`: external LTE power
- `/dev/gpiochip5` line `4`: SARA-R4 power
- `/dev/gpiochip5` line `2`: SARA-R4 reset

Configured slots are powered on. Slots without an APN are powered down.

## ModemManager

ModemManager is accessed through `libmm-glib`, not `mmcli`.

For each configured slot, the daemon:

- matches the fixed manufacturer/model pair
- enables the modem if needed
- lists 3GPP profiles for diagnostics
- connects with the APN from the command line
- records the connected bearer, interface, APN, and IPv4 method

SIM-missing and similar non-actionable modem states are held and logged instead
of reset-looped.

## PPP

PPP is used when ModemManager reports a bearer with IPv4 method `ppp`.

Per-slot interfaces are fixed:

- `external` -> `ppp0`
- `sara` -> `ppp1`

The daemon starts `pppd` directly with:

```text
noauth nodetach debug noipdefault novj noccp noipv6 nodefaultroute
```

It also creates `/var/run/pppd/lock` if needed. If PPP does not obtain IPv4,
the daemon stops `pppd`, disconnects the failed bearer, and lets the next
supervisor cycle reconnect it.

## Routes

Routes are managed through `libnl`.

When one or more PPP interfaces have IPv4, the daemon ensures an IPv4 default
route through the ready PPP nexthop set.

## Health Checks

Health checks use the system `ping` binary. Each ready PPP interface is checked
with:

```text
ping -I <interface> -c 1 -W 2 <target>
```

The daemon also enforces a hard five-second timeout around each `ping` process
and kills a stuck helper.

Current targets:

- `1.1.1.1`
- `8.8.8.8`
- `9.9.9.9`
- `208.67.222.222`
- `1.0.0.1`
- `8.8.4.4`

One successful target makes that slot healthy. If a slot fails every target,
the daemon stops its PPP process, disconnects its bearer, disables the modem,
and lets the next supervisor cycle re-enable and reconnect it.

## Recovery Contract

The runtime recovery policy is reconnect-only:

- GPIO failures are retried on the next cycle.
- ModemManager connection or modem enable/connect failures are retried.
- PPP failures disconnect the bearer and retry later.
- Route installation failures are retried.
- Health failures reset the slot data path by stopping PPP, disconnecting the
  bearer, and disabling the modem.

## Lean Model

This directory still contains a Lean 4 policy model under `X8Cellulard/`.
That model is useful for policy experiments, but it is not the current runtime
contract for the C daemon.

Build it with:

```sh
lake build
```

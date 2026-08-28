# DFRobot RS-485 uniform low-block + connect-time static capture — design

Date: 2026-07-30
Status: approved design, pending implementation plan
Branch: `feat/dfrobot-light-sensors`
Builds on: model auto-detection (implemented) and baud auto-detection
(implemented). Pattern reference: the ST3215 driver's EEPROM cache
(`software/drivers/st3215/src/port.rs::scan_motors` — full read once,
RAM-only per tick, cached EEPROM stitched into every envelope).

## Goal

Restructure polling ST3215-style so every stored snapshot contains the
complete useful register image of its sensor, while the bus cycle gets
*shorter*:

- **Per cycle**: one uniform block read per sensor — `(0x0000, 33)`
  (registers 0x0000–0x0020 inclusive), identical for every model including
  `unknown`.
- **At connect**: each sensor's static registers are read once, cached, and
  appended to every subsequent snapshot envelope.

## Evidence base (hardware-verified)

1. **Block-safety of the low window**: `0x0000`–`0x0010` returns correct
   values even in 125-register block reads (deep sweep 2026-07-29).
   `0x0020` reads zero in a 125-register block **but reads correctly in a
   33-register block** — verified live 2026-07-30 on uv (`0x0020` = 0x3F80
   in `(0x0000, 33)`; psr `(0x0000, 17)` cross-check also correct). Hence
   the 33-register uniform block is safe; larger low blocks are not proven
   and buy nothing (0x0021–0x0045 reads zero everywhere; 0x0046+ is the
   light-config zone, unverified at this block size).
2. **Static registers are connection-static by construction**: the sensors
   never change their own registers, the driver never writes (fc 0x03
   only), and the driver is the sole bus master while it holds the port.
   Config/settings/serials can change only *between* connections (station
   stopped → CLI writes → restart), which is exactly when the reconnect
   re-read happens.
3. The `0x0830`-block and light-config statics answer only small/single
   reads (sweep finding) — the static capture uses the same read shapes as
   today's proven code.

## Register plan

### Per cycle — all models, one transaction

```
(0x0000, 33)   -- 0x0000..0x0020: measurements, derived channels, raw ADC,
                  hardware id (0x0009), derived 0x0010, uv const 0x0020
```

Bus cycle for 4 sensors: 4 transactions ≈ 0.4 s at 9600 (was 17 ≈ 0.45 s).
Nothing polled today is lost: 0x0010 stays (inside the block), uv 0x0020
moves from a dedicated single into the block; 0x0052/0x07D0-cluster move to
the static set.

### At connect — per model (cached until disconnect)

| Model | Static reads | Transactions |
|---|---|---|
| irradiance / par / uv (shared radiation set) | `(0x0052, 1)`, `(0x07D0, 5)`, singles `0x0834` `0x0837` `0x0839` `0x083B` `0x0840` `0x0841` `0x0842` `0x0844` `0x0849`, `(0x00F0, 1)` | 12 |
| light | `(0x0046, 3)`, `(0x0064, 4)` | 2 |
| unknown | union: radiation set + light set | 14 |

Radiation statics ≈ 0.3 s once per connection; light ≈ 0.05 s.

**Addendum 2026-07-30 (post-live-testing):** SEN0644 answers block reads of
at most 13 registers (x13 OK, x14+ malformed — hardware-verified), so the
per-cycle plan is per-family: radiation `(0x0000, 33)`, light and unknown
`(0x0000, 10)`. The "uniform for every model" statement above is superseded.

## Driver behavior (`driver.rs`, `sensors.rs`)

- `sensors.rs`: `poll_ranges()` collapses to the shared
  `PER_CYCLE_RANGES: &[(u16, u16)] = &[(0x0000, 33)]` for every model; new
  `static_ranges(&self) -> &'static [(u16, u16)]` returns the per-model
  static sets above.
- `SensorState` gains `static_ranges: Option<Vec<RegisterRange>>` (the
  cache).
- **Connect transition**: on a tick where the sensor is `!connected`, the
  dynamic block is read as usual; if it succeeds, the static set is read
  next, before any signal is emitted. If any static read fails, the whole
  tick counts as failed (sensor stays disconnected, normal error path,
  retry next tick — mirrors ST3215, where the first successful read is the
  full read). Only when both succeed: cache the static ranges and emit
  CONNECTED with dynamic + static ranges.
- **Every snapshot**: envelope `ranges` = fresh dynamic ranges followed by
  the cached static ranges (order is irrelevant to consumers — decoding is
  by address).
- **Invalidation**: cache cleared on sensor disconnect and on port loss.
  Nothing else can invalidate it (no write path).
- DISCONNECTED/ERROR envelopes keep empty ranges (as today). Detection at
  acquisition is unchanged.

## Frontend (`values.ts`, `DfrobotRs485Expanded.tsx`)

1. New `DFROBOT_SPECS` rows so the captured statics decode as named rows
   instead of "unmapped" (all three radiation models get the shared set):
   - `0x0052` deviation — already spec'd (unchanged).
   - `0x07D0`/`0x07D1`/`0x07D3`/`0x07D4` — already spec'd (unchanged).
   - `0x083B` → name `range_max`, kind `info`, scaled per model: irradiance
     ×1 "W/m²" (1800), par ×1 "µmol/m²·s" (2500), uv ×0.01 "mW/cm²"
     (→ 15.00).
   - `0x0834`, `0x0837`, `0x0839`, `0x0840`, `0x0841`, `0x0842`, `0x0844`,
     `0x0849` → names `reg_0x0834` … kind `undocumented` (raw hex display).
   - `0x00F0` → name `factory_reset_magic`, kind `info` (hex display; the
     0xDAA5 constant).
   - light: `0x0046`–`0x0067` already spec'd (unchanged).
2. **Zero filter**: in the Expanded view's "Unmapped registers" section,
   hide entries with `raw == 0` and show a muted one-line count
   (`"N zero registers hidden"`) when any were hidden. Rationale: these
   devices return 0 for unimplemented registers — zeros carry no
   information (established in the register docs). `decodeDfrobotRegisters`
   itself stays complete (returns zeros); the filter is presentation-only.

No proto changes; envelopes remain self-describing. Old recordings decode
unchanged; new recordings simply carry more ranges.

## Sizing

Per snapshot per sensor: 66 B dynamic payload + statics (radiation 32 B in
12 ranges, light 14 B in 2) + range headers ≈ 200–260 B → bus ≈ 1 KB/s ≈
85–90 MB/day at 1 Hz (was ~48). Acceptable against the 2 GB per-queue cap;
the payload gain is every snapshot being a complete self-contained image.

## Error handling summary

| Condition | Behavior |
|---|---|
| Static read fails at connect transition | poll counts as failed; sensor not connected; retry next tick |
| Sensor disconnects / port lost | static cache cleared; full re-read on reconnect |
| Dynamic block read fails while connected | existing DISCONNECTED/ERROR path (unchanged) |
| Unknown register non-zero in the block | frontend "Unmapped" section (zero entries filtered) |

## Testing

- `sensors.rs` tests: every model's `poll_ranges()` equals the shared
  `(0x0000, 33)`; `static_ranges()` sanity (no overlaps, counts > 0, no
  overlap with the per-cycle block); radiation models share one static set.
- Driver: connect-transition logic — extract the "assemble envelope ranges
  = dynamic + cached statics" step into a pure helper and unit-test it;
  existing tests stay green (poll-plan-dependent tests updated).
- Vitest: new SPECS rows decode (uv `0x083B` raw 1500 → 15.00 mW/cm²;
  irradiance 1800 W/m²), zero-filter behavior (zeros hidden, non-zeros
  shown, count line).
- Live: snapshot envelopes contain the static ranges every second (check a
  decoded envelope); expanded history shows named `range_max`/serial rows
  and no zero-clutter; cycle time ≈ 0.4 s; disconnect/reconnect of one
  sensor re-reads statics.

## Out of scope

- Any writes to sensors.
- Polling statics per cycle (the point is not to).
- Proto or queue-layout changes.
- Second-master scenarios (single-adapter setup; statics-stale risk
  documented as nonexistent here).

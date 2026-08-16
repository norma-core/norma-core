# Arduino Nicla Sense ME support — design

Date: 2026-08-15
Branch: `feat/nicla-sense-me`
Status: approved design, pending implementation plan

## Goal

Add the Arduino Nicla Sense ME as a station sensor, following the existing
Arduino Nicla Sense Env pattern end to end: the device hangs off a Portenta X8
I2C bus (ESLOV), the driver reads the device's **full register space every poll
tick** and ships the raw image into its own NormFS queue, and the frontend
decodes values at fixed offsets — a live dashboard widget plus a History-page
register-map viewer.

Because the Sense ME has no stock register-map firmware (its factory ESLOV
protocol is the Bosch BHY2 host protocol), we write a **custom Arduino sketch**
that reads all onboard sensors via `Arduino_BHY2` and exposes them as an I2C
peripheral with a fixed register map, mimicking the Sense Env's device model.

## 1. Firmware

### Location

`device-support/arduino-nicla-sense-me/`
- `arduino-nicla-sense-me/arduino-nicla-sense-me.ino` — the sketch
- `README.md` — register-map contract + flash instructions for **macOS and
  Linux** (`arduino-cli` core + library install, board detection, compile,
  upload; note that flashing happens from a workstation over USB, not from the
  X8)

### Behavior

- Runs `Arduino_BHY2` in standalone mode; subscribes to all sensors listed in
  the register map below.
- Acts as an I2C peripheral on the ESLOV bus at address **0x22** (hard-coded,
  distinct from the Sense Env's 0x21 so both can share a bus).
- Register-pointer semantics compatible with the station's `i2c-async` SMBus
  block reads (32-byte chunks, each chunk re-sends the register offset): a
  1-byte write sets the pointer; reads return sequential bytes with
  auto-increment.
- **Anti-tearing**: the host's full dump spans ~6 separate 32-byte
  transactions. The sketch latches a snapshot of all values into a shadow
  buffer whenever the host writes pointer `0x00` and serves all reads from that
  latch, so one dump is always internally consistent. A `sample counter`
  register lets the host detect staleness.

### Register map (little-endian; f32 unless noted)

| Offset | Size | Field |
|---|---|---|
| 0x00 | u8 | status (bit0: BHY2 ok, bit1: BSEC valid) |
| 0x01 | u8 | sample counter (increments per snapshot refresh) |
| 0x02–0x0B | — | reserved (zero) |
| 0x0C | u8 | software revision |
| 0x0D | u8 | product id = `0x4D` ('M') |
| 0x0E–0x13 | 6 B | serial number (from nRF52 FICR device ID) |
| 0x14 | 3×f32 | accelerometer x, y, z (g) |
| 0x20 | 3×f32 | gyroscope x, y, z (dps) |
| 0x2C | 3×f32 | magnetometer x, y, z (µT) |
| 0x38 | 3×f32 | linear acceleration x, y, z (g) |
| 0x44 | 3×f32 | gravity x, y, z (g) |
| 0x50 | 5×f32 | quaternion w, x, y, z, accuracy |
| 0x64 | 3×f32 | euler heading, pitch, roll (°) |
| 0x70 | f32 | temperature (°C) |
| 0x74 | f32 | humidity (%RH) |
| 0x78 | f32 | pressure (hPa) |
| 0x7C | f32 | gas resistance (Ω) |
| 0x80 | f32 | BSEC IAQ |
| 0x84 | f32 | BSEC static IAQ |
| 0x88 | f32 | BSEC eCO2 (ppm) |
| 0x8C | f32 | BSEC bVOC equivalent |
| 0x90 | f32 | BSEC accuracy (0–3, stored as f32 for grid uniformity) |
| 0x94 | f32 | BSEC compensated temperature (°C) |
| 0x98 | f32 | BSEC compensated humidity (%RH) |
| 0xA0 | u32 | step count |
| 0xA4 | u32 | activity recognition bitfield |
| — | — | total dump length **0xA8 (168 bytes)** |

Note the deliberate gap: 0x9C is reserved/zero so the u32 block starts at 0xA0.
This table is the contract shared by the sketch, the Rust driver constants, the
frontend `values.ts`, and the Expanded register viewer; it is duplicated in the
firmware README.

## 2. Protobuf & queue

- New proto `protobufs/drivers/arduino-nicla-sense-me/arduino_nicla_sense_me.proto`,
  package `arduino_nicla_sense_me`, mirroring the Sense Env shapes but
  **Rx-only** (the Env's Tx/command half is dead code; we add a Tx queue only
  when something actually writes):
  - `ArduinoNiclaSenseMeSignalType`: `UNSPECIFIED / CONNECTED / DISCONNECTED /
    REGISTERS_SNAPSHOT / ERROR`
  - `ArduinoNiclaSenseMeDeviceInfo { software_revision, product_id, serial_number }`
  - `ArduinoNiclaSenseMeDevice { id, i2c_bus, i2c_address, info }`
  - `ArduinoNiclaSenseMeRxEnvelope { monotonic/local stamps, app_start_id,
    signal_type, device, data (full 168-byte register image), error }` — same
    field numbering style as the Env's `RxEnvelope`.
- `protobufs/station/drivers.proto`: `QDT_ARDUINO_NICLA_SENSE_ME_RX = 55`
  (54 = Victron is the last taken).
- Queue id: `arduino-nicla-sense-me/rx`.

## 3. Rust driver crate

`software/drivers/arduino-nicla-sense-me/` — a near-verbatim copy of
`arduino-nicla-sense-env` with names and constants swapped:

- `Cargo.toml`, `build.rs` (prost-build into `src/proto/`, gitignored),
  `src/lib.rs`, `src/driver.rs`.
- Constants: `RX_QUEUE_ID = "arduino-nicla-sense-me/rx"`,
  `DEFAULT_I2C_ADDRESS = 0x22`, `RAW_REGISTER_START = 0x00`,
  `RAW_REGISTER_LENGTH = 0xA8`, info registers `SOFTWARE_REVISION = 0x0C`,
  `PRODUCT_ID = 0x0D`, `SERIAL = 0x0E` (len 6).
- Same lifecycle as the Env driver: `normfs.resolve` +
  `ensure_queue_exists_for_write` + `station_engine.register_queue`; one worker
  task per board keyed by I2C bus; poll tick (`MissedTickBehavior::Skip`) →
  full-register SMBus block read → `REGISTERS_SNAPSHOT` envelope;
  `CONNECTED`/`DISCONNECTED` transition signals; error-string dedupe;
  last-good-image resend on disconnect/error.
- No value parsing in Rust beyond the info block (revision / product id /
  serial), same as Env.
- Kept deliberately for parity (not worth diverging for a single device): one
  board per bus, hard-coded I2C address, no shutdown path (`_tasks` leaked).

## 4. Station wiring

- Root `Cargo.toml`: add `software/drivers/arduino-nicla-sense-me` to
  workspace members (alphabetical, after `arduino-nicla-sense-env`).
- `software/station/bin/station/Cargo.toml`: extend the existing `arduino`
  feature to `["dep:arduino-nicla-sense-env", "dep:arduino-nicla-sense-me"]`;
  add the optional path dep under
  `[target.'cfg(target_os = "linux")'.dependencies]`. Reusing the feature
  means no CI workflow changes.
- `software/station/shared/station-iface/src/config.rs`: new
  `arduino-nicla-sense-me` section — `enabled` (default false), `poll-interval`
  (humantime, default 1s), `boards: [{ id (optional, default "i2c-<bus>"),
  i2c-bus }]`; `None` default on `Drivers`.
- `software/station/bin/station/src/main.rs` `start_drivers()`: the same
  three-arm cfg block as the Env driver (start when enabled / missing-feature
  warn / non-Linux warn); startup failure is logged, non-fatal.
- `software/station/bin/station/station.yaml`: add an enabled block for the
  X8 (bus number filled in at implementation/deploy time).

## 5. Frontend (station-viewer)

- **Codegen**: add the proto to `scripts/protobuf.sh`, run
  `npm run build:proto`, commit regenerated `src/api/proto.js` / `proto.d.ts`
  (both are checked in).
- **Live widget** (`src/devices/arduino-nicla-sense-me/`), auto-registered via
  `module.ts` (`id: 'arduino-nicla-sense-me'`, `field: 'arduinoNiclaSenseMe'`,
  `slot: 'summary'`, next free `order`):
  - Chosen design (validated visually): **orientation cube + compass**:
    - a CSS-3D cube driven by the quaternion/euler registers, with pitch/roll
      shown as numbers beneath;
    - a compass dial driven by the euler heading, with numeric heading +
      cardinal direction;
    - a row of magnitude numbers: |accel| (g), |gyro| (dps), |B| (µT);
    - environment pills as usual: temperature + humidity prominent, IAQ and
      pressure as pills; error state passed to `DeviceWidgetShell`.
    - Updates arrive at the poll rate (~1 Hz); a CSS transform transition of
      about one poll interval smooths cube/needle motion.
  - `values.ts`: bounds-checked little-endian readers for all mapped fields,
    returning `null` when the buffer is short.
- **History page** (manual per-sensor edits, exactly the Env's touch points):
  `frame-parser.ts` (Frame field, `DecodedEntry` union, reuse-by-pointer
  branch, `QDT_ARDUINO_NICLA_SENSE_ME_RX` decode case, frame assignment —
  single-valued field like the Env, matching one-board-per-bus),
  `queue-utils.ts`, `history-utils.ts`, `HistoryElement.tsx` (collapsed
  summary pills: temperature / humidity / IAQ), `HistoryPage.tsx`, plus a new
  `ArduinoNiclaSenseMeExpanded.tsx` register-map viewer grouped as
  Board / Motion / Orientation / Environment / Air Quality / Activity, with
  the generic Hex and JSON tabs.

## 6. Docs

- Sensors table row in `software/station/bin/station/README.md`.
- Firmware README (flash instructions macOS + Linux, register map).

## 7. Testing

- Mac-side: `cargo check` / `clippy` for the new crate and station (I2C is
  stubbed off-Linux, so everything compiles); `npm run build` for the viewer;
  unit tests for `values.ts` decoding against a hand-built 168-byte buffer.
- Hardware end-to-end on the Portenta X8 (user-driven): flash sketch → wire
  ESLOV to the X8 I2C bus → enable in `station.yaml` → verify live widget,
  History entries, and connect/disconnect signals by unplugging the sensor.

## Out of scope

- Tx/command queue and register writes (add when a real writer exists).
- Multiple boards on one bus / configurable I2C address.
- BHY2 host protocol against stock firmware.

## Addendum (2026-08-15): USB serial transport

Approved extension: the board serves the same 168-byte register image over its
USB CDC serial port, alongside I2C, and the driver gains a per-board
transport.

**Firmware.** `Serial.begin(115200)` (baud irrelevant for CDC; never block on
`!Serial`). In `loop()`: on receiving command byte `0x01` ("dump"), reply with
one frame: magic `0xA5 0x5A`, length byte `0xA8`, the 168-byte image copied
from `stableMap` (same consistency guarantee as the I2C latch), then CRC8
(poly 0x07, init 0x00) over the 168-byte payload only. Unknown command bytes
are ignored. No other commands: the image already carries identity
(product id 0x4D, serial) so the dump doubles as the probe response.

**Config.** Per-board `bus-type: i2c | usb` (serde default `i2c` — existing
YAML unchanged). `i2c-bus` becomes optional; required when `bus-type: i2c`
(invalid boards are logged and skipped at startup). USB boards have no
further fields: the port is autodetected.

**Driver.** Board transport enum (I2c{bus} | Usb). USB worker per tick /
reconnect: enumerate serial ports, filter USB VID `0x2341` PID `0x0060`
(Nicla Sense ME; on macOS prefer the `/dev/cu.*` callout device and skip
`/dev/tty.*` — hardware-validated 2026-08-15), open via tokio-serial at
115200, assert DTR (mbed's CDC stack treats the port as closed until the
host raises DTR), clear input, send
`0x01`, read exactly 172 bytes with a 500 ms timeout, validate
magic/length/CRC; on first connect additionally require product id 0x4D at
offset 0x0D. Signals, error dedupe, and last-good-image resend identical to
the I2C worker; every error drops the port and re-enumerates. One `usb`
board entry claims the first verified match.

**Proto.** `ArduinoNiclaSenseMeDevice` gains `string transport = 4`
("i2c"/"usb") and `string usb_port = 5` (additive; `i2c_bus`/`i2c_address`
stay 0 for USB boards).

**Station.** The `arduino-nicla-sense-me` dependency moves out of the
Linux-only section (the crate compiles everywhere; `i2c-async` stubs
non-Linux at runtime), and its `main.rs` cfg arms drop the `target_os`
restriction (feature-gated only). The station therefore runs this driver on
macOS: `usb` boards fully work; `i2c` boards produce runtime Error signals.
Env driver gating unchanged.

**Frontend.** Device labels (live widget + history) show `usb <port>` when
`transport == "usb"`; otherwise the existing `bus N / 0x22` form. No other
viewer changes.

**Verification.** Driver unit tests for CRC8 and frame parsing; a
`usb_probe` example binary in the driver crate for direct hardware smoke
tests; end-to-end acceptance = station running on the development Mac with
the board on USB, live widget + history flowing.

## Addendum (2026-08-16): Motion batching (USB only)

The 1 Hz snapshot cadence is fine for environment values but discards ~99%
of motion samples. The firmware therefore buffers motion samples at the
loop rate (~100 Hz) and the station drains them once per poll — USB
transport only (I2C keeps plain snapshots).

**Firmware.** A 256-slot ring buffer (static, ~4.9 KB + 1 KB timestamps)
records one motion sample per loop tick while BHY2 is up. The ~100 Hz loop rate
is maintained by an absolute 10 ms schedule (a fixed delay(10) plus loop work would yield
only ~50 Hz).
`dt_ms (u8, saturating) + accel x,y,z + gyro x,y,z + mag x,y,z` (each i16
raw counts, little-endian) = 19 bytes/sample. New serial command
`0x02` ("drain motion batch") replies with one frame:
magic `0xA5 0x5B`, then `count (u16 LE)`, `dropped (u16 LE, samples lost to
ring overflow since last drain)`, `first_sample_millis (u32 LE, board
millis() of the oldest sample; 0 when empty)`, then `count × 19` sample
bytes oldest-first, then CRC8 (poly 0x07, init 0) computed over everything
after the magic. Draining empties the ring and resets `dropped`. The reply
is streamed (incremental CRC), not buffered. Raw i16 counts are the wire
format; SI conversion uses the already-documented scale factors
(4096 LSB/g, 16.384 LSB/dps, 16 LSB/µT).

**Driver.** After each successful `0x01` snapshot, the USB worker sends
`0x02` and validates the reply (magic, count ≤ 256, exact length, CRC).
The validated blob minus magic and CRC (i.e. count/dropped/first_millis +
samples) is attached to the SAME `RxEnvelope` as the snapshot via a new
field `bytes motion = 21` (empty for I2C boards, connect/error signals, and
empty batches). Backward compatibility: firmware without `0x02` ignores the
byte, so on the first per-connection timeout of the motion request the
driver logs once, marks the connection as motion-unsupported, and keeps
polling snapshots alone.

**Viewer.** `parseMotionBatch` decodes the blob and scales to SI; the live
card's sparklines are fed from batches when present (fallback: the 1 Hz
snapshot value as before). Graph history window grows to ~600 samples
(~6 s at 100 Hz) and is decimated to the graph width with per-bucket
min/max so short spikes stay visible. Batch pushes are deduped per
envelope stamp.

**Cost.** ~2 KB/s queue growth (~170 MB/day) — acceptable against the 2 G
queue cap.

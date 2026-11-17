# Nicla Sense ME station firmware

Exposes the BHY2 sensor outputs of an Arduino Nicla Sense ME as a 124-byte
register map for the norma-core station `arduino-nicla-sense-me` driver over
USB serial: plug the board into the X8 over USB and the firmware streams a
snapshot every 10 ms (~100 Hz); see [USB serial transport](#usb-serial-transport).
The station autodetects every attached board and writes each one to its own
queue named after the board's serial number (register 0x0E).

The firmware publishes **only what the sensor hub measured** plus the metadata
needed to interpret it later: raw int16 counts with the full-scale ranges in
effect, the rotation-vector quaternion with its accuracy, raw environment
values, the BSEC air-quality outputs (Bosch's closed algorithm, not
reproducible later), counters and per-sensor freshness flags. Nothing derived
is computed on the board: unit scaling, gravity, linear acceleration,
roll/pitch/yaw and compass heading are all computed by the consumer
(`station-viewer/src/devices/arduino-nicla-sense-me/attitude.ts`) so they can
be recomputed on recorded data.

## Register map (little-endian, revision 6)

| Offset | Size | Field |
|---|---|---|
| 0x00 | u8 | status (bit0 BHY2 running) |
| 0x01 | u8 | sample counter (increments per firmware refresh while BHY2 is running; wraps) |
| 0x02–0x0B | — | reserved (zero) |
| 0x0C | u8 | software revision = 6 |
| 0x0D | u8 | product id = 0x4D |
| 0x0E–0x13 | 6 B | serial number (nRF52 FICR device id) |
| 0x14 | 3×i16 | accelerometer x, y, z, raw counts |
| 0x1A | 3×i16 | gyroscope x, y, z, raw counts |
| 0x20 | 3×i16 | magnetometer x, y, z, raw counts |
| 0x26 | u16 | accelerometer full scale in g, as read back from the hub (16 requested; re-read every 3 s; 0 = not read yet, see below) |
| 0x28 | u16 | gyroscope full scale in dps, as read back from the hub (2000 requested; re-read every 3 s; 0 = not read yet) |
| 0x2A | u16 | magnetometer full scale in µT, as read back from the hub (2500 for the BMM150; re-read every 3 s; 0 = not read yet) |
| 0x2C | 5×f32 | rotation vector quaternion w, x, y, z, accuracy (estimated heading error in rad; reads π while the magnetometer is uncalibrated, see the driver README) |
| 0x40 | f32 | temperature (°C) |
| 0x44 | f32 | humidity (%RH) |
| 0x48 | f32 | pressure (hPa) |
| 0x4C | f32 | gas resistance (Ω) |
| 0x50 | f32 | BSEC IAQ |
| 0x54 | f32 | BSEC static IAQ |
| 0x58 | f32 | BSEC eCO2 (ppm) |
| 0x5C | f32 | BSEC bVOC equivalent |
| 0x60 | f32 | BSEC compensated temperature (°C) |
| 0x64 | f32 | BSEC compensated humidity (%RH) |
| 0x68 | u8 | BSEC accuracy (0–3) |
| 0x69 | u8 | calibration-store flags: bit0 profile restored at boot, bit1 saved this session, bit2 storage/hub error (cleared by the next successful save), bit3 stored record ignored (other hub firmware), bit4 restore read-back verified, bit5 restore read-back mismatch; see [Calibration persistence](#calibration-persistence) |
| 0x6A | u8 | minutes since the last profile save, 255 = none this session |
| 0x6B | u8 | hub calibration status per sensor, 0–3 (3 = calibrated): bits 0–1 accelerometer, 2–3 gyroscope, 4–5 magnetometer; 0 until the hub reports one |
| 0x6C | u32 | step count |
| 0x70 | u32 | activity recognition bitfield |
| 0x74 | u32 | tick counter since boot |
| 0x78 | u16 | fresh-sample flags for this tick: bit0 accel, bit1 gyro, bit2 mag, bit3 quaternion, bit4 temperature, bit5 humidity, bit6 pressure, bit7 gas, bit8 BSEC, bit9 steps, bit10 activity |
| 0x7A–0x7B | — | reserved (zero) |
| — | — | total length 0x7C (124 bytes) |

The range registers hold what the hub reports as in effect. The accelerometer
and gyroscope ranges are requested before the sensors are enabled, because a
range changed on a running sensor takes effect only at a later event and the
samples until then are still at the old scale (BHI260AP datasheet 13.2.8 and
15.3.9); at start-up a register is published only once the hub confirms the
requested value. One of the three is
re-read each second, in turn, and after a failed read the hub is left alone
for 10 s: a read the hub does not answer blocks for 200 ms or more, which must
not happen every second inside the 10 ms tick. A register is written only when the hub's answer for exactly that
sensor arrived complete and holds a range the sensor can have (2/4/8/16 g;
125/250/500/1000/2000 dps; 2500 µT); otherwise it keeps its previous value. It reads 0
until the first good read, and consumers must not scale while it is 0 (the
viewer shows no value for that sensor; attitude and heading, which need only
the rotation vector, are unaffected). Always scale with the range register of the frame
being decoded.

This matters because the stock `getConfiguration()` of Arduino_BHY2 cannot be
trusted on this hub: whenever a status entry is pending it returns another
request's answer without reporting an error. Measured on the bench with the
previous firmware, 2 % of all frames carried a swapped scale (16 dps for the
gyroscope, then 2000 g for the accelerometer, a second each) in normal
operation; the "accel reported 7" seen at the first rev-6 flash was the same
fault. The firmware now reads hub parameters only through `src/nicla_hub.c`,
which empties the hub's status channel before every request and accepts only
the awaited answer (the header of that file describes the hub behaviour this
is built on). Bench result with the fix: 0 wrong frames, including with stale
entries injected on purpose.

Scaling, done by the consumer: `g = counts / 32768 × range_g`,
`dps = counts / 32768 × range_dps`, `µT = counts / 32768 × range_µT` (Bosch's
scale for the corrected magnetometer, BST-BHY2XX_BHI3XX-AN002 Table 2). Images
recorded before this register became a range hold 16 in it (a fixed 16 LSB/µT,
which read about 18 % low); the revision number did not change, so their
magnetometer values in µT are not usable, only the raw counts are. The quaternion
is already scaled by the Arduino_BHY2 library (fixed factor 1/16384) and the
registers read zero until the first rotation-vector sample lands; consumers
gate on the quaternion norm. The BHI260AP accepts at most 11 concurrent
virtual-sensor subscriptions with this stack (the 12th hard-faults), which is
why the derived virtual sensors (orientation, gravity, linear acceleration)
are not subscribed.

### Calibration persistence

The BHI260AP learns accelerometer, gyroscope and magnetometer calibration at
run time and keeps it in its own RAM, so a bare board starts every power cycle
uncalibrated: the rotation-vector accuracy (0x3C) reads π and the heading is
meaningless until the board has been moved through enough orientations. The
firmware (`src/bhy2_calibration.c`) removes that cost:

- **Restore:** right after the hub boots and before any sensor is enabled, the
  three BSX calibration profiles (hub parameters 0x201 accel, 0x203 gyro,
  0x205 mag; 72 / 200 / 408 bytes on this board) are read from the nRF52's
  flash and written into the hub. Each profile is its own record (Mbed KVStore
  keys `bhy2acc`, `bhy2gyr`, `bhy2mag`) with the hub kernel version, and for
  the magnetometer the heading accuracy it was saved at. A record saved under
  a different hub kernel version is ignored, and a profile the hub does not
  keep (read-back mismatch) counts as not stored, so the next good one
  replaces it. The records of earlier firmware (`bhy2cal`, `bhy2cal1/3/5`) are
  not read any more and are removed at boot; a board coming from that firmware
  calibrates once more.
- **Save:** automatic only, no host command. A profile is saved only while
  the hub reports **calibration status 3** ("calibration is completed") for
  its own sensor, and has done so for 30 s. That is Bosch's rule (datasheet
  13.3.3; BST-BHY2XX_BHI3XX-AN002 5.3.1), and the three are handled
  individually because they are rarely ready together: the accelerometer
  reaches 3 only after resting in six orientations, the gyroscope after ten
  seconds at rest, the magnetometer after being turned through enough
  directions. The status arrives as a meta event in the FIFO of the sensors
  that are subscribed anyway and is published in register 0x6B. Arduino_BHY2
  offers no callback for meta events (its build ignores callback
  registration), so the firmware takes them from the one place the library
  sends them, its debug stream: `src/nicla_hub_dev.cpp` describes the route.
  Bench (2026-11-17): the gyroscope reaches 3 about 9 s after a cold boot at
  rest and its profile is saved 30 s later; the accelerometer stays at 1 and
  the magnetometer at 0 on a board that is not moved, and neither is saved. A profile at
  status 3 is saved
  - when nothing usable is stored for it yet, or
  - as a refresh, after the status has been 3 for an hour: once per power
    cycle, then once per 24 hours. The profiles are live state whose bytes
    differ on every read, so the decision cannot be made on the bytes.

  The magnetometer profile also depends on the rotation-vector accuracy, the
  hub's estimate of the heading error. It falls as the fusion calibrates (π
  uncalibrated; resting level 0.436 rad on a clean bench, 0.53 rad next to
  steel), never falls while the board is at rest, and climbs slowly towards π
  while the board is shaken without being turned (0.02 rad per minute at 10 mg
  of vibration). The magnetometer profile is saved only when that accuracy has
  been below 0.6 rad and not rising for 30 s, and then when it is at least
  0.03 rad better than the accuracy stored with the record; its refresh needs
  the accuracy good and not rising for the hour as well. A rise of more than
  0.002 rad above the lowest value of the calm period restarts it, so nothing
  is saved while vibration is degrading the estimate.

  Bosch also suggests deleting a stored profile when the status falls below 3.
  That is not done: the magnetometer's status falls for any passing magnetic
  disturbance, and a restored profile that no longer fits is caught by the hub
  itself and then replaced by the rules above.

  At most one attempt per 10 minutes; an attempt saves every profile that is
  due. A profile that did not arrive from the hub complete (a section missing,
  repeated or out of order) is refused and not written. Power loss before the
  first good window simply leaves flash untouched. A failed flash write is
  retried once: Mbed's TDBStore rejects a record that ends exactly on the last
  byte of its 4 KB area (it writes the record, fails its own read-back check,
  compacts the store and returns an error), so the second write lands
  elsewhere.
- **Status:** register 0x69 flags, 0x6A minutes since the last save (254 =
  that long or longer) and 0x6B the three calibration statuses.

## Source layout

The sketch is only the glue that has to be C++ (the Arduino_BHY2 sensor
objects, `Serial`, the LED). All logic is plain C under `src/`:

| File | Contents |
|---|---|
| `src/nicla_protocol.[ch]` | register map layout and writers, validated range publishing, CRC8 frame, streaming keepalive state |
| `src/nicla_hub.[ch]` | hub parameter reads (ranges, calibration state) that cannot return another request's answer |
| `src/bhy2_calibration.[ch]` | calibration persistence |
| `src/nicla_bytes.h` | little-endian 16-bit read shared by the modules |
| `src/nicla_hub_dev.cpp` | hands the library's private hub handle and the hub's sensor-status events to the C code; the only other C++ |

### Formal verification

The C modules carry ACSL contracts (the comments starting with `/*@`) and are
verified with [Frama-C](https://frama-c.com), for **any** data the hub, the
flash store or the host may deliver. The hardware interfaces are replaced by
contract-only stand-ins in `verify/stubs`.

```bash
./verify/run.sh            # needs Docker; builds the Frama-C image on first use
```

The script runs two analyses and fails unless both pass:

1. **WP** proves every contract and the absence of runtime errors: no
   out-of-bounds access, overflow, invalid shift or division by zero, plus the
   stated behaviour (for example: a range register is only ever written with a
   valid range; a calibration blob from the hub or from flash can never
   overrun its buffer; a calibration profile is never written unless its own
   sensor is at status 3, and nothing is written within 10 minutes of the
   previous attempt). Every goal must come
   back proved, and no lemma is assumed.
2. **Eva** covers what WP cannot express. It must reach every statement of
   every function and raise no alarm for a misaligned pointer or an invalid
   function-pointer call. It also checks `nicla_f32_bits`, the five-line
   function that reinterprets a float as bytes, which WP's typed memory model
   rejects.

What the result still rests on: the stand-ins in `verify/stubs` describe the
Bosch and Mbed functions faithfully, Frama-C models the target as 32-bit x86
(same integer sizes, byte order and alignment as the Cortex-M4 for every type
this code uses), and the hub behaves as measured on the bench and written
down in `src/nicla_hub.h`. The proof covers the code's logic, not the hub.

## USB serial transport

The sketch serves a command protocol over the board's USB CDC serial port at
921600 baud. The Nicla's USB port is a SAMD11 serial-to-USB bridge, so the
baud is a real UART rate: it directly limits throughput and must match the
station driver's `SERIAL_BAUD`.

### Command 0x01: Register dump

Send the single byte `0x01`; the reply is one 128-byte frame: magic `0xA5 0x5A`,
length byte `0x7C`, the 124-byte register image (latched, internally consistent),
and a trailing CRC8 (poly 0x07, init 0x00) over the 124-byte payload.
While streaming is active the command is ignored: the pushed frame is the reply.

Kept for manual probing; the station driver uses streaming instead.

### Commands 0x02 / 0x03: Streaming

`0x02` starts streaming: the sketch pushes one frame per 10 ms tick (the
firmware refresh rate — a steady ~100 Hz) in the same CRC8-framed format.
`0x02` also acts as the keepalive: streaming expires unless it is repeated
within 2 s, so a dead host cannot leave the board transmitting. `0x03`
stops streaming immediately. The RGB LED glows red while streaming is
active. Unknown command bytes are ignored.

Hosts should send `0x03` when they open the port (a previous host may have
left the board streaming) and scan for the magic rather than assume a frame
starts at the first byte; the station driver does both. Frames whose length or
CRC fail are discarded and the scan resumes at the next byte.

## Flashing

Flashing is done from a workstation over USB (not from the X8). Run the
commands below from this directory (`device-support/arduino-nicla-sense-me`).

### macOS

```bash
cd device-support/arduino-nicla-sense-me
brew install arduino-cli
arduino-cli core update-index
arduino-cli core install arduino:mbed_nicla
arduino-cli lib install Arduino_BHY2 ArduinoBLE
arduino-cli board list                  # plug the Nicla in via USB; note the port, e.g. /dev/cu.usbmodem14101
arduino-cli compile --fqbn arduino:mbed_nicla:nicla_sense .
arduino-cli upload -p /dev/cu.usbmodem14101 --fqbn arduino:mbed_nicla:nicla_sense .
```

### Linux

```bash
cd device-support/arduino-nicla-sense-me
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh   # installs to ./bin
export PATH="$PWD/bin:$PATH"
arduino-cli core update-index
arduino-cli core install arduino:mbed_nicla   # also installs udev rules; re-plug the board afterwards
arduino-cli lib install Arduino_BHY2 ArduinoBLE
arduino-cli board list                  # note the port, e.g. /dev/ttyACM0
arduino-cli compile --fqbn arduino:mbed_nicla:nicla_sense .
arduino-cli upload -p /dev/ttyACM0 --fqbn arduino:mbed_nicla:nicla_sense .
```

If the upload fails with "port busy" or the board isn't listed, double-tap the
reset button to enter the bootloader (the LED pulses) and retry the upload.

## Verifying

Start the station with the driver enabled and the board plugged in. The
log reports the serial, firmware revision (expect 6) and the queue the board
streams into:

```
Arduino Nicla Sense ME <serial> (firmware rev 6) on /dev/ttyACM0 -> .../arduino-nicla-sense-me/<serial>/rx
```

The RGB LED glows red while the board is streaming to the station.

## Station configuration

```yaml
drivers:
  arduino-nicla-sense-me:
    enabled: true                   # autodetects every board by USB vid/pid 2341:0060
```

There is no per-board configuration. Boards are discovered by re-enumerating
serial ports every 500 ms, so plugging one in (or back in) is picked up
automatically. Each board streams into `arduino-nicla-sense-me/<serial>/rx`,
where `<serial>` is the lower-case hex of its six-byte serial number, so a
board keeps the same queue across re-plugs and port renames. A board writes
one 124-byte snapshot every 10 ms; plan normfs retention accordingly. The
driver and the viewer understand revision 6 only: a board running older
firmware is rejected as malformed frames and must be reflashed.

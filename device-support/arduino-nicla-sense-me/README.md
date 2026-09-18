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
| 0x26 | u16 | accelerometer full scale in g, as read back from the hub (16 requested; refreshed every second, see below) |
| 0x28 | u16 | gyroscope full scale in dps, as read back from the hub (2000 requested; refreshed every second) |
| 0x2A | u16 | magnetometer LSB per µT (16) |
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
| 0x69 | u8 | calibration-store flags: bit0 profile restored at boot, bit1 saved this session, bit2 storage/hub error, bit3 stored record ignored (other hub firmware), bit4 restore read-back verified, bit5 restore read-back mismatch; see [Calibration persistence](#calibration-persistence) |
| 0x6A | u8 | minutes since the last profile save, 255 = none this session |
| 0x6B | — | reserved (zero) |
| 0x6C | u32 | step count |
| 0x70 | u32 | activity recognition bitfield |
| 0x74 | u32 | tick counter since boot |
| 0x78 | u16 | fresh-sample flags for this tick: bit0 accel, bit1 gyro, bit2 mag, bit3 quaternion, bit4 temperature, bit5 humidity, bit6 pressure, bit7 gas, bit8 BSEC, bit9 steps, bit10 activity |
| 0x7A–0x7B | — | reserved (zero) |
| — | — | total length 0x7C (124 bytes) |

The range registers are re-read from the hub once a second, not only at
start-up: on hardware the configuration read 100 ms after `setRange` still
returned a stale value (accel reported 7 while 16 g was already in effect),
so a one-shot read-back would have frozen a wrong scale into every frame.
Always scale with the range register of the frame being decoded.

Scaling, done by the consumer: `g = counts / 32768 × range_g`,
`dps = counts / 32768 × range_dps`, `µT = counts / lsb_per_µT`. The quaternion
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
firmware (`src/bhy2_calibration.cpp`) removes that cost:

- **Restore:** right after the hub boots and before any sensor is enabled, the
  three BSX calibration profiles (hub parameters 0x201 accel, 0x203 gyro,
  0x205 mag; 72 / 200 / 408 bytes on this board) are read from the nRF52's
  flash (Mbed KVStore keys `bhy2cal1/3/5`) and written into the hub. A record
  is ignored if it was saved under a different hub kernel version.
- **Save:** automatic only, no host command. When the rotation-vector
  accuracy has stayed below 0.6 rad (~35°) for 30 s (the hub reports quantized
  levels: π uncalibrated, ~1.03 rad early, 0.436 rad = 25° once calibrated), the profiles are read
  back from the hub and written to flash if they changed since the last write,
  at most once per 10 minutes. Power loss before the first good window simply
  leaves flash untouched.
- **Status:** register 0x69 flags and 0x6A minutes since the last save.

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

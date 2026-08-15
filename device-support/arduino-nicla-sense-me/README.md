# Nicla Sense ME station firmware

Turns an Arduino Nicla Sense ME into an I2C register-map peripheral (address
`0x22`) for the norma-core station `arduino-nicla-sense-me` driver. Wire the
board to the Portenta X8 I2C bus via the ESLOV connector or the castellated
I2C pins.

Protocol: write one byte to set the register pointer; subsequent reads return
sequential bytes. Writing pointer `0x00` latches a consistent snapshot of all
values — the station driver reads the full 168-byte map in 32-byte chunks and
always starts at `0x00`, so every dump is internally consistent. The
`sample counter` register (0x01) increments per firmware refresh while BHY2
is running.

## Register map (little-endian)

| Offset | Size | Field |
|---|---|---|
| 0x00 | u8 | status (bit0 BHY2 ok, bit1 BSEC valid) |
| 0x01 | u8 | sample counter (increments per firmware refresh while BHY2 is running) |
| 0x02–0x0B | — | reserved (zero) |
| 0x0C | u8 | software revision |
| 0x0D | u8 | product id = 0x4D |
| 0x0E–0x13 | 6 B | serial number (nRF52 FICR device id) |
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
| 0x90 | f32 | BSEC accuracy (0–3 as f32) |
| 0x94 | f32 | BSEC compensated temperature (°C) |
| 0x98 | f32 | BSEC compensated humidity (%RH) |
| 0x9C | 4 B | reserved (zero) |
| 0xA0 | u32 | step count |
| 0xA4 | u32 | activity recognition bitfield |
| — | — | total length 0xA8 (168 bytes) |

## USB serial transport

The sketch serves two command protocols over the board's USB CDC serial port (any baud):

### Command 0x01: Register dump

Send the single byte `0x01`; the reply is one 172-byte frame: magic `0xA5 0x5A`, 
length byte `0xA8`, the 168-byte register image (latched, internally consistent), 
and a trailing CRC8 (poly 0x07, init 0x00) over the 168-byte payload.

### Command 0x02: Motion batch drain

Send the single byte `0x02`; the reply is a variable-length frame containing all 
accumulated motion samples:

- Magic: `0xA5 0x5B` (2 bytes)
- Count of samples in this batch: u16 LE (2 bytes)
- Dropped samples since last drain: u16 LE (2 bytes)
- Timestamp of first sample (sample 0), in milliseconds: u32 LE (4 bytes)
- Motion samples, 19 bytes each (up to 256 samples):
  - Elapsed time since previous sample, saturating to 255 ms: u8 (1 byte)
  - Accelerometer x, y, z: i16 LE each (6 bytes, raw counts; divide by 4096 LSB/g)
  - Gyroscope x, y, z: i16 LE each (6 bytes, raw counts; divide by 16.384 LSB/dps)
  - Magnetometer x, y, z: i16 LE each (6 bytes, raw counts; divide by 16 LSB/µT)
- CRC8 (poly 0x07, init 0x00) computed over all bytes from count through the last sample: u8 (1 byte)

The ring buffer is 256 samples; if the host does not drain frequently enough, older 
samples are overwritten. The `dropped` counter tracks how many samples were lost since 
the last successful drain. Once drained, the buffer is reset (count = 0, dropped = 0) 
and begins accumulating the next batch. One sample is recorded per firmware refresh tick 
(approximately every 10 ms, at ~100 Hz BHY2 rate) while BHY2 is running.

Unknown command bytes are ignored. The station's `arduino-nicla-sense-me` driver 
autodetects the board by USB VID/PID `2341:0060` when a board is configured with 
`bus-type: usb`.

## Flashing

Flashing is done from a workstation over USB (not from the X8).

### macOS

```bash
brew install arduino-cli
arduino-cli core update-index
arduino-cli core install arduino:mbed_nicla
arduino-cli lib install Arduino_BHY2 ArduinoBLE
arduino-cli board list                  # plug the Nicla in via USB; note the port, e.g. /dev/cu.usbmodem14101
arduino-cli compile --fqbn arduino:mbed_nicla:nicla_sense device-support/arduino-nicla-sense-me
arduino-cli upload -p /dev/cu.usbmodem14101 --fqbn arduino:mbed_nicla:nicla_sense device-support/arduino-nicla-sense-me
```

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh   # installs to ./bin
export PATH="$PWD/bin:$PATH"
arduino-cli core update-index
arduino-cli core install arduino:mbed_nicla   # also installs udev rules; re-plug the board afterwards
arduino-cli lib install Arduino_BHY2 ArduinoBLE
arduino-cli board list                  # note the port, e.g. /dev/ttyACM0
arduino-cli compile --fqbn arduino:mbed_nicla:nicla_sense device-support/arduino-nicla-sense-me
arduino-cli upload -p /dev/ttyACM0 --fqbn arduino:mbed_nicla:nicla_sense device-support/arduino-nicla-sense-me
```

If the upload fails with "port busy" or the board isn't listed, double-tap the
reset button to enter the bootloader (the LED pulses) and retry the upload.

## Verifying from the X8

With the board wired to bus 2 (adjust as needed):

```bash
i2cdetect -y 2                          # expect a device at 0x22
i2ctransfer -y 2 w1@0x22 0x0c r2        # expect: firmware revision, then 0x4d (product id)
```

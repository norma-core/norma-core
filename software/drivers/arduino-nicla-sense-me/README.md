# Arduino Nicla Sense ME driver

Station driver for the [Arduino Nicla Sense ME](https://docs.arduino.cc/hardware/nicla-sense-me)
(BHI260AP IMU, BMM150 magnetometer, BMP390 barometer, BME688 gas sensor) running the
[norma-core firmware](../../../device-support/arduino-nicla-sense-me). Boards are
attached over USB; the driver discovers every one automatically and streams each
board's full 124-byte register snapshot (firmware revision 6) into its own queue
at ~100 Hz. Frames of any other length are discarded as malformed, so a board
on older firmware never produces data until it is reflashed.

The register map, wire protocol and flashing instructions live in the
[firmware README](../../../device-support/arduino-nicla-sense-me/README.md).
This document covers the station side: configuration, queues and what the
driver does at runtime.

## Configuration

Add the block under `drivers` in `station.yaml`:

```yaml
drivers:
  arduino-nicla-sense-me:
    enabled: true
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | bool | `false` | Start the driver. Omitting the whole block also leaves it off. |

That is the entire configuration. There is no port, baud or board list:

- **Boards are autodetected** by USB vendor/product id `2341:0060` (the Nicla's
  SAMD11 USB bridge). Serial ports are re-enumerated every 500 ms, so a board
  plugged in after the station started, or re-plugged under a new path, is
  picked up without a restart.
- **The baud rate is fixed** at 921600 and must match the firmware. It is a real
  UART rate between the bridge and the nRF52, so it bounds throughput; it is a
  constant in the driver, not a config key.
- **Multiple boards** work out of the box; each gets its own worker and queue.
## Reading the data

The driver forwards the firmware's register image untouched in
`RxEnvelope.data`; decoding lives in the consumer
(`station-viewer/src/devices/arduino-nicla-sense-me/values.ts`). The register
map is documented in the firmware README. One field deserves a note because it
is easy to misread.

### Quaternion accuracy (register 0x3C)

The fifth float of the quaternion block (0x2C w, 0x30 x, 0x34 y, 0x38 z,
**0x3C accuracy**) is the sensor hub's own estimate of the rotation vector's
**heading error, in radians**. It comes from the 16-bit accuracy field of the
BHY2 rotation-vector FIFO packet; the Arduino_BHY2 library scales that field by
the same 1/16384 factor it applies to w/x/y/z
(`Arduino_BHY2/src/sensors/DataParser.cpp`, `parseQuaternion`), and the
firmware writes the result as-is.

How to read it:

- **≈ 3.142 (π):** the magnetometer is not calibrated yet. The fusion has no
  usable heading reference, the quaternion sits near identity for a level
  board, and any heading derived from it is meaningless. Tilt (pitch/roll,
  gravity, linear acceleration) is still usable because it comes from the
  accelerometer and gyroscope; on the bench the gravity vector derived from the
  quaternion matched the accelerometer to a few thousandths of a g while the
  accuracy still read π.
- **Dropping well below π:** the hub has locked onto the earth field and the
  heading can be trusted to roughly that many radians. Calibrate by moving the
  board through a figure-eight for a few seconds; the value falls as the
  calibration converges. Calibration is not persisted across power cycles.

The viewer shows the value in the history detail panel and does not gate on it:
it only rejects a quaternion whose norm is far from 1 (unpopulated registers).
A consumer that wants a trustworthy compass should additionally require the
accuracy to be below its own threshold; the raw value is recorded in every frame
so that decision can be made, or changed, later.

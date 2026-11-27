# Arduino Nicla Sense ME driver

Station driver for the [Arduino Nicla Sense ME](https://docs.arduino.cc/hardware/nicla-sense-me)
(BHI260AP IMU, BMM150 magnetometer, BMP390 barometer, BME688 gas sensor) running the
[norma-core firmware](../../../device-support/arduino-nicla-sense-me). Boards are
attached over USB; the driver discovers every one automatically and streams each
board's full 168-byte register snapshot into its own queue at ~100 Hz.

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
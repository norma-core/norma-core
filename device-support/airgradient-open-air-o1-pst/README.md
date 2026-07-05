# AirGradient Open Air (O-1PST) Serial Firmware 🌫️

Reflashes an **AirGradient Open Air (O-1PST)** so it streams readings as plain
JSON over USB — the format the station's `airgradient-open-air-o-1pst` driver
reads.

## Why ❓

The station reads the O-1PST over USB serial: the driver opens the port and
parses one JSON line per second. Stock AirGradient firmware is Wi-Fi/cloud
oriented and emits no such stream, so you flash it once with the minimal ESPHome
build here, which disables all networking and prints straight to serial.

## What You Get 📦

- Offline operation — Wi-Fi, API, and OTA disabled.
- One JSON line/sec at `115200` baud with every metric:

  ```json
  {"pm1_0": 2, "pm2_5": 3, "pm10_0": 4, "temp_c": 28.2, "humidity": 35.0, "co2": 438, "voc_index": 55, "nox_index": 1}
  ```

- SGP41 VOC/NOx compensated from the Plantower temp/humidity.
- ESPHome prints it as a `WARN` log line (`[W][main:538]: {…}`); the driver
  extracts the `{…}`, ignoring the prefix.

`o-1pst-serial.yaml` maps the ESP32-C3 GPIO pins, the three sensors (PMS5003T,
SenseAir S8, SGP41), and the 1-second JSON output.

## Flash 🔥

Needs the [ESPHome CLI](https://esphome.io/guides/installing_esphome) and a
data-capable USB-C cable. Wi-Fi is disabled, so the first flash must be over USB.

1. Hold the config button while plugging in (enters the ESP32-C3 bootloader).
2. Compile + flash, then watch the stream:

   **Host:**

   ```bash
   esphome run o-1pst-serial.yaml
   esphome logs o-1pst-serial.yaml
   ```

`co2`/`voc_index`/`nox_index` may read `0` while warming up (normal). A not-ready
sensor can print `nan`, which is invalid JSON — the driver skips that line until
all sensors report numbers.

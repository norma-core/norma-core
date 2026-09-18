/*
 * Nicla Sense ME → register-map sensor for norma-core station.
 *
 * Exposes the BHY2 sensor outputs as a 124-byte little-endian register map.
 * The firmware publishes only what the sensor hub measured plus the metadata
 * needed to interpret it later (full-scale ranges, per-sensor freshness
 * flags, counters). Nothing derived is computed here: unit scaling, gravity,
 * linear acceleration, roll/pitch/yaw and heading are all computed by the
 * consumer (station-viewer) from the raw counts and the rotation vector, so
 * they can be recomputed on recorded data.
 *
 * The map layout is the contract shared with
 * software/drivers/arduino-nicla-sense-me and the station-viewer; see
 * README.md in this directory. The image is served over USB CDC serial as
 * CRC8-framed snapshots, either one per 0x01 request or streamed at the
 * 10 ms tick rate after 0x02 (see the serial protocol constants below).
 */

#include "Arduino_BHY2.h"
#include "Nicla_System.h"
#include "nrf.h"

#include "src/bhy2_calibration.h"

constexpr size_t REG_MAP_SIZE = 0x7C;
constexpr uint8_t SOFTWARE_REVISION = 6;
constexpr uint8_t PRODUCT_ID = 0x4D; // 'M'

// Register offsets (must match the station driver + viewer).
constexpr size_t REG_STATUS = 0x00;          // bit0: BHY2 running
constexpr size_t REG_SAMPLE_COUNTER = 0x01;  // u8, wraps
constexpr size_t REG_SOFTWARE_REVISION = 0x0C;
constexpr size_t REG_PRODUCT_ID = 0x0D;
constexpr size_t REG_SERIAL = 0x0E;          // 6 bytes
constexpr size_t REG_ACCEL_RAW = 0x14;       // 3 x i16 counts
constexpr size_t REG_GYRO_RAW = 0x1A;        // 3 x i16 counts
constexpr size_t REG_MAG_RAW = 0x20;         // 3 x i16 counts
constexpr size_t REG_ACCEL_RANGE_G = 0x26;   // u16, full scale in g
constexpr size_t REG_GYRO_RANGE_DPS = 0x28;  // u16, full scale in dps
constexpr size_t REG_MAG_LSB_PER_UT = 0x2A;  // u16
constexpr size_t REG_QUAT = 0x2C;            // w, x, y, z, accuracy (5 x f32)
constexpr size_t REG_TEMPERATURE = 0x40;
constexpr size_t REG_HUMIDITY = 0x44;
constexpr size_t REG_PRESSURE = 0x48;
constexpr size_t REG_GAS = 0x4C;
constexpr size_t REG_IAQ = 0x50;
constexpr size_t REG_IAQ_STATIC = 0x54;
constexpr size_t REG_ECO2 = 0x58;
constexpr size_t REG_BVOC = 0x5C;
constexpr size_t REG_COMP_TEMPERATURE = 0x60;
constexpr size_t REG_COMP_HUMIDITY = 0x64;
constexpr size_t REG_BSEC_ACCURACY = 0x68;   // u8
constexpr size_t REG_CALIB_FLAGS = 0x69;     // u8, bhy2calib::FLAG_*
constexpr size_t REG_CALIB_MINUTES = 0x6A;   // u8, minutes since last profile save (255 = none)
constexpr size_t REG_STEP_COUNT = 0x6C;      // u32
constexpr size_t REG_ACTIVITY = 0x70;        // u32 bitfield
constexpr size_t REG_TICK_COUNTER = 0x74;    // u32, loop ticks since boot
constexpr size_t REG_FRESH_FLAGS = 0x78;     // u16, see FRESH_* below

// Freshness bits: the virtual sensor delivered a new sample during this tick.
constexpr uint16_t FRESH_ACCEL = 1u << 0;
constexpr uint16_t FRESH_GYRO = 1u << 1;
constexpr uint16_t FRESH_MAG = 1u << 2;
constexpr uint16_t FRESH_QUAT = 1u << 3;
constexpr uint16_t FRESH_TEMPERATURE = 1u << 4;
constexpr uint16_t FRESH_HUMIDITY = 1u << 5;
constexpr uint16_t FRESH_PRESSURE = 1u << 6;
constexpr uint16_t FRESH_GAS = 1u << 7;
constexpr uint16_t FRESH_BSEC = 1u << 8;
constexpr uint16_t FRESH_STEPS = 1u << 9;
constexpr uint16_t FRESH_ACTIVITY = 1u << 10;

// Full-scale ranges requested from the hub. The values actually in effect are
// read back from the hub and published in the range registers; consumers
// must scale from those, never from these constants.
constexpr uint16_t ACCEL_RANGE_G = 16;    // maximum the BHI260AP offers
constexpr uint16_t GYRO_RANGE_DPS = 2000; // maximum the BHI260AP offers
// The BMM150 magnetometer has a fixed 16 LSB/uT (0.0625 uT/LSB) resolution
// in the BHY2 output; recorded so consumers never hard-code it.
constexpr uint16_t MAG_LSB_PER_UT = 16;

// USB serial protocol (contract with the station driver). Frame format:
//   [0xA5, 0x5A, 0x7C, <124-byte register image>, crc8(payload)]
// CRC8 is poly 0x07, init 0x00, computed over the payload only.
// Commands (single bytes; unknown bytes are ignored):
//   0x01 DUMP          - reply with one frame (request/reply probing);
//                        ignored while streaming, the pushed frame is the reply
//   0x02 STREAM_START  - push one frame per 10 ms tick; also the keepalive:
//                        streaming stops unless refreshed within 2 s, so a
//                        dead host cannot leave the board transmitting
//   0x03 STREAM_STOP   - stop pushing immediately
constexpr uint8_t SERIAL_CMD_DUMP = 0x01;
constexpr uint8_t SERIAL_CMD_STREAM_START = 0x02;
constexpr uint8_t SERIAL_CMD_STREAM_STOP = 0x03;
constexpr uint32_t STREAM_KEEPALIVE_TIMEOUT_MS = 2000;
constexpr uint8_t SERIAL_MAGIC0 = 0xA5;
constexpr uint8_t SERIAL_MAGIC1 = 0x5A;

static uint8_t crc8Update(uint8_t crc, uint8_t byte) {
  crc ^= byte;
  for (uint8_t bit = 0; bit < 8; bit++) {
    crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x07) : (uint8_t)(crc << 1);
  }
  return crc;
}

static uint8_t crc8(const uint8_t *data, size_t len) {
  uint8_t crc = 0;
  for (size_t i = 0; i < len; i++) {
    crc = crc8Update(crc, data[i]);
  }
  return crc;
}

// IMPORTANT: the BHI260AP handles at most 11 concurrent virtual-sensor
// subscriptions with this firmware — the 12th begin() hard-faults the
// host library (verified empirically on hardware, 2026-08-15). Exactly 11
// sensors are subscribed below. Do not add a 12th subscription; anything
// derivable (euler, gravity, linear acceleration) is computed by the
// consumer from the rotation vector and the accelerometer.
SensorXYZ accel(SENSOR_ID_ACC);
SensorXYZ gyro(SENSOR_ID_GYRO);
SensorXYZ mag(SENSOR_ID_MAG);
SensorQuaternion quat(SENSOR_ID_RV);
Sensor temperature(SENSOR_ID_TEMP);
Sensor humidity(SENSOR_ID_HUM);
Sensor pressure(SENSOR_ID_BARO);
Sensor gas(SENSOR_ID_GAS);
SensorBSEC bsec(SENSOR_ID_BSEC);
Sensor stepCounter(SENSOR_ID_STC);
SensorActivity activity(SENSOR_ID_AR);

// Register image; written only by loop(), which also sends it, so every
// frame is a complete snapshot of one tick.
static uint8_t regMap[REG_MAP_SIZE];
static bool bhy2Ok = false;
static uint32_t tickCounter = 0;

// Streaming deadline: 0 = off, otherwise millis() time when the stream
// expires unless another STREAM_START keepalive arrives.
static uint32_t streamDeadlineMillis = 0;

static void sendDumpFrame() {
  uint8_t frame[3 + REG_MAP_SIZE + 1];
  frame[0] = SERIAL_MAGIC0;
  frame[1] = SERIAL_MAGIC1;
  frame[2] = (uint8_t)REG_MAP_SIZE;
  memcpy(frame + 3, regMap, REG_MAP_SIZE);
  frame[3 + REG_MAP_SIZE] = crc8(frame + 3, REG_MAP_SIZE);
  Serial.write(frame, sizeof(frame));
}

static bool streamActive() {
  return streamDeadlineMillis != 0 &&
         (int32_t)(streamDeadlineMillis - millis()) > 0;
}

static void serviceSerialCommands() {
  // Bounded per call: drain at most a small budget of bytes and send at
  // most one dump reply, so a chatty or misbehaving host can never starve
  // sensor updates. Every byte in the budget is applied before replying,
  // so DUMP followed by STREAM_STOP in one batch yields exactly one frame.
  bool dumpRequested = false;
  for (int budget = 0; budget < 16 && Serial.available() > 0; budget++) {
    int cmd = Serial.read();
    if (cmd == SERIAL_CMD_STREAM_START) {
      streamDeadlineMillis = millis() + STREAM_KEEPALIVE_TIMEOUT_MS;
      if (streamDeadlineMillis == 0) {
        streamDeadlineMillis = 1; // keep 0 reserved for "off" across wrap
      }
    } else if (cmd == SERIAL_CMD_STREAM_STOP) {
      streamDeadlineMillis = 0;
    } else if (cmd == SERIAL_CMD_DUMP) {
      dumpRequested = true;
    }
    // unknown bytes are ignored
  }
  // While streaming the pushed frame is the reply; answering DUMP as well
  // would put a second blocking write into the tick.
  if (dumpRequested && !streamActive()) {
    sendDumpFrame();
  }
}

static void writeF32(uint8_t *map, size_t offset, float value) {
  memcpy(map + offset, &value, sizeof(value));
}

static void writeU32(uint8_t *map, size_t offset, uint32_t value) {
  memcpy(map + offset, &value, sizeof(value));
}

static void writeU16(uint8_t *map, size_t offset, uint16_t value) {
  memcpy(map + offset, &value, sizeof(value));
}

static void writeI16(uint8_t *map, size_t offset, int16_t value) {
  memcpy(map + offset, &value, sizeof(value));
}

// SensorXYZ::x()/y()/z() return the hub's raw int16 counts unscaled
// (Arduino_BHY2/src/sensors/SensorXYZ.h); they are written as-is.
static void writeRawVec3(uint8_t *map, size_t offset, SensorXYZ &sensor) {
  writeI16(map, offset, sensor.x());
  writeI16(map, offset + 2, sensor.y());
  writeI16(map, offset + 4, sensor.z());
}

// Reads a sensor's data-available flag for this tick and clears it, so the
// flag reports "new sample since the previous tick". Takes the common
// SensorClass base (not a template: the Arduino sketch preprocessor mangles
// template prototypes).
static uint16_t takeFresh(SensorClass &sensor, uint16_t bit) {
  if (!sensor.dataAvailable()) {
    return 0;
  }
  sensor.clearDataAvailFlag();
  return bit;
}

// Publishes the full-scale ranges the hub reports as in effect. Called at
// start-up and refreshed once a second from loop(): the read-back is a
// host↔hub transaction, and a value read too early after setRange can be
// stale, so the registers self-heal instead of freezing a wrong scale.
static void publishRanges() {
  writeU16(regMap, REG_ACCEL_RANGE_G, accel.getConfiguration().range);
  writeU16(regMap, REG_GYRO_RANGE_DPS, gyro.getConfiguration().range);
}

void setup() {
  // RGB LED (IS31FL3194 on the internal I2C bus): red = USB streaming
  // active, off = idle.
  nicla::begin();
  nicla::leds.begin();
  nicla::leds.setColor(0, 0, 0);

  memset(regMap, 0, sizeof(regMap));

  regMap[REG_SOFTWARE_REVISION] = SOFTWARE_REVISION;
  regMap[REG_PRODUCT_ID] = PRODUCT_ID;
  // 6-byte serial from the nRF52 factory device id. The station names the
  // board's queue after it, so it must be stable across reboots (it is).
  uint32_t serialWords[2] = { NRF_FICR->DEVICEID[0], NRF_FICR->DEVICEID[1] };
  memcpy(&regMap[REG_SERIAL], serialWords, 6);
  writeU16(regMap, REG_MAG_LSB_PER_UT, MAG_LSB_PER_UT);

  bhy2Ok = BHY2.begin(NICLA_STANDALONE);
  if (bhy2Ok) {
    // Stored calibration profiles are loaded "at system boot" (Bosch AN002),
    // i.e. before the virtual sensors are enabled.
    bhy2calib::restoreProfiles();
  }
  if (bhy2Ok) {
    // Exactly 11 subscriptions (hardware limit, see note at the sensor
    // declarations). Rates: motion at 100 Hz (the loop refreshes at ~100 Hz),
    // environment/air-quality/activity at 1 Hz — their physical processes are
    // slow, and the default 1000 Hz overwhelms the sensor hub's FIFO path.
    accel.begin(100);
    gyro.begin(100);
    mag.begin(100);
    quat.begin(100);
    temperature.begin(1);
    humidity.begin(1);
    pressure.begin(1);
    gas.begin(1);
    bsec.begin(1, 0);
    stepCounter.begin(1);
    activity.begin(1);

    // Full-scale ranges: request the maximum, then publish what the hub
    // reports is in effect (setRange after begin, as in the library's
    // IMURangeSettings example). If the request fails the read-back still
    // records the range actually used, so recorded counts stay scalable.
    accel.setRange(ACCEL_RANGE_G);
    gyro.setRange(GYRO_RANGE_DPS);
    delay(100);
    publishRanges();
  }

  // Serial for the USB transport. On the Nicla the USB port is a SAMD11
  // serial-to-USB BRIDGE, so this is a real UART baud rate and directly
  // limits throughput. Must match the station driver's SERIAL_BAUD. Never
  // wait for !Serial (headless).
  Serial.begin(921600);
}

void loop() {
  uint16_t fresh = 0;
  if (bhy2Ok) {
    BHY2.update();
    fresh |= takeFresh(accel, FRESH_ACCEL);
    fresh |= takeFresh(gyro, FRESH_GYRO);
    fresh |= takeFresh(mag, FRESH_MAG);
    fresh |= takeFresh(quat, FRESH_QUAT);
    fresh |= takeFresh(temperature, FRESH_TEMPERATURE);
    fresh |= takeFresh(humidity, FRESH_HUMIDITY);
    fresh |= takeFresh(pressure, FRESH_PRESSURE);
    fresh |= takeFresh(gas, FRESH_GAS);
    fresh |= takeFresh(bsec, FRESH_BSEC);
    fresh |= takeFresh(stepCounter, FRESH_STEPS);
    fresh |= takeFresh(activity, FRESH_ACTIVITY);
  }

  writeRawVec3(regMap, REG_ACCEL_RAW, accel);
  writeRawVec3(regMap, REG_GYRO_RAW, gyro);
  writeRawVec3(regMap, REG_MAG_RAW, mag);

  // SensorQuaternion (Arduino_BHY2/src/sensors/SensorQuaternion.h) scales
  // x/y/z/w/accuracy internally by a fixed 1/16384, so these are the final
  // values. Unpopulated registers read as zeros until the first rotation
  // vector sample; consumers gate on the quaternion norm, not on a flag.
  writeF32(regMap, REG_QUAT, quat.w());
  writeF32(regMap, REG_QUAT + 4, quat.x());
  writeF32(regMap, REG_QUAT + 8, quat.y());
  writeF32(regMap, REG_QUAT + 12, quat.z());
  writeF32(regMap, REG_QUAT + 16, quat.accuracy());

  writeF32(regMap, REG_TEMPERATURE, temperature.value());
  writeF32(regMap, REG_HUMIDITY, humidity.value());
  writeF32(regMap, REG_PRESSURE, pressure.value());
  writeF32(regMap, REG_GAS, gas.value());

  // BSEC outputs come from Bosch's closed algorithm with internal state and
  // cannot be recomputed later, so they are published as measured.
  writeF32(regMap, REG_IAQ, (float)bsec.iaq());
  writeF32(regMap, REG_IAQ_STATIC, (float)bsec.iaq_s());
  writeF32(regMap, REG_ECO2, (float)bsec.co2_eq());
  writeF32(regMap, REG_BVOC, bsec.b_voc_eq());
  writeF32(regMap, REG_COMP_TEMPERATURE, bsec.comp_t());
  writeF32(regMap, REG_COMP_HUMIDITY, bsec.comp_h());
  regMap[REG_BSEC_ACCURACY] = bsec.accuracy();

  // Calibration persistence: the rotation-vector accuracy drives auto-save.
  // An unpopulated quaternion reads all zeros (accuracy 0 as well), which must
  // not count as "calibrated", hence the norm gate.
  {
    const float qw = quat.w(), qx = quat.x(), qy = quat.y(), qz = quat.z();
    const bool rvPopulated = (qw * qw + qx * qx + qy * qy + qz * qz) > 0.25f;
    if (bhy2Ok) {
      bhy2calib::service(rvPopulated ? quat.accuracy() : 100.0f, millis());
    }
    const bhy2calib::Status calib = bhy2calib::status(millis());
    regMap[REG_CALIB_FLAGS] = calib.flags;
    regMap[REG_CALIB_MINUTES] = calib.minutesSinceSave;
  }

  writeU32(regMap, REG_STEP_COUNT, (uint32_t)stepCounter.value());
  writeU32(regMap, REG_ACTIVITY, (uint32_t)activity.value());

  regMap[REG_STATUS] = bhy2Ok ? 0x01 : 0x00;
  if (bhy2Ok) {
    regMap[REG_SAMPLE_COUNTER] = regMap[REG_SAMPLE_COUNTER] + 1;
    tickCounter++;
    if (tickCounter % 100 == 0) {
      publishRanges();
    }
  }
  writeU32(regMap, REG_TICK_COUNTER, tickCounter);
  writeU16(regMap, REG_FRESH_FLAGS, fresh);

  serviceSerialCommands();
  const bool streaming = streamActive();
  if (!streaming) {
    // Stopped or expired: clear the deadline, otherwise the signed
    // difference in streamActive() turns positive again once millis()
    // wraps past it (~24.8 days) and streaming would resume unattended.
    streamDeadlineMillis = 0;
  }
  static bool streamLedOn = false;
  if (streaming != streamLedOn) {
    // Red while streaming, off when idle (or ~2s after the host dies).
    // Written only on state change: setColor is an internal-I2C transaction
    // and has no business running every 10 ms tick.
    nicla::leds.setColor(streaming ? 255 : 0, 0, 0);
    streamLedOn = streaming;
  }
  if (streaming) {
    // Streaming mode: push the snapshot this tick just committed. One frame
    // per tick = exactly the firmware refresh rate (~100 Hz).
    sendDumpFrame();
  }

  // Absolute 10 ms schedule (not a fixed delay): the loop body itself takes
  // several milliseconds, so a plain delay(10) would drop the effective
  // sample rate to ~50 Hz. Serial requests are serviced roughly every
  // millisecond DURING the pacing wait — serving them only once per tick
  // quantized the host's poll round-trip to whole ticks and capped USB
  // polling at ~33 Hz (hardware-measured). If a tick overruns,
  // resynchronize instead of trying to catch up.
  static uint32_t nextTickMillis = 0;
  if (nextTickMillis == 0) {
    nextTickMillis = millis();
  }
  nextTickMillis += 10;
  while ((int32_t)(nextTickMillis - millis()) > 0) {
    serviceSerialCommands();
    delay(1);
  }
  if ((int32_t)(nextTickMillis - millis()) < -10) {
    nextTickMillis = millis();
  }
}

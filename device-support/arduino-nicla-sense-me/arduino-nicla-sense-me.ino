/*
 * Nicla Sense ME → register-map sensor for norma-core station.
 *
 * Exposes all BHY2 sensor outputs as a 168-byte little-endian register map.
 * The map layout is the contract shared with
 * software/drivers/arduino-nicla-sense-me and the station-viewer; see
 * README.md in this directory. The image is served over USB CDC serial as
 * CRC8-framed snapshots, either one per 0x01 request or streamed at the
 * 10 ms tick rate after 0x02 (see the serial protocol constants below).
 */

#include "Arduino_BHY2.h"
#include "Nicla_System.h"
#include "nrf.h"

constexpr size_t REG_MAP_SIZE = 0xA8;
constexpr uint8_t SOFTWARE_REVISION = 5;
constexpr uint8_t PRODUCT_ID = 0x4D; // 'M'

// Register offsets (must match the station driver + viewer).
constexpr size_t REG_STATUS = 0x00;
constexpr size_t REG_SAMPLE_COUNTER = 0x01;
constexpr size_t REG_SOFTWARE_REVISION = 0x0C;
constexpr size_t REG_PRODUCT_ID = 0x0D;
constexpr size_t REG_SERIAL = 0x0E; // 6 bytes
constexpr size_t REG_ACCEL = 0x14;
constexpr size_t REG_GYRO = 0x20;
constexpr size_t REG_MAG = 0x2C;
constexpr size_t REG_LACC = 0x38;
constexpr size_t REG_GRAVITY = 0x44;
constexpr size_t REG_QUAT = 0x50; // w, x, y, z, accuracy
constexpr size_t REG_EULER = 0x64; // heading, pitch, roll
constexpr size_t REG_TEMPERATURE = 0x70;
constexpr size_t REG_HUMIDITY = 0x74;
constexpr size_t REG_PRESSURE = 0x78;
constexpr size_t REG_GAS = 0x7C;
constexpr size_t REG_IAQ = 0x80;
constexpr size_t REG_IAQ_STATIC = 0x84;
constexpr size_t REG_ECO2 = 0x88;
constexpr size_t REG_BVOC = 0x8C;
constexpr size_t REG_BSEC_ACCURACY = 0x90;
constexpr size_t REG_COMP_TEMPERATURE = 0x94;
constexpr size_t REG_COMP_HUMIDITY = 0x98;
constexpr size_t REG_STEP_COUNT = 0xA0;
constexpr size_t REG_ACTIVITY = 0xA4;

// BHI260AP default full-scale ranges → SI conversion factors. SensorXYZ
// returns raw int16 ADC counts (see Arduino_BHY2/src/sensors/SensorXYZ.h),
// so these divisors convert to physical units ourselves. Values follow the
// library's own IMURangeSettings example (raw / 32768 * range), using the
// *default* (unconfigured) full-scale ranges: accel/gravity/linear-accel
// default to +/-8g, gyro defaults to +/-2000dps, and the BMM150 magnetometer
// has a fixed 16 LSB/uT resolution.
constexpr float ACCEL_LSB_PER_G = 4096.0f;    // 32768 / 8g
constexpr float GYRO_LSB_PER_DPS = 16.384f;   // 32768 / 2000dps
constexpr float MAG_LSB_PER_UT = 16.0f;       // BMM150 0.0625 uT/LSB

// USB serial protocol (contract with the station driver). Frame format:
//   [0xA5, 0x5A, 0xA8, <168-byte register image>, crc8(payload)]
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
// host library (verified empirically on hardware, 2026-08-15). We therefore
// subscribe to exactly 11 sensors and DERIVE euler (from the quaternion),
// gravity (quaternion-rotated 1g), and linear acceleration (accel minus
// gravity) in software. Do not add a 12th subscription.
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
  // would put a second blocking 172-byte write (~2 ms) into the tick.
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

static void writeVec3(uint8_t *map, size_t offset, SensorXYZ &sensor, float lsbPerUnit) {
  writeF32(map, offset, sensor.x() / lsbPerUnit);
  writeF32(map, offset + 4, sensor.y() / lsbPerUnit);
  writeF32(map, offset + 8, sensor.z() / lsbPerUnit);
}

// Euler angles (aircraft convention, degrees; heading normalized to 0..360)
// derived from the rotation-vector quaternion, replacing the dropped
// SENSOR_ID_ORI subscription (see the 11-subscription note above).
static void quatToEuler(float w, float x, float y, float z,
                        float &headingDeg, float &pitchDeg, float &rollDeg) {
  const float RAD_TO_DEGREES = 57.29578f;
  float sinr_cosp = 2.0f * (w * x + y * z);
  float cosr_cosp = 1.0f - 2.0f * (x * x + y * y);
  rollDeg = atan2f(sinr_cosp, cosr_cosp) * RAD_TO_DEGREES;

  float sinp = 2.0f * (w * y - z * x);
  if (sinp > 1.0f) sinp = 1.0f;
  if (sinp < -1.0f) sinp = -1.0f;
  pitchDeg = asinf(sinp) * RAD_TO_DEGREES;

  float siny_cosp = 2.0f * (w * z + x * y);
  float cosy_cosp = 1.0f - 2.0f * (y * y + z * z);
  float yaw = atan2f(siny_cosp, cosy_cosp) * RAD_TO_DEGREES;
  headingDeg = yaw < 0.0f ? yaw + 360.0f : yaw;
}

// Gravity direction in the body frame (unit quaternion rotating world +Z),
// in g. Replaces the dropped SENSOR_ID_GRA subscription.
static void gravityFromQuat(float w, float x, float y, float z,
                            float &gx, float &gy, float &gz) {
  gx = 2.0f * (x * z - w * y);
  gy = 2.0f * (y * z + w * x);
  gz = w * w - x * x - y * y + z * z;
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

  bhy2Ok = BHY2.begin(NICLA_STANDALONE);
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
  }

  // Serial for the USB transport. On the Nicla the USB port is a SAMD11
  // serial-to-USB BRIDGE, so this is a real UART baud rate and directly
  // limits throughput (115200 made a 172-byte dump take ~15 ms and capped
  // polling at ~50 Hz). 921600 moves a dump in ~2 ms. Must match the
  // station driver's SERIAL_BAUD. Never wait for !Serial (headless).
  Serial.begin(921600);
}

void loop() {
  if (bhy2Ok) {
    BHY2.update();
  }

  writeVec3(regMap, REG_ACCEL, accel, ACCEL_LSB_PER_G);
  writeVec3(regMap, REG_GYRO, gyro, GYRO_LSB_PER_DPS);
  writeVec3(regMap, REG_MAG, mag, MAG_LSB_PER_UT);

  // SensorQuaternion (Arduino_BHY2/src/sensors/SensorQuaternion.h) already
  // scales x/y/z/w/accuracy internally (constructor factor 0.000061035 ==
  // 1/16384, applied in DataParser::parseQuaternion), so the raw accessors
  // return final float units directly -- do not rescale here.
  float qw = quat.w();
  float qx = quat.x();
  float qy = quat.y();
  float qz = quat.z();
  writeF32(regMap, REG_QUAT, qw);
  writeF32(regMap, REG_QUAT + 4, qx);
  writeF32(regMap, REG_QUAT + 8, qy);
  writeF32(regMap, REG_QUAT + 12, qz);
  writeF32(regMap, REG_QUAT + 16, quat.accuracy());

  // Derived values (see the 11-subscription note): euler from the
  // quaternion, gravity as the quaternion-rotated 1g vector, linear
  // acceleration as measured acceleration minus gravity. All three are
  // meaningless until the first rotation-vector sample lands (or if the RV
  // subscription ever fails): the quaternion then reads zero, so the
  // derived registers are zeroed and status bit2 stays clear instead of
  // serving accel-as-linear-accel garbage that looks plausible.
  float heading = 0.0f, pitch = 0.0f, roll = 0.0f;
  float gx = 0.0f, gy = 0.0f, gz = 0.0f;
  float lx = 0.0f, ly = 0.0f, lz = 0.0f;
  const float qnorm = sqrtf(qw * qw + qx * qx + qy * qy + qz * qz);
  const bool quatValid = qnorm > 0.5f; // a real rotation vector is ~unit
  if (quatValid) {
    const float nw = qw / qnorm, nx = qx / qnorm, ny = qy / qnorm, nz = qz / qnorm;
    // The BHY2 rotation vector uses the Android/ENU body convention (z up);
    // quatToEuler's aircraft formulas expect z down, which made a flat board
    // read roll ~180°. Feeding q' = q ⊗ rot180x — i.e. (w,x,y,z) →
    // (-x, w, z, -y) — reconciles the frames: flat board = pitch 0, roll 0,
    // heading unchanged (hardware-verified 2026-08-16).
    quatToEuler(-nx, nw, nz, -ny, heading, pitch, roll);
    gravityFromQuat(nw, nx, ny, nz, gx, gy, gz);
    lx = accel.x() / ACCEL_LSB_PER_G - gx;
    ly = accel.y() / ACCEL_LSB_PER_G - gy;
    lz = accel.z() / ACCEL_LSB_PER_G - gz;
  }
  writeF32(regMap, REG_EULER, heading);
  writeF32(regMap, REG_EULER + 4, pitch);
  writeF32(regMap, REG_EULER + 8, roll);
  writeF32(regMap, REG_GRAVITY, gx);
  writeF32(regMap, REG_GRAVITY + 4, gy);
  writeF32(regMap, REG_GRAVITY + 8, gz);
  writeF32(regMap, REG_LACC, lx);
  writeF32(regMap, REG_LACC + 4, ly);
  writeF32(regMap, REG_LACC + 8, lz);

  writeF32(regMap, REG_TEMPERATURE, temperature.value());
  writeF32(regMap, REG_HUMIDITY, humidity.value());
  writeF32(regMap, REG_PRESSURE, pressure.value());
  writeF32(regMap, REG_GAS, gas.value());

  writeF32(regMap, REG_IAQ, (float)bsec.iaq());
  writeF32(regMap, REG_IAQ_STATIC, (float)bsec.iaq_s());
  writeF32(regMap, REG_ECO2, (float)bsec.co2_eq());
  writeF32(regMap, REG_BVOC, bsec.b_voc_eq());
  writeF32(regMap, REG_BSEC_ACCURACY, (float)bsec.accuracy());
  writeF32(regMap, REG_COMP_TEMPERATURE, bsec.comp_t());
  writeF32(regMap, REG_COMP_HUMIDITY, bsec.comp_h());

  writeU32(regMap, REG_STEP_COUNT, (uint32_t)stepCounter.value());
  writeU32(regMap, REG_ACTIVITY, (uint32_t)activity.value());

  regMap[REG_STATUS] = (bhy2Ok ? 0x01 : 0x00) | (bsec.accuracy() > 0 ? 0x02 : 0x00) |
                        (quatValid ? 0x04 : 0x00);
  if (bhy2Ok) {
    regMap[REG_SAMPLE_COUNTER] = regMap[REG_SAMPLE_COUNTER] + 1;
  }

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
    // per tick = exactly the firmware refresh rate (~100 Hz), ~2 ms of the
    // 921600-baud UART per frame.
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

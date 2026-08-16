/*
 * Nicla Sense ME → I2C register-map peripheral for norma-core station.
 *
 * Exposes all BHY2 sensor outputs as a 168-byte little-endian register map
 * at I2C address 0x22 (ESLOV / external I2C). The map layout is the contract
 * shared with software/drivers/arduino-nicla-sense-me and the station-viewer;
 * see README.md in this directory. Register-pointer semantics: a 1-byte write
 * sets the read pointer; reads return sequential bytes. Writing pointer 0x00
 * synchronously latches a consistent snapshot (inside the I2C receive
 * handler) that all subsequent reads are served from, so a chunked full-map
 * read never tears.
 * The same image is served over USB CDC serial: command 0x01 returns one CRC8-framed snapshot (see README).
 */

#include "Arduino_BHY2.h"
#include "Wire.h"
#include "nrf.h"

constexpr uint8_t I2C_ADDRESS = 0x22;
constexpr size_t REG_MAP_SIZE = 0xA8;
constexpr uint8_t SOFTWARE_REVISION = 1;
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

// USB serial dump protocol (contract with the station driver): the host
// sends SERIAL_CMD_DUMP, the sketch replies with one frame:
//   [0xA5, 0x5A, 0xA8, <168-byte register image>, crc8(payload)]
// CRC8 is poly 0x07, init 0x00, computed over the payload only. Unknown
// command bytes are ignored.
constexpr uint8_t SERIAL_CMD_DUMP = 0x01;
constexpr uint8_t SERIAL_MAGIC0 = 0xA5;
constexpr uint8_t SERIAL_MAGIC1 = 0x5A;

// Motion batching (USB only): one sample per loop tick while BHY2 runs.
// Sample layout (19 bytes, LE): dt_ms u8 (saturating), accel x/y/z i16,
// gyro x/y/z i16, mag x/y/z i16 — raw counts; scale factors above.
constexpr uint8_t SERIAL_CMD_MOTION = 0x02;
constexpr uint8_t SERIAL_MAGIC1_MOTION = 0x5B;
constexpr size_t MOTION_SAMPLE_SIZE = 19;
constexpr size_t MOTION_RING_CAPACITY = 256;

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

static uint8_t liveMap[REG_MAP_SIZE];    // staging: written only by loop()
static uint8_t stableMap[REG_MAP_SIZE];  // last complete snapshot, committed under interrupt guard
static uint8_t latchedMap[REG_MAP_SIZE]; // frozen copy served to the host during a dump
static volatile uint8_t regPointer = 0;
static bool bhy2Ok = false;

static uint8_t motionSamples[MOTION_RING_CAPACITY][MOTION_SAMPLE_SIZE];
static uint32_t motionSampleMillis[MOTION_RING_CAPACITY];
static size_t motionTail = 0;   // oldest sample
static size_t motionCount = 0;
static uint16_t motionDropped = 0;
static uint32_t motionLastMillis = 0;

static uint8_t motionTxCrc = 0;

static void motionCrcWrite(const uint8_t *data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    motionTxCrc = crc8Update(motionTxCrc, data[i]);
  }
  Serial.write(data, len);
}

static void serveMotionBatch() {
  // Ring is only touched from loop() (same thread as this), so the drain
  // is consistent without any guard.
  uint16_t count = (uint16_t)motionCount;
  uint16_t dropped = motionDropped;
  uint32_t firstMillis = count > 0 ? motionSampleMillis[motionTail] : 0;

  const uint8_t magic[2] = { SERIAL_MAGIC0, SERIAL_MAGIC1_MOTION };
  Serial.write(magic, sizeof(magic));
  motionTxCrc = 0;
  motionCrcWrite((const uint8_t *)&count, sizeof(count));
  motionCrcWrite((const uint8_t *)&dropped, sizeof(dropped));
  motionCrcWrite((const uint8_t *)&firstMillis, sizeof(firstMillis));
  for (uint16_t i = 0; i < count; i++) {
    motionCrcWrite(motionSamples[(motionTail + i) % MOTION_RING_CAPACITY], MOTION_SAMPLE_SIZE);
  }
  Serial.write(&motionTxCrc, 1);

  motionTail = (motionTail + count) % MOTION_RING_CAPACITY;
  motionCount -= count;
  motionDropped = 0;
}

static void serviceSerialDump() {
  // Bounded per call: drain at most a small budget of bytes and answer at
  // most one dump command per loop() tick, so a chatty or misbehaving host
  // can never starve sensor updates.
  for (int budget = 0; budget < 16 && Serial.available() > 0; budget++) {
    int cmd = Serial.read();
    if (cmd == SERIAL_CMD_MOTION) {
      serveMotionBatch();
      return; // one reply per tick
    }
    if (cmd != SERIAL_CMD_DUMP) {
      continue; // unknown bytes are ignored
    }
    uint8_t frame[3 + REG_MAP_SIZE + 1];
    frame[0] = SERIAL_MAGIC0;
    frame[1] = SERIAL_MAGIC1;
    frame[2] = (uint8_t)REG_MAP_SIZE;
    // stableMap is only ever written by loop() (this same thread), so this
    // copy is always a complete snapshot; no interrupt guard needed.
    memcpy(frame + 3, stableMap, REG_MAP_SIZE);
    frame[3 + REG_MAP_SIZE] = crc8(frame + 3, REG_MAP_SIZE);
    Serial.write(frame, sizeof(frame));
    return; // one reply per tick; remaining commands are served next tick
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

static void writeI16(uint8_t *out, size_t offset, int16_t value) {
  memcpy(out + offset, &value, sizeof(value));
}

static void pushMotionSample() {
  uint32_t now = millis();
  uint32_t delta = motionLastMillis == 0 ? 0 : now - motionLastMillis;
  motionLastMillis = now;

  size_t slot = (motionTail + motionCount) % MOTION_RING_CAPACITY;
  if (motionCount == MOTION_RING_CAPACITY) {
    // Ring full: overwrite the oldest sample and account for the loss.
    motionTail = (motionTail + 1) % MOTION_RING_CAPACITY;
    if (motionDropped < 0xFFFF) {
      motionDropped++;
    }
  } else {
    motionCount++;
  }

  uint8_t *sample = motionSamples[slot];
  sample[0] = delta > 255 ? 255 : (uint8_t)delta;
  writeI16(sample, 1, accel.x());
  writeI16(sample, 3, accel.y());
  writeI16(sample, 5, accel.z());
  writeI16(sample, 7, gyro.x());
  writeI16(sample, 9, gyro.y());
  writeI16(sample, 11, gyro.z());
  writeI16(sample, 13, mag.x());
  writeI16(sample, 15, mag.y());
  writeI16(sample, 17, mag.z());
  motionSampleMillis[slot] = now;
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

void onI2CReceive(int count) {
  if (count >= 1) {
    regPointer = Wire.read();
    while (Wire.available()) {
      Wire.read(); // register writes are not supported; drain
    }
    if (regPointer == 0x00) {
      // Snapshot synchronously: this is a 168-byte memcpy (microseconds on
      // the nRF52), well within I2C clock stretching, and guarantees the
      // latch cannot land mid-dump between the host's chunked reads.
      // stableMap only ever holds complete snapshots (loop() commits it
      // under an interrupt guard), so this latch can never observe a
      // half-written update even when this ISR preempts loop().
      memcpy(latchedMap, stableMap, sizeof(latchedMap));
    }
  }
}

void onI2CRequest() {
  // The host reads in chunks of <=32 bytes, re-sending the register offset
  // before each chunk, so serving one bounded chunk per request is enough.
  uint8_t chunk[32];
  size_t start = regPointer;
  size_t available = start < REG_MAP_SIZE ? REG_MAP_SIZE - start : 0;
  size_t len = available < sizeof(chunk) ? available : sizeof(chunk);
  if (len == 0) {
    uint8_t zero = 0;
    Wire.write(&zero, 1);
    return;
  }
  memcpy(chunk, latchedMap + start, len);
  Wire.write(chunk, len);
}

void setup() {
  memset(liveMap, 0, sizeof(liveMap));

  liveMap[REG_SOFTWARE_REVISION] = SOFTWARE_REVISION;
  liveMap[REG_PRODUCT_ID] = PRODUCT_ID;
  // 6-byte serial from the nRF52 factory device id.
  uint32_t serialWords[2] = { NRF_FICR->DEVICEID[0], NRF_FICR->DEVICEID[1] };
  memcpy(&liveMap[REG_SERIAL], serialWords, 6);

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

  memcpy(stableMap, liveMap, sizeof(stableMap));
  memcpy(latchedMap, stableMap, sizeof(latchedMap));

  // USB CDC serial for the USB transport. Baud is irrelevant for CDC.
  // Never wait for !Serial: the board usually runs headless.
  Serial.begin(115200);

  Wire.begin(I2C_ADDRESS);
  Wire.onReceive(onI2CReceive);
  Wire.onRequest(onI2CRequest);
}

void loop() {
  if (bhy2Ok) {
    BHY2.update();
  }

  writeVec3(liveMap, REG_ACCEL, accel, ACCEL_LSB_PER_G);
  writeVec3(liveMap, REG_GYRO, gyro, GYRO_LSB_PER_DPS);
  writeVec3(liveMap, REG_MAG, mag, MAG_LSB_PER_UT);

  if (bhy2Ok) {
    pushMotionSample();
  }

  // SensorQuaternion (Arduino_BHY2/src/sensors/SensorQuaternion.h) already
  // scales x/y/z/w/accuracy internally (constructor factor 0.000061035 ==
  // 1/16384, applied in DataParser::parseQuaternion), so the raw accessors
  // return final float units directly -- do not rescale here.
  float qw = quat.w();
  float qx = quat.x();
  float qy = quat.y();
  float qz = quat.z();
  writeF32(liveMap, REG_QUAT, qw);
  writeF32(liveMap, REG_QUAT + 4, qx);
  writeF32(liveMap, REG_QUAT + 8, qy);
  writeF32(liveMap, REG_QUAT + 12, qz);
  writeF32(liveMap, REG_QUAT + 16, quat.accuracy());

  // Derived values (see the 11-subscription note): euler from the
  // quaternion, gravity as the quaternion-rotated 1g vector, linear
  // acceleration as measured acceleration minus gravity.
  float heading, pitch, roll;
  // The BHY2 rotation vector uses the Android/ENU body convention (z up);
  // quatToEuler's aircraft formulas expect z down, which made a flat board
  // read roll ~180°. Feeding q' = q ⊗ rot180x — i.e. (w,x,y,z) →
  // (-x, w, z, -y) — reconciles the frames: flat board = pitch 0, roll 0,
  // heading unchanged (hardware-verified 2026-08-16).
  quatToEuler(-qx, qw, qz, -qy, heading, pitch, roll);
  writeF32(liveMap, REG_EULER, heading);
  writeF32(liveMap, REG_EULER + 4, pitch);
  writeF32(liveMap, REG_EULER + 8, roll);

  float gx, gy, gz;
  gravityFromQuat(qw, qx, qy, qz, gx, gy, gz);
  writeF32(liveMap, REG_GRAVITY, gx);
  writeF32(liveMap, REG_GRAVITY + 4, gy);
  writeF32(liveMap, REG_GRAVITY + 8, gz);
  writeF32(liveMap, REG_LACC, accel.x() / ACCEL_LSB_PER_G - gx);
  writeF32(liveMap, REG_LACC + 4, accel.y() / ACCEL_LSB_PER_G - gy);
  writeF32(liveMap, REG_LACC + 8, accel.z() / ACCEL_LSB_PER_G - gz);

  writeF32(liveMap, REG_TEMPERATURE, temperature.value());
  writeF32(liveMap, REG_HUMIDITY, humidity.value());
  writeF32(liveMap, REG_PRESSURE, pressure.value());
  writeF32(liveMap, REG_GAS, gas.value());

  writeF32(liveMap, REG_IAQ, (float)bsec.iaq());
  writeF32(liveMap, REG_IAQ_STATIC, (float)bsec.iaq_s());
  writeF32(liveMap, REG_ECO2, (float)bsec.co2_eq());
  writeF32(liveMap, REG_BVOC, bsec.b_voc_eq());
  writeF32(liveMap, REG_BSEC_ACCURACY, (float)bsec.accuracy());
  writeF32(liveMap, REG_COMP_TEMPERATURE, bsec.comp_t());
  writeF32(liveMap, REG_COMP_HUMIDITY, bsec.comp_h());

  writeU32(liveMap, REG_STEP_COUNT, (uint32_t)stepCounter.value());
  writeU32(liveMap, REG_ACTIVITY, (uint32_t)activity.value());

  liveMap[REG_STATUS] = (bhy2Ok ? 0x01 : 0x00) | (bsec.accuracy() > 0 ? 0x02 : 0x00);
  if (bhy2Ok) {
    liveMap[REG_SAMPLE_COUNTER] = liveMap[REG_SAMPLE_COUNTER] + 1;
  }

  // Commit the fully-written staging map as the new stable snapshot. The
  // interrupt guard keeps the I2C receive handler from latching while the
  // copy is in flight, so stableMap is always internally consistent.
  noInterrupts();
  memcpy(stableMap, liveMap, sizeof(stableMap));
  interrupts();

  serviceSerialDump();

  // Absolute 10 ms schedule (not a fixed delay): the loop body itself takes
  // several milliseconds, so a plain delay(10) would drop the effective
  // motion sample rate to ~50 Hz. If a tick overruns, resynchronize instead
  // of trying to catch up.
  static uint32_t nextTickMillis = 0;
  uint32_t now = millis();
  if (nextTickMillis == 0) {
    nextTickMillis = now;
  }
  nextTickMillis += 10;
  if ((int32_t)(nextTickMillis - now) > 0) {
    delay(nextTickMillis - now);
  } else {
    nextTickMillis = now;
  }
}

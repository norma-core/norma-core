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

static uint8_t crc8(const uint8_t *data, size_t len) {
  uint8_t crc = 0;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x07) : (uint8_t)(crc << 1);
    }
  }
  return crc;
}

SensorXYZ accel(SENSOR_ID_ACC);
SensorXYZ gyro(SENSOR_ID_GYRO);
SensorXYZ mag(SENSOR_ID_MAG);
SensorXYZ linAccel(SENSOR_ID_LACC);
SensorXYZ gravity(SENSOR_ID_GRA);
SensorQuaternion quat(SENSOR_ID_RV);
SensorOrientation orientation(SENSOR_ID_ORI);
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

static void serviceSerialDump() {
  while (Serial.available() > 0) {
    int cmd = Serial.read();
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
    accel.begin();
    gyro.begin();
    mag.begin();
    linAccel.begin();
    gravity.begin();
    quat.begin();
    orientation.begin();
    temperature.begin();
    humidity.begin();
    pressure.begin();
    gas.begin();
    bsec.begin();
    stepCounter.begin();
    activity.begin();
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
  writeVec3(liveMap, REG_LACC, linAccel, ACCEL_LSB_PER_G);
  writeVec3(liveMap, REG_GRAVITY, gravity, ACCEL_LSB_PER_G);

  // SensorQuaternion (Arduino_BHY2/src/sensors/SensorQuaternion.h) already
  // scales x/y/z/w/accuracy internally (constructor factor 0.000061035 ==
  // 1/16384, applied in DataParser::parseQuaternion), so the raw accessors
  // return final float units directly -- do not rescale here.
  writeF32(liveMap, REG_QUAT, quat.w());
  writeF32(liveMap, REG_QUAT + 4, quat.x());
  writeF32(liveMap, REG_QUAT + 8, quat.y());
  writeF32(liveMap, REG_QUAT + 12, quat.z());
  writeF32(liveMap, REG_QUAT + 16, quat.accuracy());

  // SensorOrientation is likewise pre-scaled to degrees (SensorList scale
  // factor 0.01098 ~= 360/32768) in DataParser::parseEuler.
  writeF32(liveMap, REG_EULER, orientation.heading());
  writeF32(liveMap, REG_EULER + 4, orientation.pitch());
  writeF32(liveMap, REG_EULER + 8, orientation.roll());

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

  delay(10);
}

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
 * This sketch is only the glue that has to be C++: the Arduino_BHY2 sensor
 * objects, Serial and the LED. All logic lives in plain C under src/:
 *   nicla_protocol  register map layout, frame format, streaming state
 *   nicla_hub       hub parameter reads that survive stale status entries
 *   bhy2_calibration  persistent calibration profiles
 * The map layout is the contract shared with
 * software/drivers/arduino-nicla-sense-me and the station-viewer; see
 * README.md in this directory. The image is served over USB CDC serial as
 * CRC8-framed snapshots, either one per 0x01 request or streamed at the
 * 10 ms tick rate after 0x02.
 */

#include "Arduino_BHY2.h"
#include "Nicla_System.h"
#include "nrf.h"

#include "src/bhy2_calibration.h"
#include "src/nicla_hub.h"
#include "src/nicla_protocol.h"

// Full-scale ranges requested from the hub. The values actually in effect are
// read back from the hub and published in the range registers; consumers
// must scale from those, never from these constants.
constexpr uint16_t ACCEL_RANGE_G = 16;    // maximum the BHI260AP offers
constexpr uint16_t GYRO_RANGE_DPS = 2000; // maximum the BHI260AP offers
// The BMM150 magnetometer has a fixed 16 LSB/uT (0.0625 uT/LSB) resolution
// in the BHY2 output; recorded so consumers never hard-code it.
constexpr uint16_t MAG_LSB_PER_UT = 16;

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
static uint8_t regMap[NICLA_REG_MAP_SIZE];
static bool bhy2Ok = false;
static uint32_t tickCounter = 0;

static void sendDumpFrame() {
  uint8_t frame[NICLA_FRAME_SIZE];
  nicla_build_frame(regMap, frame);
  Serial.write(frame, sizeof(frame));
}

static void serviceSerialCommands() {
  // Bounded per call: drain at most a small budget of bytes and send at
  // most one dump reply, so a chatty or misbehaving host can never starve
  // sensor updates. Every byte in the budget is applied before replying,
  // so DUMP followed by STREAM_STOP in one batch yields exactly one frame.
  bool dumpRequested = false;
  for (int budget = 0; budget < 16 && Serial.available() > 0; budget++) {
    if (nicla_stream_command((uint8_t)Serial.read(), millis())) {
      dumpRequested = true;
    }
  }
  // While streaming the pushed frame is the reply; answering DUMP as well
  // would put a second blocking write into the tick.
  if (dumpRequested && !nicla_stream_active(millis())) {
    sendDumpFrame();
  }
}

// SensorXYZ::x()/y()/z() return the hub's raw int16 counts unscaled
// (Arduino_BHY2/src/sensors/SensorXYZ.h); they are written as-is.
static void writeRawVec3(size_t offset, SensorXYZ &sensor) {
  nicla_put_i16(regMap, offset, sensor.x());
  nicla_put_i16(regMap, offset + 2, sensor.y());
  nicla_put_i16(regMap, offset + 4, sensor.z());
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
// start-up and refreshed once a second from loop(). Each register is written
// only when the hub's answer for that sensor arrived complete and plausible;
// otherwise it keeps its previous value, which is 0 ("unknown", consumers do
// not scale) until the first good read. The library's own getConfiguration()
// is not used: it cannot report a failed read and on this hub returns another
// request's answer whenever a status entry is pending (see src/nicla_hub.h).
static void publishRanges() {
  nicla_publish_accel_range(regMap, accel.id());
  nicla_publish_gyro_range(regMap, gyro.id());
}

void setup() {
  // RGB LED (IS31FL3194 on the internal I2C bus): red = USB streaming
  // active, off = idle.
  nicla::begin();
  nicla::leds.begin();
  nicla::leds.setColor(0, 0, 0);

  memset(regMap, 0, sizeof(regMap));

  regMap[NICLA_REG_SOFTWARE_REVISION] = NICLA_SOFTWARE_REVISION;
  regMap[NICLA_REG_PRODUCT_ID] = NICLA_PRODUCT_ID;
  // 6-byte serial from the nRF52 factory device id. The station names the
  // board's queue after it, so it must be stable across reboots (it is).
  uint32_t serialWords[2] = { NRF_FICR->DEVICEID[0], NRF_FICR->DEVICEID[1] };
  memcpy(&regMap[NICLA_REG_SERIAL], serialWords, 6);
  nicla_put_u16(regMap, NICLA_REG_MAG_LSB_PER_UT, MAG_LSB_PER_UT);

  bhy2Ok = BHY2.begin(NICLA_STANDALONE);
  if (bhy2Ok) {
    // Stored calibration profiles are loaded "at system boot" (Bosch AN002),
    // i.e. before the virtual sensors are enabled.
    bhy2calib_restore_profiles();
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
    fresh |= takeFresh(accel, NICLA_FRESH_ACCEL);
    fresh |= takeFresh(gyro, NICLA_FRESH_GYRO);
    fresh |= takeFresh(mag, NICLA_FRESH_MAG);
    fresh |= takeFresh(quat, NICLA_FRESH_QUAT);
    fresh |= takeFresh(temperature, NICLA_FRESH_TEMPERATURE);
    fresh |= takeFresh(humidity, NICLA_FRESH_HUMIDITY);
    fresh |= takeFresh(pressure, NICLA_FRESH_PRESSURE);
    fresh |= takeFresh(gas, NICLA_FRESH_GAS);
    fresh |= takeFresh(bsec, NICLA_FRESH_BSEC);
    fresh |= takeFresh(stepCounter, NICLA_FRESH_STEPS);
    fresh |= takeFresh(activity, NICLA_FRESH_ACTIVITY);
  }

  writeRawVec3(NICLA_REG_ACCEL_RAW, accel);
  writeRawVec3(NICLA_REG_GYRO_RAW, gyro);
  writeRawVec3(NICLA_REG_MAG_RAW, mag);

  // SensorQuaternion (Arduino_BHY2/src/sensors/SensorQuaternion.h) scales
  // x/y/z/w/accuracy internally by a fixed 1/16384, so these are the final
  // values. Unpopulated registers read as zeros until the first rotation
  // vector sample; consumers gate on the quaternion norm, not on a flag.
  nicla_put_f32(regMap, NICLA_REG_QUAT, quat.w());
  nicla_put_f32(regMap, NICLA_REG_QUAT + 4, quat.x());
  nicla_put_f32(regMap, NICLA_REG_QUAT + 8, quat.y());
  nicla_put_f32(regMap, NICLA_REG_QUAT + 12, quat.z());
  nicla_put_f32(regMap, NICLA_REG_QUAT + 16, quat.accuracy());

  nicla_put_f32(regMap, NICLA_REG_TEMPERATURE, temperature.value());
  nicla_put_f32(regMap, NICLA_REG_HUMIDITY, humidity.value());
  nicla_put_f32(regMap, NICLA_REG_PRESSURE, pressure.value());
  nicla_put_f32(regMap, NICLA_REG_GAS, gas.value());

  // BSEC outputs come from Bosch's closed algorithm with internal state and
  // cannot be recomputed later, so they are published as measured.
  nicla_put_f32(regMap, NICLA_REG_IAQ, (float)bsec.iaq());
  nicla_put_f32(regMap, NICLA_REG_IAQ_STATIC, (float)bsec.iaq_s());
  nicla_put_f32(regMap, NICLA_REG_ECO2, (float)bsec.co2_eq());
  nicla_put_f32(regMap, NICLA_REG_BVOC, bsec.b_voc_eq());
  nicla_put_f32(regMap, NICLA_REG_COMP_TEMPERATURE, bsec.comp_t());
  nicla_put_f32(regMap, NICLA_REG_COMP_HUMIDITY, bsec.comp_h());
  regMap[NICLA_REG_BSEC_ACCURACY] = bsec.accuracy();

  // Calibration persistence: the rotation-vector accuracy drives auto-save.
  // An unpopulated quaternion reads all zeros (accuracy 0 as well), which must
  // not count as "calibrated", hence the norm gate.
  {
    const float qw = quat.w(), qx = quat.x(), qy = quat.y(), qz = quat.z();
    const bool rvPopulated = (qw * qw + qx * qx + qy * qy + qz * qz) > 0.25f;
    if (bhy2Ok) {
      bhy2calib_service(rvPopulated ? quat.accuracy() : 100.0f, millis());
    }
    const struct bhy2calib_status calib = bhy2calib_get_status(millis());
    regMap[NICLA_REG_CALIB_FLAGS] = calib.flags;
    regMap[NICLA_REG_CALIB_MINUTES] = calib.minutes_since_save;
  }

  nicla_put_u32(regMap, NICLA_REG_STEP_COUNT, (uint32_t)stepCounter.value());
  nicla_put_u32(regMap, NICLA_REG_ACTIVITY, (uint32_t)activity.value());

  regMap[NICLA_REG_STATUS] = bhy2Ok ? 0x01 : 0x00;
  if (bhy2Ok) {
    regMap[NICLA_REG_SAMPLE_COUNTER] = regMap[NICLA_REG_SAMPLE_COUNTER] + 1;
    tickCounter++;
    if (tickCounter % 100 == 0) {
      publishRanges();
    }
  }
  nicla_put_u32(regMap, NICLA_REG_TICK_COUNTER, tickCounter);
  nicla_put_u16(regMap, NICLA_REG_FRESH_FLAGS, fresh);

  serviceSerialCommands();
  // Stopped or expired streams are forgotten here (nicla_stream_poll), so a
  // stale deadline cannot re-arm streaming after the millis() wrap.
  const bool streaming = nicla_stream_poll(millis());
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

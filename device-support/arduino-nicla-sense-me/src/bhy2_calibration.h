/*
 * Persistent BHY2 (BHI260AP) calibration profiles.
 *
 * The sensor hub learns accelerometer, gyroscope and magnetometer calibration
 * ("BSX state") at run time and keeps it in its own RAM, so every power cycle
 * starts uncalibrated: the rotation-vector accuracy reads pi and the heading is
 * meaningless until the board has been moved through enough orientations.
 * This module stores the three profiles in the nRF52's flash (Mbed KVStore),
 * restores them right after the hub boots, and re-saves them automatically
 * once the fusion reports a good heading for a while. No host commands.
 *
 * Status is published in two register-map bytes (see the sketch): a flag byte
 * and "minutes since the last save" (255 = none this session).
 */
#pragma once

#include <stdint.h>

namespace bhy2calib {

constexpr uint8_t FLAG_RESTORED = 1u << 0;        // a stored profile was written into the hub at boot
constexpr uint8_t FLAG_SAVED = 1u << 1;           // at least one profile was saved this session
constexpr uint8_t FLAG_STORE_ERROR = 1u << 2;     // flash or hub transfer error since boot
constexpr uint8_t FLAG_RECORD_IGNORED = 1u << 3;  // a stored record did not match this hub firmware
constexpr uint8_t FLAG_RESTORE_VERIFIED = 1u << 4; // read-back after restore matched the stored bytes
constexpr uint8_t FLAG_RESTORE_MISMATCH = 1u << 5; // read-back after restore differed (hub did not keep it)

struct Status {
  uint8_t flags;
  uint8_t minutesSinceSave;  // 255 = no save this session
};

// Call once after BHY2.begin() succeeded and BEFORE any sensor begin(): Bosch
// AN002 says to load the states "at system boot", and on the bench a profile
// written after the sensors were enabled was not kept by the hub (read-back
// mismatch), while one written before was kept byte-for-byte and its
// magnetometer offsets were active from the first frame. The accuracy register
// still reads pi after a restore until the board's first small motion lets the
// fusion confirm the state (seconds, versus 10-15 s of figure-eight cold).
void restoreProfiles();

// Call every tick. `rvAccuracyRad` is the rotation-vector accuracy register
// when the rotation vector is populated; pass a large value (e.g. 100) while
// it is not, so an all-zero quaternion never counts as "calibrated".
void service(float rvAccuracyRad, uint32_t nowMillis);

Status status(uint32_t nowMillis);

}  // namespace bhy2calib

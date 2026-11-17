/*
 * Persistent BHY2 (BHI260AP) calibration profiles.
 *
 * The sensor hub learns accelerometer, gyroscope and magnetometer calibration
 * ("BSX state") at run time and keeps it in its own RAM, so every power cycle
 * starts uncalibrated: the rotation-vector accuracy reads pi and the heading is
 * meaningless until the board has been moved through enough orientations.
 * This module stores the three profiles in the nRF52's flash (Mbed KVStore),
 * one record each, and restores them right after the hub boots. A profile is
 * saved only while the hub reports calibration status 3 ("completed") for its
 * own sensor, which is the rule Bosch gives (BHI260AP datasheet 13.3.3,
 * BST-BHY2XX_BHI3XX-AN002 5.3.1); for the magnetometer the heading accuracy
 * decides in addition whether a new save is worth a flash write. No host
 * commands.
 *
 * Status is published in three register-map bytes (see the sketch): a flag
 * byte, "minutes since the last save" (255 = none this session) and the three
 * calibration statuses.
 */
#ifndef BHY2_CALIBRATION_H
#define BHY2_CALIBRATION_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BHY2CALIB_FLAG_RESTORED (1u << 0)         /* a stored profile was written into the hub at boot */
#define BHY2CALIB_FLAG_SAVED (1u << 1)            /* the profiles were saved this session */
#define BHY2CALIB_FLAG_STORE_ERROR (1u << 2)      /* a flash or hub transfer failed for a profile that has not been saved since */
#define BHY2CALIB_FLAG_RECORD_IGNORED (1u << 3)   /* a stored record did not match this hub firmware */
#define BHY2CALIB_FLAG_RESTORE_VERIFIED (1u << 4) /* read-back after restore matched the stored bytes */
#define BHY2CALIB_FLAG_RESTORE_MISMATCH (1u << 5) /* read-back after restore differed (hub did not keep it) */

#define BHY2CALIB_NO_SAVE 255u /* minutes_since_save when nothing was saved this session */

struct bhy2calib_status {
  uint8_t flags;
  uint8_t minutes_since_save; /* 0 .. 254 (254 = that long or longer), or BHY2CALIB_NO_SAVE */
  uint8_t sensor_status;      /* calibration status 0..3: bits 0-1 accel, 2-3 gyro, 4-5 mag */
};

/* The hub's calibration status for a virtual sensor (its "sensor status" meta
   event: 0 unreliable, 1 low, 2 medium, 3 high). Only the corrected
   accelerometer (4), gyroscope (13) and magnetometer (22) are of interest;
   other sensors and values above 3 are ignored. Until the hub has reported a
   status it counts as 0. */
void bhy2calib_sensor_status(uint8_t sensor_id, uint8_t status);

/* Call once after BHY2.begin() succeeded and BEFORE any sensor begin(): Bosch
   AN002 says to load the states "at system boot", and on the bench a profile
   written after the sensors were enabled was not kept by the hub (read-back
   mismatch), while one written before was kept byte-for-byte and its
   magnetometer offsets were active from the first frame. The accuracy register
   still reads pi after a restore until the board's first small motion lets the
   fusion confirm the state (seconds, versus 10-15 s of figure-eight cold). */
void bhy2calib_restore_profiles(void);

/* Call every tick; saves the profiles that are due (see the policy in the .c
   file). `rv_accuracy_rad` is the rotation-vector accuracy register
   when the rotation vector is populated; pass a large value (e.g. 100) while
   it is not, so an all-zero quaternion never counts as "calibrated". `now_ms`
   is millis(); only differences between consecutive calls are used, so the
   32-bit wrap is harmless. */
void bhy2calib_service(float rv_accuracy_rad, uint32_t now_ms);

struct bhy2calib_status bhy2calib_get_status(void);

#ifdef __cplusplus
}
#endif

#endif /* BHY2_CALIBRATION_H */

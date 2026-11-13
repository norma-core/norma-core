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
#ifndef BHY2_CALIBRATION_H
#define BHY2_CALIBRATION_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BHY2CALIB_FLAG_RESTORED (1u << 0)         /* a stored profile was written into the hub at boot */
#define BHY2CALIB_FLAG_SAVED (1u << 1)            /* at least one profile was saved this session */
#define BHY2CALIB_FLAG_STORE_ERROR (1u << 2)      /* flash or hub transfer error since boot */
#define BHY2CALIB_FLAG_RECORD_IGNORED (1u << 3)   /* a stored record did not match this hub firmware */
#define BHY2CALIB_FLAG_RESTORE_VERIFIED (1u << 4) /* read-back after restore matched the stored bytes */
#define BHY2CALIB_FLAG_RESTORE_MISMATCH (1u << 5) /* read-back after restore differed (hub did not keep it) */

#define BHY2CALIB_NO_SAVE 255u /* minutes_since_save when nothing was saved this session */

struct bhy2calib_status {
  uint8_t flags;
  uint8_t minutes_since_save; /* 0 .. 254, or BHY2CALIB_NO_SAVE */
};

/* Call once after BHY2.begin() succeeded and BEFORE any sensor begin(): Bosch
   AN002 says to load the states "at system boot", and on the bench a profile
   written after the sensors were enabled was not kept by the hub (read-back
   mismatch), while one written before was kept byte-for-byte and its
   magnetometer offsets were active from the first frame. The accuracy register
   still reads pi after a restore until the board's first small motion lets the
   fusion confirm the state (seconds, versus 10-15 s of figure-eight cold). */
void bhy2calib_restore_profiles(void);

/* Call every tick. `rv_accuracy_rad` is the rotation-vector accuracy register
   when the rotation vector is populated; pass a large value (e.g. 100) while
   it is not, so an all-zero quaternion never counts as "calibrated". */
void bhy2calib_service(float rv_accuracy_rad, uint32_t now_ms);

struct bhy2calib_status bhy2calib_get_status(uint32_t now_ms);

#ifdef __cplusplus
}
#endif

#endif /* BHY2_CALIBRATION_H */

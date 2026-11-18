#include "bhy2_calibration.h"

#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#include "kvstore_global_api.h"
#include "platform/mbed_error.h"

#include "nicla_bytes.h"
#include "nicla_hub.h"

/* --- Policy -----------------------------------------------------------------
   Which profile may be saved: only one whose own sensor the hub reports at
   calibration status 3 ("calibration is completed"), and has done so for
   SAVE_SETTLE_MS. That is Bosch's rule (datasheet 13.3.3: the state "should be
   saved when the accuracy of the corresponding sensor reaches 3"; AN002 5.3.1),
   and the three profiles are handled individually, as AN002 5.1.1 asks: the
   accelerometer reaches 3 only after it has rested in six orientations, the
   gyroscope after ten seconds at rest, the magnetometer after it has been
   turned through enough directions, so they are rarely ready together.

   When it is saved:
    - the first time, when nothing usable is stored for it;
    - as a refresh, once the status has been 3 for REFRESH_CALM_MS: once per
      session, then once per REFRESH_INTERVAL_MS. The profiles are live state
      (their bytes differ on every read), so "changed since the last write"
      cannot decide;
    - the magnetometer in addition looks at the rotation-vector accuracy, the
      hub's estimate of the heading error. From a 55-hour recording of a
      stationary board (2026-11-14 .. 16) and the bench (2026-09-18): it reads
      pi while uncalibrated and falls as the fusion calibrates (resting level
      0.436 rad on a clean bench, 0.53 rad next to steel); it never falls while
      the board is at rest, and climbs slowly up to pi while the board is
      shaken without being turned (0.02 rad per minute at 10 mg of vibration).
      The accuracy the stored profile was saved at is kept with it, and the
      profile is saved again when the accuracy is better than that by
      SAVE_IMPROVEMENT_MRAD. Never while the accuracy is poor or rising: the
      refresh needs it good and not rising for REFRESH_CALM_MS as well.
   Bosch also suggests deleting a stored profile when the status falls below
   3. That is not done: the magnetometer's status falls for any passing
   magnetic disturbance, and a restored profile that no longer fits is caught
   by the hub itself (AN002 5.2.1) and then replaced by the rules above.
   Never more than one attempt per SAVE_MIN_INTERVAL_MS; an attempt saves every
   profile that is due. */
#define SAVE_ACCURACY_RAD 0.6f        /* above this the heading is not worth keeping */
#define SAVE_SETTLE_MS 30000u         /* status 3 / good accuracy must have held this long */
#define SAVE_IMPROVEMENT_MRAD 30u     /* "better" = at least this much below the stored accuracy */
#define SAVE_RISE_MRAD 2u             /* a climb of more than this restarts the calm period */
#define SAVE_MIN_INTERVAL_MS 600000u  /* at most one save attempt per 10 min */
#define REFRESH_CALM_MS 3600000u      /* 1 h */
#define REFRESH_INTERVAL_MS 86400000u /* 24 h */

/* Durations are accumulated from the time between consecutive service calls,
   never computed from a stored millis() stamp, so nothing here depends on the
   32-bit wrap. One call adds at most TICK_CAP_MS (a stalled loop is counted
   short, which only delays a save), and the sums stop at DURATION_MAX_MS. */
#define TICK_CAP_MS 1000u
#define DURATION_MAX_MS 0x7FFFFFFFu

#define ACCURACY_UNKNOWN_MRAD 0xFFFFu /* nothing stored, or stored without an accuracy */
#define PROFILE_CAP 512u              /* bench: accel 72, gyro 200, mag 408 bytes */
#define BSX_PARAM_BASE 0x200u
#define STATUS_CALIBRATED 3u

/* The three profiles. */
#define ACCEL 0
#define GYRO 1
#define MAG 2
#define PROFILE_COUNT 3

/* Flash record, one per profile, little-endian:
     [0] RECORD_MAGIC  [1] RECORD_FORMAT  [2..3] hub kernel version
     [4..5] heading accuracy at save, mrad (magnetometer; 0xFFFF otherwise)
     [6..7] profile length  [8..] the profile */
#define RECORD_MAGIC 0xB5u
#define RECORD_FORMAT 3u
#define RECORD_HEADER_LEN 8u
#define RECORD_CAP (RECORD_HEADER_LEN + PROFILE_CAP)

/* BSX input ids of the profiles (hub parameter 0x200 + id), the virtual
   sensors whose status stands for them, and their flash keys. */
static const uint8_t PROFILE_IDS[PROFILE_COUNT] = { 1, 3, 5 };
static const uint8_t STATUS_SENSOR_IDS[PROFILE_COUNT] = { 4, 13, 22 };
static const char *const RECORD_KEYS[PROFILE_COUNT] = { "/kv/bhy2acc", "/kv/bhy2gyr", "/kv/bhy2mag" };

/* Records of the formats used before each profile had its own record. They
   are not read any more and are removed at boot, so that they do not occupy
   the 4 KB store. */
#define OLD_KEY_COUNT 4
static const char *const OLD_KEYS[OLD_KEY_COUNT] = { "/kv/bhy2cal", "/kv/bhy2cal1", "/kv/bhy2cal3", "/kv/bhy2cal5" };

static uint8_t flags = 0;
/* What BHY2CALIB_FLAG_STORE_ERROR stands for: a flash or hub transfer failed
   for this profile and the profile has not been saved since. The flag is
   cleared only when none of these is left, so a save of one profile does not
   hide the failure of another. */
static bool failed[PROFILE_COUNT] = { false, false, false };
static uint8_t status[PROFILE_COUNT] = { 0, 0, 0 };          /* latest calibration status from the hub */
static uint32_t steady_ms[PROFILE_COUNT] = { 0, 0, 0 };      /* how long that status has been 3 */
static bool stored[PROFILE_COUNT] = { false, false, false }; /* flash holds a profile the hub accepted or produced */
static bool saved_this_session[PROFILE_COUNT] = { false, false, false };
static uint32_t since_profile_save_ms[PROFILE_COUNT] = { 0, 0, 0 }; /* meaningful only when saved_this_session */
static uint16_t saved_mrad = ACCURACY_UNKNOWN_MRAD; /* accuracy the stored magnetometer profile was saved at */
static uint16_t calm_floor_mrad = 0;                /* lowest accuracy of the calm period; 0 = accuracy not good */
static uint32_t calm_ms = 0;                        /* how long the accuracy has been good and not rising */
static uint32_t since_attempt_ms = DURATION_MAX_MS; /* time since the last save attempt */
static uint32_t since_save_ms = 0;                  /* since the last successful save; meaningful only when any_saved */
static bool any_saved = false;
static uint32_t previous_ms = 0;                    /* meaningful only when serviced_before */
static bool serviced_before = false;
static uint8_t record[RECORD_CAP];
static uint8_t readback[PROFILE_CAP];

/*@ requires elapsed <= TICK_CAP_MS;
    assigns \nothing;
    ensures \result <= DURATION_MAX_MS;
    ensures duration + elapsed <= DURATION_MAX_MS ==> \result == duration + elapsed; */
static uint32_t extend(uint32_t duration, uint32_t elapsed) {
  return duration > DURATION_MAX_MS - elapsed ? DURATION_MAX_MS : duration + elapsed;
}

/* The accuracy in milliradians, rounded up: 1 .. 600 while it is good, 0 when
   it is not (uncalibrated, not populated, or not a number). */
/*@ requires \is_finite(rad);
    assigns \nothing;
    ensures \result <= 600;
    ensures rad > 0.0f && rad < SAVE_ACCURACY_RAD ==> \result >= 1;
    ensures !(rad > 0.0f && rad < SAVE_ACCURACY_RAD) ==> \result == 0; */
static uint16_t accuracy_mrad(float rad) {
  uint16_t low = 1;
  uint16_t high = 600;

  if (!(rad > 0.0f && rad < SAVE_ACCURACY_RAD)) {
    return 0;
  }
  /* The smallest whole number of milliradians that is not below `rad`, found
     by bisection rather than converted: a float-to-integer conversion would
     need a proof about rounding, a comparison does not. Ten steps. */
  /*@ loop invariant 1 <= low <= high <= 600;
      loop assigns low, high;
      loop variant high - low; */
  while (low < high) {
    const uint16_t middle = (uint16_t)((low + high) / 2u);
    if ((float)middle * 0.001f < rad) {
      low = (uint16_t)(middle + 1u);
    } else {
      high = middle;
    }
  }
  return low;
}

/*@ assigns status[0 .. PROFILE_COUNT - 1]; */
void bhy2calib_sensor_status(uint8_t sensor_id, uint8_t value) {
  if (value > STATUS_CALIBRATED) {
    return;
  }
  /*@ loop invariant 0 <= i <= PROFILE_COUNT;
      loop assigns i, status[0 .. PROFILE_COUNT - 1];
      loop variant PROFILE_COUNT - i; */
  for (int i = 0; i < PROFILE_COUNT; i++) {
    if (STATUS_SENSOR_IDS[i] == sensor_id) {
      status[i] = value;
    }
  }
}

/* Reads profile `i` from the hub and writes its record. `mrad` is the heading
   accuracy to store with it (ACCURACY_UNKNOWN_MRAD for the other sensors).
   Returns whether flash now holds the profile. */
/*@ requires 0 <= i < PROFILE_COUNT;
    assigns flags, failed[i], record[0 .. RECORD_CAP - 1], stored[i], saved_this_session[i], since_profile_save_ms[i],
            saved_mrad, since_save_ms, any_saved;
    ensures i != MAG ==> saved_mrad == \old(saved_mrad); */
static bool save_profile(int i, uint16_t kernel, uint16_t mrad) {
  uint32_t total = 0;

  /* A profile with a missing section is refused by the read; then nothing is
     written. */
  if (nicla_hub_read_bsx_state((uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[i]), &record[RECORD_HEADER_LEN], PROFILE_CAP, &total) != BHY2_OK) {
    failed[i] = true;
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return false;
  }
  record[0] = (uint8_t)RECORD_MAGIC;
  record[1] = (uint8_t)RECORD_FORMAT;
  nicla_put_le16(&record[2], kernel);
  nicla_put_le16(&record[4], mrad);
  nicla_put_le16(&record[6], (uint16_t)total);
  /* Mbed's TDBStore (6.17) accepts a record that ends exactly on the last
     byte of its 4 KB flash area, then rejects it in its own read-back check
     and returns an error. That failed call compacts the store, so a second
     write lands at a different offset. */
  int written = kv_set(RECORD_KEYS[i], record, RECORD_HEADER_LEN + total, 0);
  if (written != 0) {
    written = kv_set(RECORD_KEYS[i], record, RECORD_HEADER_LEN + total, 0);
  }
  if (written != 0) {
    failed[i] = true;
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return false;
  }
  failed[i] = false;
  stored[i] = true;
  saved_this_session[i] = true;
  since_profile_save_ms[i] = 0;
  if (i == MAG) {
    saved_mrad = mrad;
  }
  since_save_ms = 0;
  any_saved = true;
  flags |= BHY2CALIB_FLAG_SAVED;
  return true;
}

/* Writes the stored profile `i` into the hub and checks that the hub kept it
   (the bytes are opaque; a mismatch means the write was issued at the wrong
   time, see the header). Returns whether the hub now holds it. */
/*@ requires 0 <= i < PROFILE_COUNT;
    requires 1 <= length <= PROFILE_CAP;
    requires \valid_read(blob + (0 .. length - 1));
    requires \separated(blob + (0 .. length - 1), readback + (0 .. PROFILE_CAP - 1), &flags,
                        failed + (0 .. PROFILE_COUNT - 1));
    assigns flags, failed[i], readback[0 .. PROFILE_CAP - 1]; */
static bool restore_one(int i, const uint8_t *blob, uint32_t length) {
  const uint16_t param = (uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[i]);
  uint32_t total = 0;

  if (nicla_hub_write_bsx_state(param, blob, length) != BHY2_OK) {
    failed[i] = true;
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return false;
  }
  flags |= BHY2CALIB_FLAG_RESTORED;
  memset(readback, 0, sizeof(readback));
  if (nicla_hub_read_bsx_state(param, readback, PROFILE_CAP, &total) == BHY2_OK && total == length &&
      memcmp(readback, blob, total) == 0) {
    flags |= BHY2CALIB_FLAG_RESTORE_VERIFIED;
    return true;
  }
  flags |= BHY2CALIB_FLAG_RESTORE_MISMATCH;
  return false;
}

/* Restores profile `i` from its record. `stored[i]` is set only when the hub
   holds the profile afterwards; a record that is missing, unreadable, from
   another hub firmware, or not kept by the hub leaves it false, and the first
   time the sensor is at status 3 replaces it. */
/*@ requires 0 <= i < PROFILE_COUNT;
    assigns flags, failed[i], stored[i], saved_mrad, record[0 .. RECORD_CAP - 1], readback[0 .. PROFILE_CAP - 1]; */
static void restore_profile(int i, uint16_t kernel) {
  size_t actual = 0;

  const int rc = kv_get(RECORD_KEYS[i], record, sizeof(record), &actual);
  if (rc == MBED_ERROR_ITEM_NOT_FOUND) {
    return;
  }
  if (rc != 0) {
    failed[i] = true;
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  if (actual < RECORD_HEADER_LEN || record[0] != RECORD_MAGIC || record[1] != RECORD_FORMAT ||
      nicla_le16(&record[2]) != kernel) {
    flags |= BHY2CALIB_FLAG_RECORD_IGNORED;
    return;
  }
  const uint16_t stored_mrad = nicla_le16(&record[4]);
  const uint32_t length = nicla_le16(&record[6]);
  if (length == 0 || length > PROFILE_CAP || actual != (size_t)(RECORD_HEADER_LEN + length)) {
    flags |= BHY2CALIB_FLAG_RECORD_IGNORED;
    return;
  }
  if (!restore_one(i, &record[RECORD_HEADER_LEN], length)) {
    return;
  }
  stored[i] = true;
  /* The stored accuracy is the bar a later save has to beat. A figure that no
     save can have recorded leaves it unknown. */
  if (i == MAG && stored_mrad >= 1 && stored_mrad <= 600) {
    saved_mrad = stored_mrad;
  }
}

/*@ assigns flags, failed[0 .. PROFILE_COUNT - 1], stored[0 .. PROFILE_COUNT - 1], saved_mrad,
            record[0 .. RECORD_CAP - 1], readback[0 .. PROFILE_CAP - 1]; */
void bhy2calib_restore_profiles(void) {
  const uint16_t kernel = nicla_hub_kernel_version();
  if (kernel == 0) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  /* Removing a key that is not there writes nothing. */
  /*@ loop invariant 0 <= k <= OLD_KEY_COUNT;
      loop assigns k;
      loop variant OLD_KEY_COUNT - k; */
  for (int k = 0; k < OLD_KEY_COUNT; k++) {
    (void)kv_remove(OLD_KEYS[k]);
  }
  restore_profile(ACCEL, kernel);
  restore_profile(GYRO, kernel);
  restore_profile(MAG, kernel);
}

/* Advances the clocks of profile `i` by `elapsed`. */
/*@ requires 0 <= i < PROFILE_COUNT;
    requires elapsed <= TICK_CAP_MS;
    assigns steady_ms[i], since_profile_save_ms[i];
    ensures status[i] != STATUS_CALIBRATED ==> steady_ms[i] == 0; */
static void advance_profile(int i, uint32_t elapsed) {
  steady_ms[i] = status[i] == STATUS_CALIBRATED ? extend(steady_ms[i], elapsed) : 0;
  since_profile_save_ms[i] = extend(since_profile_save_ms[i], elapsed);
}

/* Follows the rotation-vector accuracy: the calm period is the time it has
   been good and not rising. Returns the accuracy in mrad, 0 when not good. */
/*@ requires \is_finite(rad);
    requires elapsed <= TICK_CAP_MS;
    assigns calm_floor_mrad, calm_ms;
    ensures \result <= 600;
    ensures !(rad > 0.0f && rad < SAVE_ACCURACY_RAD) ==> \result == 0;
    ensures \result == 0 ==> calm_ms == 0; */
static uint16_t follow_heading(float rad, uint32_t elapsed) {
  const uint16_t mrad = accuracy_mrad(rad);

  if (mrad == 0) {
    calm_floor_mrad = 0;
    calm_ms = 0;
  } else if (calm_floor_mrad == 0 || mrad > calm_floor_mrad + SAVE_RISE_MRAD) {
    /* Just became good, or climbing: the calm period starts over. Measured
       against the lowest value of the period, because the climb under
       vibration is far too slow to see from one tick to the next. */
    calm_floor_mrad = mrad;
    calm_ms = 0;
  } else {
    if (mrad < calm_floor_mrad) {
      calm_floor_mrad = mrad;
    }
    calm_ms = extend(calm_ms, elapsed);
  }
  return mrad;
}

/* Whether profile `i` is due for a save, given that its sensor has been at
   status 3 for steady_ms[i]: nothing stored yet, or the refresh. */
/*@ requires 0 <= i < PROFILE_COUNT;
    assigns \nothing;
    ensures steady_ms[i] < SAVE_SETTLE_MS ==> !\result; */
static bool profile_due(int i) {
  if (steady_ms[i] < SAVE_SETTLE_MS) {
    return false;
  }
  if (!stored[i]) {
    return true;
  }
  return steady_ms[i] >= REFRESH_CALM_MS && (!saved_this_session[i] || since_profile_save_ms[i] >= REFRESH_INTERVAL_MS);
}

/* The same for the magnetometer, which the heading accuracy `mrad` has a say
   in as well. */
/*@ requires mrad <= 600;
    assigns \nothing;
    ensures steady_ms[MAG] < SAVE_SETTLE_MS ==> !\result;
    ensures mrad == 0 ==> !\result; */
static bool mag_due(uint16_t mrad) {
  if (steady_ms[MAG] < SAVE_SETTLE_MS || mrad == 0 || calm_ms < SAVE_SETTLE_MS) {
    return false;
  }
  if (!stored[MAG] || saved_mrad == ACCURACY_UNKNOWN_MRAD || mrad + SAVE_IMPROVEMENT_MRAD <= saved_mrad) {
    return true;
  }
  return calm_ms >= REFRESH_CALM_MS && steady_ms[MAG] >= REFRESH_CALM_MS &&
         (!saved_this_session[MAG] || since_profile_save_ms[MAG] >= REFRESH_INTERVAL_MS);
}

/* The behaviours are the README's promises about the save policy: a profile
   whose sensor is not at status 3 is never written, and nothing is written
   within SAVE_MIN_INTERVAL_MS of the previous attempt. */
/*@ requires \is_finite(rv_accuracy_rad);
    assigns previous_ms, serviced_before, calm_floor_mrad, calm_ms, since_attempt_ms, since_save_ms, any_saved, flags,
            failed[0 .. PROFILE_COUNT - 1],
            steady_ms[0 .. PROFILE_COUNT - 1], since_profile_save_ms[0 .. PROFILE_COUNT - 1],
            stored[0 .. PROFILE_COUNT - 1], saved_this_session[0 .. PROFILE_COUNT - 1],
            record[0 .. RECORD_CAP - 1], saved_mrad;
    ensures accel_gate: status[ACCEL] != STATUS_CALIBRATED ==>
              stored[ACCEL] == \old(stored[ACCEL]) && saved_this_session[ACCEL] == \old(saved_this_session[ACCEL]);
    ensures gyro_gate: status[GYRO] != STATUS_CALIBRATED ==>
              stored[GYRO] == \old(stored[GYRO]) && saved_this_session[GYRO] == \old(saved_this_session[GYRO]);
    ensures mag_gate: status[MAG] != STATUS_CALIBRATED ==>
              stored[MAG] == \old(stored[MAG]) && saved_this_session[MAG] == \old(saved_this_session[MAG]) &&
              saved_mrad == \old(saved_mrad);
    ensures mag_heading: !(rv_accuracy_rad > 0.0f && rv_accuracy_rad < SAVE_ACCURACY_RAD) ==>
              stored[MAG] == \old(stored[MAG]) && saved_mrad == \old(saved_mrad);
    behavior rate_limited:
      assumes since_attempt_ms + TICK_CAP_MS < SAVE_MIN_INTERVAL_MS;
      ensures no_save: flags == \old(flags) && saved_mrad == \old(saved_mrad) && any_saved == \old(any_saved) &&
              stored[ACCEL] == \old(stored[ACCEL]) && stored[GYRO] == \old(stored[GYRO]) && stored[MAG] == \old(stored[MAG]); */
void bhy2calib_service(float rv_accuracy_rad, uint32_t now_ms) {
  uint32_t elapsed = 0;

  if (serviced_before) {
    elapsed = now_ms - previous_ms;
    if (elapsed > TICK_CAP_MS) {
      elapsed = TICK_CAP_MS;
    }
  }
  previous_ms = now_ms;
  serviced_before = true;
  since_attempt_ms = extend(since_attempt_ms, elapsed);
  since_save_ms = extend(since_save_ms, elapsed);
  advance_profile(ACCEL, elapsed);
  advance_profile(GYRO, elapsed);
  advance_profile(MAG, elapsed);
  const uint16_t mrad = follow_heading(rv_accuracy_rad, elapsed);

  if (since_attempt_ms < SAVE_MIN_INTERVAL_MS) {
    return;
  }
  const bool accel_due = profile_due(ACCEL);
  const bool gyro_due = profile_due(GYRO);
  const bool magnetometer_due = mag_due(mrad);
  if (!accel_due && !gyro_due && !magnetometer_due) {
    return;
  }
  since_attempt_ms = 0;
  const uint16_t kernel = nicla_hub_kernel_version();
  if (kernel == 0) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  if (accel_due) {
    (void)save_profile(ACCEL, kernel, (uint16_t)ACCURACY_UNKNOWN_MRAD);
  }
  if (gyro_due) {
    (void)save_profile(GYRO, kernel, (uint16_t)ACCURACY_UNKNOWN_MRAD);
  }
  if (magnetometer_due) {
    (void)save_profile(MAG, kernel, mrad);
  }
  if (!failed[ACCEL] && !failed[GYRO] && !failed[MAG]) {
    /* No profile is left with a failure that a save has not made good. */
    flags = (uint8_t)(flags & (uint8_t)~BHY2CALIB_FLAG_STORE_ERROR);
  }
}

/*@ requires 0 <= i < PROFILE_COUNT;
    assigns \nothing;
    ensures \result <= STATUS_CALIBRATED; */
static uint8_t status_of(int i) {
  return status[i] > STATUS_CALIBRATED ? (uint8_t)STATUS_CALIBRATED : status[i];
}

/*@ assigns \nothing;
    ensures \result.flags == flags;
    ensures !any_saved ==> \result.minutes_since_save == BHY2CALIB_NO_SAVE;
    ensures any_saved ==> \result.minutes_since_save <= 254;
    ensures \result.sensor_status <= 63; */
struct bhy2calib_status bhy2calib_get_status(void) {
  struct bhy2calib_status s;

  s.flags = flags;
  if (!any_saved) {
    s.minutes_since_save = BHY2CALIB_NO_SAVE;
  } else {
    const uint32_t minutes = since_save_ms / 60000u;
    s.minutes_since_save = minutes > 254u ? 254u : (uint8_t)minutes;
  }
  s.sensor_status = (uint8_t)(status_of(ACCEL) + 4u * status_of(GYRO) + 16u * status_of(MAG));
  return s;
}

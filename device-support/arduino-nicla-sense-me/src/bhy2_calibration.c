#include "bhy2_calibration.h"

#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#include "kvstore_global_api.h"
#include "platform/mbed_error.h"

#include "nicla_bytes.h"
#include "nicla_hub.h"

/* --- Policy -----------------------------------------------------------------
   What the accuracy register does, from a 55-hour recording of a stationary
   board (2026-11-14 .. 16) and the bench (2026-09-18):
    - it reads pi while uncalibrated and falls as the fusion calibrates; the
      resting level was 0.436 rad (25 deg) on a clean bench and 0.53 rad next
      to steel;
    - it never falls while the board is at rest, and it climbs, slowly and
      without limit up to pi, while the board is shaken without being turned
      (0.02 rad per minute at 10 mg of vibration);
    - the profiles are live state: their bytes differ on every read, so
      "changed since the last write" cannot decide whether to save.
   The accuracy the stored profiles were saved at is therefore kept with them,
   and the profiles are saved
    - when the accuracy is better than that by SAVE_IMPROVEMENT_MRAD, or
    - as a refresh, once the accuracy has been good and not rising for
      REFRESH_CALM_MS: once per session, then once per REFRESH_INTERVAL_MS.
      Without it a board whose own magnetic surroundings changed, and that can
      no longer reach the stored accuracy, would restore a stale profile for
      ever. The refresh also keeps the gyroscope and accelerometer profiles,
      which the heading accuracy says nothing about.
   Never while the accuracy is rising, and never more than one attempt per
   SAVE_MIN_INTERVAL_MS. */
#define SAVE_ACCURACY_RAD 0.6f        /* above this the heading is not worth keeping */
#define SAVE_SETTLE_MS 30000u         /* accuracy must have been good and not rising this long */
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

#define ACCURACY_UNKNOWN_MRAD 0xFFFFu /* no stored record, or one without an accuracy */
#define PROFILE_CAP 512u              /* bench: accel 72, gyro 200, mag 408 bytes */
#define PROFILE_COUNT 3u
#define BSX_PARAM_BASE 0x200u

/* Flash record, little-endian. All three profiles are one record, so a failed
   write can never leave profiles from different moments side by side:
     [0] RECORD_MAGIC  [1] RECORD_FORMAT  [2..3] hub kernel version
     [4..5] accuracy at save, mrad  [6..7] [8..9] [10..11] profile lengths
     [12..] the profiles, in PROFILE_IDS order */
#define RECORD_MAGIC 0xB5u
#define RECORD_FORMAT 2u
#define RECORD_HEADER_LEN 12u
#define RECORD_CAP (RECORD_HEADER_LEN + PROFILE_COUNT * PROFILE_CAP)
#define RECORD_KEY "/kv/bhy2cal"

/* Records of the first format, one per profile: [kernel u16][length u16][blob].
   Still restored when no new record exists, and removed after the first save
   in the new format. */
#define LEGACY_HEADER_LEN 4u

/* Physical sensor ids whose BSX state is persisted: accel, gyro, mag. */
static const uint8_t PROFILE_IDS[PROFILE_COUNT] = { 1, 3, 5 };
static const char *const LEGACY_KEYS[PROFILE_COUNT] = { "/kv/bhy2cal1", "/kv/bhy2cal3", "/kv/bhy2cal5" };

static uint8_t flags = 0;
static uint16_t saved_mrad = ACCURACY_UNKNOWN_MRAD; /* accuracy the record in flash was saved at */
static uint16_t calm_floor_mrad = 0;                /* lowest accuracy of the calm period; 0 = accuracy not good */
static uint32_t calm_ms = 0;                        /* how long the accuracy has been good and not rising */
static uint32_t since_attempt_ms = DURATION_MAX_MS; /* time since the last save attempt */
static uint32_t since_save_ms = 0;                  /* meaningful only when saved_this_session */
static bool saved_this_session = false;
static uint32_t previous_ms = 0;                    /* meaningful only when serviced_before */
static bool serviced_before = false;
static uint8_t record[RECORD_CAP];
static uint8_t readback[PROFILE_CAP];

/*@ requires \valid(p + (0 .. 1));
    assigns p[0 .. 1];
    ensures p[0] + 256 * p[1] == value; */
static void put_le16(uint8_t *p, uint16_t value) {
  p[0] = (uint8_t)(value % 256u);
  p[1] = (uint8_t)(value / 256u);
}

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

/*@ requires 1 <= mrad <= 600;
    assigns since_attempt_ms, flags, record[0 .. RECORD_CAP - 1], saved_mrad, since_save_ms, saved_this_session;
    ensures since_attempt_ms == 0; */
static void attempt_save(uint16_t mrad) {
  uint32_t offset = RECORD_HEADER_LEN;

  since_attempt_ms = 0;
  const uint16_t kernel = nicla_hub_kernel_version();
  if (kernel == 0) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  /*@ loop invariant 0 <= i <= PROFILE_COUNT;
      loop invariant RECORD_HEADER_LEN <= offset <= RECORD_HEADER_LEN + i * PROFILE_CAP;
      loop assigns i, offset, flags, record[0 .. RECORD_CAP - 1];
      loop variant PROFILE_COUNT - i; */
  for (uint32_t i = 0; i < PROFILE_COUNT; i++) {
    uint32_t total = 0;

    /* A profile with a missing section is refused by the read; then nothing
       is written at all. */
    if (nicla_hub_read_bsx_state((uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[i]), &record[offset], PROFILE_CAP, &total) != BHY2_OK) {
      flags |= BHY2CALIB_FLAG_STORE_ERROR;
      return;
    }
    put_le16(&record[6u + 2u * i], (uint16_t)total);
    offset += total;
  }
  record[0] = (uint8_t)RECORD_MAGIC;
  record[1] = (uint8_t)RECORD_FORMAT;
  put_le16(&record[2], kernel);
  put_le16(&record[4], mrad);
  /* Mbed's TDBStore (6.17) accepts a record that ends exactly on the last
     byte of its 4 KB flash area, then rejects it in its own read-back check
     and returns an error. That failed call compacts the store, so a second
     write lands at a different offset. */
  int stored = kv_set(RECORD_KEY, record, offset, 0);
  if (stored != 0) {
    stored = kv_set(RECORD_KEY, record, offset, 0);
  }
  if (stored != 0) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  saved_mrad = mrad;
  since_save_ms = 0;
  saved_this_session = true;
  /* The record in flash is good again: an earlier error is history. */
  flags = (uint8_t)((flags & (uint8_t)~BHY2CALIB_FLAG_STORE_ERROR) | BHY2CALIB_FLAG_SAVED);
  /* The new record replaces the per-profile records of the first format.
     Removing a key that is not there writes nothing. */
  /*@ loop invariant 0 <= i <= PROFILE_COUNT;
      loop assigns i;
      loop variant PROFILE_COUNT - i; */
  for (uint32_t i = 0; i < PROFILE_COUNT; i++) {
    (void)kv_remove(LEGACY_KEYS[i]);
  }
}

/* Writes one stored profile into the hub and checks that the hub kept it (the
   bytes are opaque; a mismatch means the write was issued at the wrong time,
   see the header). */
/*@ requires 1 <= length <= PROFILE_CAP;
    requires \valid_read(blob + (0 .. length - 1));
    requires \separated(blob + (0 .. length - 1), readback + (0 .. PROFILE_CAP - 1), &flags);
    assigns flags, readback[0 .. PROFILE_CAP - 1]; */
static void restore_one(uint16_t param, const uint8_t *blob, uint32_t length) {
  uint32_t total = 0;

  if (nicla_hub_write_bsx_state(param, blob, length) != BHY2_OK) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  flags |= BHY2CALIB_FLAG_RESTORED;
  memset(readback, 0, sizeof(readback));
  if (nicla_hub_read_bsx_state(param, readback, PROFILE_CAP, &total) == BHY2_OK && total == length &&
      memcmp(readback, blob, total) == 0) {
    flags |= BHY2CALIB_FLAG_RESTORE_VERIFIED;
  } else {
    flags |= BHY2CALIB_FLAG_RESTORE_MISMATCH;
  }
}

/* Restores the per-profile records of the first format. They carry no
   accuracy, so the stored accuracy stays unknown and the first good window
   saves a record in the new format. */
/*@ assigns flags, record[0 .. RECORD_CAP - 1], readback[0 .. PROFILE_CAP - 1]; */
static void restore_legacy(uint16_t kernel) {
  /*@ loop invariant 0 <= i <= PROFILE_COUNT;
      loop assigns i, flags, record[0 .. RECORD_CAP - 1], readback[0 .. PROFILE_CAP - 1];
      loop variant PROFILE_COUNT - i; */
  for (uint32_t i = 0; i < PROFILE_COUNT; i++) {
    size_t actual = 0;

    const int rc = kv_get(LEGACY_KEYS[i], record, sizeof(record), &actual);
    if (rc == MBED_ERROR_ITEM_NOT_FOUND) {
      continue;
    }
    if (rc != 0) {
      flags |= BHY2CALIB_FLAG_STORE_ERROR;
      continue;
    }
    if (actual < LEGACY_HEADER_LEN) {
      flags |= BHY2CALIB_FLAG_RECORD_IGNORED;
      continue;
    }
    const uint16_t stored_kernel = nicla_le16(&record[0]);
    const uint16_t length = nicla_le16(&record[2]);
    if (stored_kernel != kernel || length == 0 || length > PROFILE_CAP || actual != LEGACY_HEADER_LEN + (size_t)length) {
      flags |= BHY2CALIB_FLAG_RECORD_IGNORED;
      continue;
    }
    restore_one((uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[i]), &record[LEGACY_HEADER_LEN], length);
  }
}

/*@ assigns flags, saved_mrad, record[0 .. RECORD_CAP - 1], readback[0 .. PROFILE_CAP - 1]; */
void bhy2calib_restore_profiles(void) {
  size_t actual = 0;

  const uint16_t kernel = nicla_hub_kernel_version();
  if (kernel == 0) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  const int rc = kv_get(RECORD_KEY, record, sizeof(record), &actual);
  if (rc == MBED_ERROR_ITEM_NOT_FOUND) {
    restore_legacy(kernel);
    return;
  }
  if (rc != 0) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  if (actual < RECORD_HEADER_LEN || record[0] != RECORD_MAGIC || record[1] != RECORD_FORMAT ||
      nicla_le16(&record[2]) != kernel) {
    flags |= BHY2CALIB_FLAG_RECORD_IGNORED;
    return;
  }
  const uint32_t accel_len = nicla_le16(&record[6]);
  const uint32_t gyro_len = nicla_le16(&record[8]);
  const uint32_t mag_len = nicla_le16(&record[10]);
  if (accel_len == 0 || accel_len > PROFILE_CAP || gyro_len == 0 || gyro_len > PROFILE_CAP || mag_len == 0 ||
      mag_len > PROFILE_CAP || actual != (size_t)(RECORD_HEADER_LEN + accel_len + gyro_len + mag_len)) {
    flags |= BHY2CALIB_FLAG_RECORD_IGNORED;
    return;
  }
  const uint16_t stored_mrad = nicla_le16(&record[4]);
  restore_one((uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[0]), &record[RECORD_HEADER_LEN], accel_len);
  restore_one((uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[1]), &record[RECORD_HEADER_LEN + accel_len], gyro_len);
  restore_one((uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[2]), &record[RECORD_HEADER_LEN + accel_len + gyro_len], mag_len);
  /* The stored accuracy is the bar a later save has to beat, which is only
     right while the hub holds the stored profiles. If one of them was not
     taken, or the stored figure is not an accuracy a save can have recorded,
     it stays unknown and the first good window replaces the record. */
  if ((flags & (BHY2CALIB_FLAG_STORE_ERROR | BHY2CALIB_FLAG_RESTORE_MISMATCH)) == 0 && stored_mrad >= 1 && stored_mrad <= 600) {
    saved_mrad = stored_mrad;
  }
}

/* The behaviours are the README's promises about the save policy: when no
   save may happen, the stored accuracy and the flags stay as they were. */
/*@ requires \is_finite(rv_accuracy_rad);
    assigns previous_ms, serviced_before, calm_floor_mrad, calm_ms, since_attempt_ms, since_save_ms, flags,
            record[0 .. RECORD_CAP - 1], saved_mrad, saved_this_session;
    behavior not_good:
      assumes !(rv_accuracy_rad > 0.0f && rv_accuracy_rad < SAVE_ACCURACY_RAD);
      ensures calm_ms == 0 && calm_floor_mrad == 0;
      ensures no_save: flags == \old(flags) && saved_mrad == \old(saved_mrad) && saved_this_session == \old(saved_this_session);
    behavior not_settled:
      assumes calm_ms + TICK_CAP_MS < SAVE_SETTLE_MS;
      ensures no_save: flags == \old(flags) && saved_mrad == \old(saved_mrad) && saved_this_session == \old(saved_this_session);
    behavior rate_limited:
      assumes since_attempt_ms + TICK_CAP_MS < SAVE_MIN_INTERVAL_MS;
      ensures no_save: flags == \old(flags) && saved_mrad == \old(saved_mrad) && saved_this_session == \old(saved_this_session); */
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

  const uint16_t mrad = accuracy_mrad(rv_accuracy_rad);
  if (mrad == 0) {
    calm_floor_mrad = 0;
    calm_ms = 0;
    return;
  }
  if (calm_floor_mrad == 0 || mrad > calm_floor_mrad + SAVE_RISE_MRAD) {
    /* Just became good, or climbing: the calm period starts over. Measured
       against the lowest value of the period, because the climb under
       vibration is far too slow to see from one tick to the next. */
    calm_floor_mrad = mrad;
    calm_ms = 0;
    return;
  }
  if (mrad < calm_floor_mrad) {
    calm_floor_mrad = mrad;
  }
  calm_ms = extend(calm_ms, elapsed);
  if (calm_ms < SAVE_SETTLE_MS || since_attempt_ms < SAVE_MIN_INTERVAL_MS) {
    return;
  }
  const bool improved = saved_mrad == ACCURACY_UNKNOWN_MRAD || mrad + SAVE_IMPROVEMENT_MRAD <= saved_mrad;
  const bool refresh_due = calm_ms >= REFRESH_CALM_MS && (!saved_this_session || since_save_ms >= REFRESH_INTERVAL_MS);
  if (improved || refresh_due) {
    attempt_save(mrad);
  }
}

/*@ assigns \nothing;
    ensures \result.flags == flags;
    ensures !saved_this_session ==> \result.minutes_since_save == BHY2CALIB_NO_SAVE;
    ensures saved_this_session ==> \result.minutes_since_save <= 254; */
struct bhy2calib_status bhy2calib_get_status(void) {
  struct bhy2calib_status s;

  s.flags = flags;
  if (!saved_this_session) {
    s.minutes_since_save = BHY2CALIB_NO_SAVE;
  } else {
    const uint32_t minutes = since_save_ms / 60000u;
    s.minutes_since_save = minutes > 254u ? 254u : (uint8_t)minutes;
  }
  return s;
}

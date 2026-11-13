#include "bhy2_calibration.h"

#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#include "kvstore_global_api.h"
#include "platform/mbed_error.h"

#include "nicla_hub.h"

/* --- Policy -----------------------------------------------------------------
   Bench 2026-09-18: the hub reports quantized accuracy levels: pi while
   uncalibrated, ~1.03 rad (59 deg) early in calibration, then a steady
   0.436 rad (25 deg) once the magnetometer is calibrated; nothing lower was
   observed. 0.6 accepts the calibrated level and rejects the two earlier
   states. */
#define SAVE_ACCURACY_RAD 0.6f
#define SAVE_STABLE_MS 30000u        /* accuracy must stay good this long */
#define SAVE_MIN_INTERVAL_MS 600000u /* at most one save attempt per 10 min */
#define PROFILE_CAP 512u             /* bench: accel 72, gyro 200, mag 408 bytes */
#define PROFILE_COUNT 3u
#define BSX_PARAM_BASE 0x200u

/* Flash record, little-endian: [hub kernel version u16][length u16][blob]. */
#define RECORD_HEADER_LEN 4u
#define RECORD_CAP (RECORD_HEADER_LEN + PROFILE_CAP)

/* Physical sensor ids whose BSX state is persisted: accel, gyro, mag. */
static const uint8_t PROFILE_IDS[PROFILE_COUNT] = { 1, 3, 5 };
static const char *const PROFILE_KEYS[PROFILE_COUNT] = { "/kv/bhy2cal1", "/kv/bhy2cal3", "/kv/bhy2cal5" };

static uint8_t flags = 0;
static uint32_t good_since_ms = 0;   /* 0 = accuracy currently not good */
static uint32_t last_attempt_ms = 0; /* meaningful only when ever_attempted */
static uint32_t last_save_ms = 0;    /* meaningful only when ever_saved */
static bool ever_attempted = false;
static bool ever_saved = false;
static uint8_t record[RECORD_CAP];
static uint8_t last_saved[PROFILE_COUNT * PROFILE_CAP]; /* profile i at i * PROFILE_CAP */
static uint16_t last_saved_len[PROFILE_COUNT] = { 0, 0, 0 };
static uint8_t readback[PROFILE_CAP];

/*@ assigns ever_attempted, last_attempt_ms, flags, record[0 .. RECORD_CAP - 1],
            last_saved[0 .. PROFILE_COUNT * PROFILE_CAP - 1], last_saved_len[0 .. PROFILE_COUNT - 1],
            last_save_ms, ever_saved;
    ensures ever_attempted && last_attempt_ms == now_ms;
    ensures ever_saved && !\old(ever_saved) ==> last_save_ms == now_ms; */
static void attempt_save(uint32_t now_ms) {
  ever_attempted = true;
  last_attempt_ms = now_ms;
  const uint16_t kernel = nicla_hub_kernel_version();
  if (kernel == 0) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  /*@ loop invariant 0 <= i <= PROFILE_COUNT;
      loop invariant ever_saved && !\at(ever_saved, Pre) ==> last_save_ms == now_ms;
      loop assigns i, flags, record[0 .. RECORD_CAP - 1], last_saved[0 .. PROFILE_COUNT * PROFILE_CAP - 1],
                   last_saved_len[0 .. PROFILE_COUNT - 1], last_save_ms, ever_saved;
      loop variant PROFILE_COUNT - i; */
  for (uint32_t i = 0; i < PROFILE_COUNT; i++) {
    uint8_t *const blob = &record[RECORD_HEADER_LEN];
    uint8_t *const previous = &last_saved[i * PROFILE_CAP];
    uint32_t total = 0;

    memset(blob, 0, PROFILE_CAP);
    if (nicla_hub_read_bsx_state((uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[i]), blob, PROFILE_CAP, &total) != BHY2_OK) {
      flags |= BHY2CALIB_FLAG_STORE_ERROR;
      continue;
    }
    if (last_saved_len[i] == total && memcmp(previous, blob, total) == 0) {
      continue; /* unchanged since the last write: spare the flash */
    }
    record[0] = (uint8_t)(kernel & 0xFFu);
    record[1] = (uint8_t)(kernel >> 8);
    record[2] = (uint8_t)(total & 0xFFu);
    record[3] = (uint8_t)(total >> 8);
    if (kv_set(PROFILE_KEYS[i], record, RECORD_HEADER_LEN + total, 0) != 0) {
      flags |= BHY2CALIB_FLAG_STORE_ERROR;
      continue;
    }
    memcpy(previous, blob, total);
    last_saved_len[i] = (uint16_t)total;
    last_save_ms = now_ms;
    ever_saved = true;
    flags |= BHY2CALIB_FLAG_SAVED;
  }
}

/*@ assigns flags, record[0 .. RECORD_CAP - 1], last_saved[0 .. PROFILE_COUNT * PROFILE_CAP - 1],
            last_saved_len[0 .. PROFILE_COUNT - 1], readback[0 .. PROFILE_CAP - 1]; */
void bhy2calib_restore_profiles(void) {
  const uint16_t kernel = nicla_hub_kernel_version();
  if (kernel == 0) {
    flags |= BHY2CALIB_FLAG_STORE_ERROR;
    return;
  }
  /*@ loop invariant 0 <= i <= PROFILE_COUNT;
      loop assigns i, flags, record[0 .. RECORD_CAP - 1], last_saved[0 .. PROFILE_COUNT * PROFILE_CAP - 1],
                   last_saved_len[0 .. PROFILE_COUNT - 1], readback[0 .. PROFILE_CAP - 1];
      loop variant PROFILE_COUNT - i; */
  for (uint32_t i = 0; i < PROFILE_COUNT; i++) {
    const uint8_t *const blob = &record[RECORD_HEADER_LEN];
    const uint16_t param = (uint16_t)(BSX_PARAM_BASE | PROFILE_IDS[i]);
    size_t actual = 0;

    const int rc = kv_get(PROFILE_KEYS[i], record, sizeof(record), &actual);
    if (rc == MBED_ERROR_ITEM_NOT_FOUND) {
      continue;
    }
    if (rc != 0) {
      flags |= BHY2CALIB_FLAG_STORE_ERROR;
      continue;
    }
    if (actual < RECORD_HEADER_LEN) {
      flags |= BHY2CALIB_FLAG_RECORD_IGNORED;
      continue;
    }
    const uint16_t stored_kernel = (uint16_t)(record[0] | (record[1] << 8));
    const uint16_t length = (uint16_t)(record[2] | (record[3] << 8));
    if (stored_kernel != kernel || length == 0 || length > PROFILE_CAP || actual != RECORD_HEADER_LEN + (size_t)length) {
      flags |= BHY2CALIB_FLAG_RECORD_IGNORED;
      continue;
    }
    if (nicla_hub_write_bsx_state(param, blob, length) != BHY2_OK) {
      flags |= BHY2CALIB_FLAG_STORE_ERROR;
      continue;
    }
    /* Seed the change detector so an unchanged profile is not rewritten later. */
    memcpy(&last_saved[i * PROFILE_CAP], blob, length);
    last_saved_len[i] = length;
    flags |= BHY2CALIB_FLAG_RESTORED;
    /* Verify the hub kept what we wrote (the bytes are opaque; a mismatch means
       the write was issued at the wrong time, see the header). */
    uint32_t total = 0;
    memset(readback, 0, sizeof(readback));
    if (nicla_hub_read_bsx_state(param, readback, PROFILE_CAP, &total) == BHY2_OK && total == length &&
        memcmp(readback, blob, total) == 0) {
      flags |= BHY2CALIB_FLAG_RESTORE_VERIFIED;
    } else {
      flags |= BHY2CALIB_FLAG_RESTORE_MISMATCH;
    }
  }
}

/* The behaviours are the README's promises about the save policy. */
/*@ requires \is_finite(rv_accuracy_rad);
    assigns good_since_ms, ever_attempted, last_attempt_ms, flags, record[0 .. RECORD_CAP - 1],
            last_saved[0 .. PROFILE_COUNT * PROFILE_CAP - 1], last_saved_len[0 .. PROFILE_COUNT - 1],
            last_save_ms, ever_saved;
    behavior bad_accuracy:
      assumes rv_accuracy_rad >= SAVE_ACCURACY_RAD;
      ensures good_since_ms == 0;
      ensures ever_attempted == \old(ever_attempted) && last_attempt_ms == \old(last_attempt_ms);
    behavior good_accuracy:
      assumes rv_accuracy_rad < SAVE_ACCURACY_RAD;
      ensures good_since_ms != 0;
    behavior just_became_good:
      assumes rv_accuracy_rad < SAVE_ACCURACY_RAD && good_since_ms == 0;
      ensures no_save_on_first_good_tick: ever_attempted == \old(ever_attempted);
    behavior rate_limited:
      assumes ever_attempted && (uint32_t)(now_ms - last_attempt_ms) < SAVE_MIN_INTERVAL_MS;
      ensures last_attempt_ms == \old(last_attempt_ms);
    complete behaviors bad_accuracy, good_accuracy;
    disjoint behaviors bad_accuracy, good_accuracy; */
void bhy2calib_service(float rv_accuracy_rad, uint32_t now_ms) {
  if (rv_accuracy_rad < SAVE_ACCURACY_RAD) {
    if (good_since_ms == 0) {
      good_since_ms = now_ms == 0 ? 1 : now_ms; /* 0 is reserved for "not good" */
    }
  } else {
    good_since_ms = 0;
    return;
  }
  /* Signed difference: correct across the 32-bit millis() wrap, and negative
     (not huge) on the tick where the stamp was nudged from 0 to 1. */
  if ((int32_t)(now_ms - good_since_ms) < (int32_t)SAVE_STABLE_MS) {
    return;
  }
  if (ever_attempted && now_ms - last_attempt_ms < SAVE_MIN_INTERVAL_MS) {
    return;
  }
  attempt_save(now_ms);
}

/*@ assigns \nothing;
    ensures \result.flags == flags;
    ensures !ever_saved ==> \result.minutes_since_save == BHY2CALIB_NO_SAVE;
    ensures ever_saved ==> \result.minutes_since_save <= 254; */
struct bhy2calib_status bhy2calib_get_status(uint32_t now_ms) {
  struct bhy2calib_status s;

  s.flags = flags;
  if (!ever_saved) {
    s.minutes_since_save = BHY2CALIB_NO_SAVE;
  } else {
    const uint32_t minutes = (now_ms - last_save_ms) / 60000u;
    s.minutes_since_save = minutes > 254u ? 254u : (uint8_t)minutes;
  }
  return s;
}

#include "bhy2_calibration.h"

#include <Arduino.h>
#include <string.h>

#include "Arduino_BHY2.h"
#include "kvstore_global_api.h"

extern "C" {
#include "bosch/bhy2_hif.h"
}

namespace {

using bhy2calib::FLAG_RECORD_IGNORED;
using bhy2calib::FLAG_RESTORED;
using bhy2calib::FLAG_RESTORE_MISMATCH;
using bhy2calib::FLAG_RESTORE_VERIFIED;
using bhy2calib::FLAG_SAVED;
using bhy2calib::FLAG_STORE_ERROR;

// --- Access to the library's private hub handle -----------------------------
// BoschSensortec keeps `struct bhy2_dev _bhy2` private and offers no accessor,
// while the calibration-state transfer needs the HIF handle inside it. This is
// the standard-conformant explicit-instantiation idiom: an explicit template
// instantiation may name a private member, and the friend function it defines
// hands the member pointer out. No library patch, no #define tricks.
template <typename Tag, typename Tag::type Member>
struct PrivateMemberAccess {
  friend typename Tag::type privateMember(Tag) { return Member; }
};
struct BhyDevTag {
  typedef struct bhy2_dev BoschSensortec::*type;
  friend type privateMember(BhyDevTag);
};
template struct PrivateMemberAccess<BhyDevTag, &BoschSensortec::_bhy2>;

struct bhy2_dev &hubDev() { return sensortec.*privateMember(BhyDevTag()); }

// --- Hub parameter access tolerant of stale status entries ------------------
// The stock library reads exactly one status-FIFO entry per parameter request
// and fails when its code does not match; a single stale entry (seen after
// BHY2.begin(): a command-error report) then shifts every later answer by one
// forever. Draining until the code matches fixes it (bench-verified 2026-09-18).
int8_t readParameterSynced(uint16_t param, uint8_t *buffer, uint32_t length, uint32_t *actualLen) {
  struct bhy2_hif_dev *hif = &hubDev().hif;
  int8_t rslt = bhy2_hif_exec_cmd(param | BHY2_PARAM_READ_MASK, NULL, 0, hif);
  if (rslt != BHY2_OK) {
    return rslt;
  }
  for (int attempt = 0; attempt < 8; attempt++) {
    bool ready = false;
    for (int i = 0; i < 200; i++) {
      uint8_t ist = 0;
      rslt = bhy2_hif_get_interrupt_status(&ist, hif);
      if (rslt != BHY2_OK) {
        return rslt;
      }
      if (ist & BHY2_IST_MASK_STATUS) {
        ready = true;
        break;
      }
      delay(1);
    }
    if (!ready) {
      return BHY2_E_TIMEOUT;
    }
    uint16_t code = 0;
    rslt = bhy2_hif_get_status_fifo(&code, buffer, length, actualLen, hif);
    if (rslt != BHY2_OK) {
      return rslt;
    }
    if (code == param) {
      return BHY2_OK;
    }
  }
  return BHY2_E_TIMEOUT;
}

// BSX state block protocol: repeated reads of the same parameter return
// successive 68-byte sections: [0] section | 0x80 when last, [1] bytes in this
// section, [2..3] total length, [4..67] data.
int8_t readBsxState(uint16_t param, uint8_t *out, uint32_t cap, uint32_t *total) {
  uint8_t block[BHY2_BSX_STATE_STRUCT_LEN];
  *total = 0;
  for (int i = 0; i < 16; i++) {
    uint32_t len = 0;
    int8_t rslt = readParameterSynced(param, block, sizeof(block), &len);
    if (rslt != BHY2_OK) {
      return rslt;
    }
    if (len != BHY2_BSX_STATE_STRUCT_LEN) {
      return BHY2_E_INVALID_PARAM;
    }
    const uint8_t section = block[0] & 0x7F;
    const uint8_t blockLen = block[1];
    *total = block[2] | ((uint16_t)block[3] << 8);
    if (*total == 0 || *total > cap) {
      return BHY2_E_BUFFER;
    }
    if (blockLen > BHY2_BSX_STATE_BLOCK_LEN) {
      return BHY2_E_INVALID_PARAM;  // corrupt header: never read past the 68-byte block
    }
    if ((uint32_t)section * BHY2_BSX_STATE_BLOCK_LEN + blockLen <= cap) {
      memcpy(&out[section * BHY2_BSX_STATE_BLOCK_LEN], &block[4], blockLen);
    }
    if (block[0] & BHY2_BSX_STATE_TRANSFER_COMPLETE) {
      return BHY2_OK;
    }
  }
  return BHY2_E_TIMEOUT;
}

int8_t writeBsxState(uint16_t param, const uint8_t *state, uint32_t len) {
  return bhy2_hif_set_bsx_state(param, state, len, &hubDev().hif);
}

// --- Policy -----------------------------------------------------------------
// Bench 2026-09-18: the hub reports quantized accuracy levels — pi while
// uncalibrated, ~1.03 rad (59°) early in calibration, then a steady 0.436 rad
// (25°) once the magnetometer is calibrated; nothing lower was observed. 0.6
// accepts the calibrated level and rejects the two earlier states.
constexpr float SAVE_ACCURACY_RAD = 0.6f;
constexpr uint32_t SAVE_STABLE_MS = 30000;       // accuracy must stay good this long
constexpr uint32_t SAVE_MIN_INTERVAL_MS = 600000; // at most one save attempt per 10 min
constexpr uint32_t PROFILE_CAP = 512;            // bench: accel 72, gyro 200, mag 408 bytes

// Physical sensor ids whose BSX state is persisted: accel, gyro, mag.
constexpr uint8_t PROFILE_IDS[] = { 1, 3, 5 };
constexpr size_t PROFILE_COUNT = sizeof(PROFILE_IDS) / sizeof(PROFILE_IDS[0]);
const char *const PROFILE_KEYS[PROFILE_COUNT] = { "/kv/bhy2cal1", "/kv/bhy2cal3", "/kv/bhy2cal5" };

struct __attribute__((packed)) Record {
  uint16_t kernelVersion;
  uint16_t length;
  uint8_t blob[PROFILE_CAP];
};

uint8_t flags = 0;
uint32_t goodSinceMillis = 0;    // 0 = accuracy currently not good
uint32_t lastAttemptMillis = 0;  // 0 = never
uint32_t lastSaveMillis = 0;     // 0 = never
bool everAttempted = false;
bool everSaved = false;
Record scratch;
uint8_t lastSaved[PROFILE_COUNT][PROFILE_CAP];
uint16_t lastSavedLen[PROFILE_COUNT] = { 0, 0, 0 };

uint16_t kernelVersion() {
  uint16_t version = 0;
  if (bhy2_get_kernel_version(&version, &hubDev()) != BHY2_OK) {
    return 0;
  }
  return version;
}

void attemptSave(uint32_t nowMillis) {
  everAttempted = true;
  lastAttemptMillis = nowMillis;
  const uint16_t kernel = kernelVersion();
  if (kernel == 0) {
    flags |= FLAG_STORE_ERROR;
    return;
  }
  for (size_t i = 0; i < PROFILE_COUNT; i++) {
    uint32_t total = 0;
    memset(scratch.blob, 0, sizeof(scratch.blob));
    if (readBsxState(0x200 | PROFILE_IDS[i], scratch.blob, PROFILE_CAP, &total) != BHY2_OK) {
      flags |= FLAG_STORE_ERROR;
      continue;
    }
    if (lastSavedLen[i] == total && memcmp(lastSaved[i], scratch.blob, total) == 0) {
      continue;  // unchanged since the last write: spare the flash
    }
    scratch.kernelVersion = kernel;
    scratch.length = (uint16_t)total;
    if (kv_set(PROFILE_KEYS[i], &scratch, 4 + total, 0) != 0) {
      flags |= FLAG_STORE_ERROR;
      continue;
    }
    memcpy(lastSaved[i], scratch.blob, total);
    lastSavedLen[i] = (uint16_t)total;
    lastSaveMillis = nowMillis;
    everSaved = true;
    flags |= FLAG_SAVED;
  }
}

}  // namespace

namespace bhy2calib {

void restoreProfiles() {
  const uint16_t kernel = kernelVersion();
  if (kernel == 0) {
    flags |= FLAG_STORE_ERROR;
    return;
  }
  for (size_t i = 0; i < PROFILE_COUNT; i++) {
    size_t actual = 0;
    const int rc = kv_get(PROFILE_KEYS[i], &scratch, sizeof(scratch), &actual);
    if (rc == MBED_ERROR_ITEM_NOT_FOUND) {
      continue;
    }
    if (rc != 0) {
      flags |= FLAG_STORE_ERROR;
      continue;
    }
    if (actual < 4 || scratch.kernelVersion != kernel || scratch.length == 0 ||
        scratch.length > PROFILE_CAP || actual != (size_t)4 + scratch.length) {
      flags |= FLAG_RECORD_IGNORED;
      continue;
    }
    if (writeBsxState(0x200 | PROFILE_IDS[i], scratch.blob, scratch.length) != BHY2_OK) {
      flags |= FLAG_STORE_ERROR;
      continue;
    }
    // Seed the change detector so an unchanged profile is not rewritten later.
    memcpy(lastSaved[i], scratch.blob, scratch.length);
    lastSavedLen[i] = scratch.length;
    flags |= FLAG_RESTORED;
    // Verify the hub kept what we wrote (the bytes are opaque; a mismatch means
    // the write was issued at the wrong time, see the header).
    {
      static uint8_t readback[PROFILE_CAP];
      uint32_t total = 0;
      memset(readback, 0, sizeof(readback));
      if (readBsxState(0x200 | PROFILE_IDS[i], readback, PROFILE_CAP, &total) == BHY2_OK &&
          total == scratch.length && memcmp(readback, scratch.blob, total) == 0) {
        flags |= FLAG_RESTORE_VERIFIED;
      } else {
        flags |= FLAG_RESTORE_MISMATCH;
      }
    }
  }
}

void service(float rvAccuracyRad, uint32_t nowMillis) {
  if (rvAccuracyRad < SAVE_ACCURACY_RAD) {
    if (goodSinceMillis == 0) {
      goodSinceMillis = nowMillis == 0 ? 1 : nowMillis;
    }
  } else {
    goodSinceMillis = 0;
    return;
  }
  if (nowMillis - goodSinceMillis < SAVE_STABLE_MS) {
    return;
  }
  if (everAttempted && nowMillis - lastAttemptMillis < SAVE_MIN_INTERVAL_MS) {
    return;
  }
  attemptSave(nowMillis);
}

Status status(uint32_t nowMillis) {
  Status s;
  s.flags = flags;
  if (!everSaved) {
    s.minutesSinceSave = 255;
  } else {
    const uint32_t minutes = (nowMillis - lastSaveMillis) / 60000u;
    s.minutesSinceSave = minutes > 254 ? 254 : (uint8_t)minutes;
  }
  return s;
}

}  // namespace bhy2calib

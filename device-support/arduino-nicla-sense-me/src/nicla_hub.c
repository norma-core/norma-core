#include "nicla_hub.h"

#include <stddef.h>
#include <string.h>

#include "bosch/bhy2_hif.h"
#include "nicla_bytes.h"

#define STATUS_READY_POLLS 200u /* x 1 ms: how long an answer may take */
#define STATUS_HEADER_LEN 4u    /* [code u16][payload length u16] */
#define DRAIN_CHUNK_LEN 32u
#define DRAIN_CHUNK_LIMIT 16u   /* give up after 512 unexpected bytes */
#define READ_ATTEMPTS 3u
#define EMPTY_HEADER_LIMIT 8u
#define SENSOR_CONF_LEN 12u     /* [rate f32][latency u32][sensitivity u16][range u16] */
#define SENSOR_CONF_RANGE_OFFSET 10u

/* Reads and discards status data until the hub stops signalling any. Reads
   past the end of the data return zeros, so fixed-size chunks are safe. */
/*@ requires \valid(hif);
    assigns \nothing; */
static int8_t drain_status(struct bhy2_hif_dev *hif) {
  uint8_t scrap[DRAIN_CHUNK_LEN];

  /*@ loop invariant 0 <= i <= DRAIN_CHUNK_LIMIT;
      loop assigns i, scrap[0 .. DRAIN_CHUNK_LEN - 1];
      loop variant DRAIN_CHUNK_LIMIT - i; */
  for (uint32_t i = 0; i < DRAIN_CHUNK_LIMIT; i++) {
    uint8_t int_status = 0;
    int8_t rslt = bhy2_hif_get_interrupt_status(&int_status, hif);
    if (rslt != BHY2_OK) {
      return rslt;
    }
    if (!(int_status & BHY2_IST_MASK_STATUS)) {
      return BHY2_OK;
    }
    rslt = bhy2_hif_get_regs(BHY2_REG_CHAN_STATUS, scrap, DRAIN_CHUNK_LEN, hif);
    if (rslt != BHY2_OK) {
      return rslt;
    }
  }
  return BHY2_E_TIMEOUT;
}

/*@ requires \valid(hif);
    assigns \nothing; */
static int8_t wait_status_ready(struct bhy2_hif_dev *hif) {
  /*@ loop invariant 0 <= i <= STATUS_READY_POLLS;
      loop assigns i;
      loop variant STATUS_READY_POLLS - i; */
  for (uint32_t i = 0; i < STATUS_READY_POLLS; i++) {
    uint8_t int_status = 0;
    int8_t rslt = bhy2_hif_get_interrupt_status(&int_status, hif);
    if (rslt != BHY2_OK) {
      return rslt;
    }
    if (int_status & BHY2_IST_MASK_STATUS) {
      return BHY2_OK;
    }
    rslt = bhy2_hif_delay_us(1000, hif);
    if (rslt != BHY2_OK) {
      return rslt;
    }
  }
  return BHY2_E_TIMEOUT;
}

int8_t nicla_hub_read_parameter(uint16_t param, uint8_t *buffer, uint32_t length, uint32_t *actual_len) {
  struct bhy2_hif_dev *hif = &nicla_hub_dev()->hif;
  uint8_t header[STATUS_HEADER_LEN];

  *actual_len = 0;
  /*@ loop invariant 0 <= attempt <= READ_ATTEMPTS;
      loop invariant *actual_len == 0;
      loop assigns attempt, header[0 .. STATUS_HEADER_LEN - 1];
      loop variant READ_ATTEMPTS - attempt; */
  for (uint32_t attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    /* 1. Never send a request while status data is unread (see the header). */
    int8_t rslt = drain_status(hif);
    if (rslt != BHY2_OK) {
      return rslt;
    }
    /* 2. Request; the status flag now rises for this answer. */
    rslt = bhy2_hif_exec_cmd((uint16_t)(param | BHY2_PARAM_READ_MASK), NULL, 0, hif);
    if (rslt != BHY2_OK) {
      return rslt;
    }
    /* 3. Read the entry header. The flag can be up a moment before the entry
       is readable; an all-zero header means "not there yet". */
    uint16_t code = 0;
    uint32_t payload_len = 0;
    /*@ loop invariant 0 <= tries <= EMPTY_HEADER_LIMIT;
        loop assigns tries, rslt, code, payload_len, header[0 .. STATUS_HEADER_LEN - 1];
        loop variant EMPTY_HEADER_LIMIT - tries; */
    for (uint32_t tries = 0; tries < EMPTY_HEADER_LIMIT; tries++) {
      rslt = wait_status_ready(hif);
      if (rslt != BHY2_OK) {
        return rslt;
      }
      rslt = bhy2_hif_get_regs(BHY2_REG_CHAN_STATUS, header, STATUS_HEADER_LEN, hif);
      if (rslt != BHY2_OK) {
        return rslt;
      }
      code = nicla_le16(&header[0]);
      payload_len = nicla_le16(&header[2]);
      if (code != 0 || payload_len != 0) {
        break;
      }
      rslt = bhy2_hif_delay_us(1000, hif);
      if (rslt != BHY2_OK) {
        return rslt;
      }
    }
    /* 4. Accept exactly the awaited entry. */
    if (code == param) {
      if (payload_len > length) {
        (void)drain_status(hif); /* leave the channel clean */
        return BHY2_E_BUFFER;
      }
      if (payload_len != 0) {
        rslt = bhy2_hif_get_regs(BHY2_REG_CHAN_STATUS, buffer, payload_len, hif);
        if (rslt != BHY2_OK) {
          return rslt;
        }
      }
      *actual_len = payload_len;
      return BHY2_OK;
    }
    /* Another entry slipped in between the drain and the request. The hub may
       have reset the channel under this very read, so neither this header's
       length nor the bytes behind it can be trusted: start over. */
  }
  return BHY2_E_TIMEOUT;
}

/* BSX state block protocol: repeated reads of the same parameter return
   successive 68-byte sections: [0] section index | 0x80 when last, [1] bytes
   in this section, [2..3] total length, [4..67] data. */
int8_t nicla_hub_read_bsx_state(uint16_t param, uint8_t *out, uint32_t cap, uint32_t *total) {
  uint8_t block[BHY2_BSX_STATE_STRUCT_LEN];

  *total = 0;
  /*@ loop invariant 0 <= i <= 16;
      loop assigns i, block[0 .. BHY2_BSX_STATE_STRUCT_LEN - 1], out[0 .. cap - 1], *total;
      loop variant 16 - i; */
  for (uint32_t i = 0; i < 16; i++) {
    uint32_t len = 0;
    const int8_t rslt = nicla_hub_read_parameter(param, block, sizeof(block), &len);
    if (rslt != BHY2_OK) {
      return rslt;
    }
    if (len != BHY2_BSX_STATE_STRUCT_LEN) {
      return BHY2_E_INVALID_PARAM;
    }
    const uint32_t section = block[0] & 0x7Fu;
    const uint32_t block_len = block[1];
    const uint32_t total_len = nicla_le16(&block[2]);
    *total = total_len;
    if (total_len == 0 || total_len > cap) {
      return BHY2_E_BUFFER;
    }
    if (block_len > BHY2_BSX_STATE_BLOCK_LEN) {
      return BHY2_E_INVALID_PARAM; /* corrupt header: never read past the 68-byte block */
    }
    const uint32_t offset = section * BHY2_BSX_STATE_BLOCK_LEN;
    if (offset + block_len <= cap) {
      memcpy(&out[offset], &block[4], block_len);
    }
    if (block[0] & BHY2_BSX_STATE_TRANSFER_COMPLETE) {
      return BHY2_OK;
    }
  }
  return BHY2_E_TIMEOUT;
}

int8_t nicla_hub_write_bsx_state(uint16_t param, const uint8_t *state, uint32_t len) {
  return bhy2_hif_set_bsx_state(param, state, len, &nicla_hub_dev()->hif);
}

bool nicla_hub_read_sensor_range(uint8_t sensor_id, uint16_t *range) {
  uint8_t conf[SENSOR_CONF_LEN];
  uint32_t len = 0;

  if (nicla_hub_read_parameter((uint16_t)(BHY2_PARAM_SENSOR_CONF_0 + sensor_id), conf, sizeof(conf), &len) != BHY2_OK) {
    return false;
  }
  if (len != SENSOR_CONF_LEN) {
    return false;
  }
  *range = nicla_le16(&conf[SENSOR_CONF_RANGE_OFFSET]);
  return true;
}

uint16_t nicla_hub_kernel_version(void) {
  uint16_t version = 0;

  if (bhy2_hif_get_kernel_version(&version, &nicla_hub_dev()->hif) != BHY2_OK) {
    return 0;
  }
  return version;
}

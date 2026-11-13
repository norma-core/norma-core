#include "nicla_protocol.h"

#include <string.h>

#include "nicla_hub.h"

void nicla_put_u16(uint8_t *map, size_t offset, uint16_t value) {
  map[offset] = (uint8_t)(value % 256u);
  map[offset + 1] = (uint8_t)(value / 256u);
}

void nicla_put_i16(uint8_t *map, size_t offset, int16_t value) {
  nicla_put_u16(map, offset, (uint16_t)value);
}

void nicla_put_u32(uint8_t *map, size_t offset, uint32_t value) {
  map[offset] = (uint8_t)(value & 0xFFu);
  map[offset + 1] = (uint8_t)((value >> 8) & 0xFFu);
  map[offset + 2] = (uint8_t)((value >> 16) & 0xFFu);
  map[offset + 3] = (uint8_t)(value >> 24);
}

/* IEEE-754 single as its 32-bit pattern, the form the consumers expect. The
   copy reinterprets a float as bytes, which WP's typed memory model cannot
   express, so this one function is checked by Frama-C's Eva analysis instead
   (see ../verify/run.sh); WP uses only the contract below. */
/*@ assigns \nothing; */
static uint32_t nicla_f32_bits(float value) {
  uint32_t bits;

  memcpy(&bits, &value, sizeof(bits));
  return bits;
}

void nicla_put_f32(uint8_t *map, size_t offset, float value) {
  nicla_put_u32(map, offset, nicla_f32_bits(value));
}

bool nicla_publish_accel_range(uint8_t *map, uint8_t sensor_id) {
  uint16_t g = 0;

  if (!nicla_hub_read_sensor_range(sensor_id, &g)) {
    return false;
  }
  if (g != 2 && g != 4 && g != 8 && g != 16) {
    return false; /* not a range the accelerometer has */
  }
  nicla_put_u16(map, NICLA_REG_ACCEL_RANGE_G, g);
  return true;
}

bool nicla_publish_gyro_range(uint8_t *map, uint8_t sensor_id) {
  uint16_t dps = 0;

  if (!nicla_hub_read_sensor_range(sensor_id, &dps)) {
    return false;
  }
  if (dps != 125 && dps != 250 && dps != 500 && dps != 1000 && dps != 2000) {
    return false; /* not a range the gyroscope has */
  }
  nicla_put_u16(map, NICLA_REG_GYRO_RANGE_DPS, dps);
  return true;
}

/*@ assigns \nothing; */
static uint8_t crc8_update(uint8_t crc, uint8_t byte) {
  crc ^= byte;
  /*@ loop invariant 0 <= bit <= 8;
      loop assigns bit, crc;
      loop variant 8 - bit; */
  for (uint8_t bit = 0; bit < 8; bit++) {
    crc = (crc & 0x80u) ? (uint8_t)((crc << 1) ^ 0x07u) : (uint8_t)(crc << 1);
  }
  return crc;
}

uint8_t nicla_crc8(const uint8_t *data, size_t len) {
  uint8_t crc = 0;
  /*@ loop invariant 0 <= i <= len;
      loop assigns i, crc;
      loop variant len - i; */
  for (size_t i = 0; i < len; i++) {
    crc = crc8_update(crc, data[i]);
  }
  return crc;
}

void nicla_build_frame(const uint8_t *map, uint8_t *frame) {
  frame[0] = NICLA_FRAME_MAGIC0;
  frame[1] = NICLA_FRAME_MAGIC1;
  frame[2] = (uint8_t)NICLA_REG_MAP_SIZE;
  memcpy(&frame[3], map, NICLA_REG_MAP_SIZE);
  frame[3 + NICLA_REG_MAP_SIZE] = nicla_crc8(&frame[3], NICLA_REG_MAP_SIZE);
}

/* Streaming deadline: 0 = off, otherwise the millis() time when the stream
   expires unless another STREAM_START keepalive arrives. */
static uint32_t stream_deadline_ms = 0;

/*@ assigns stream_deadline_ms;
    ensures cmd == NICLA_CMD_STREAM_START ==> stream_deadline_ms != 0;
    ensures cmd == NICLA_CMD_STREAM_STOP ==> stream_deadline_ms == 0;
    ensures \result <==> cmd == NICLA_CMD_DUMP; */
bool nicla_stream_command(uint8_t cmd, uint32_t now_ms) {
  if (cmd == NICLA_CMD_STREAM_START) {
    stream_deadline_ms = now_ms + NICLA_STREAM_KEEPALIVE_TIMEOUT_MS;
    if (stream_deadline_ms == 0) {
      stream_deadline_ms = 1; /* keep 0 reserved for "off" across the wrap */
    }
  } else if (cmd == NICLA_CMD_STREAM_STOP) {
    stream_deadline_ms = 0;
  } else if (cmd == NICLA_CMD_DUMP) {
    return true;
  }
  return false; /* unknown bytes are ignored */
}

/*@ assigns \nothing;
    ensures stream_deadline_ms == 0 ==> !\result; */
bool nicla_stream_active(uint32_t now_ms) {
  return stream_deadline_ms != 0 && (int32_t)(stream_deadline_ms - now_ms) > 0;
}

/*@ assigns stream_deadline_ms;
    ensures !\result ==> stream_deadline_ms == 0;
    ensures \result ==> stream_deadline_ms == \old(stream_deadline_ms); */
bool nicla_stream_poll(uint32_t now_ms) {
  const bool active = nicla_stream_active(now_ms);

  if (!active) {
    stream_deadline_ms = 0;
  }
  return active;
}

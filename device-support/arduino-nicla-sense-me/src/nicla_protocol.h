/*
 * Register map and USB serial protocol of the Nicla Sense ME station firmware:
 * the contract shared with software/drivers/arduino-nicla-sense-me and the
 * station-viewer (see ../README.md). Plain C; the sketch only gathers sensor
 * values and moves bytes.
 */
#ifndef NICLA_PROTOCOL_H
#define NICLA_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define NICLA_REG_MAP_SIZE 0x7Cu
#define NICLA_SOFTWARE_REVISION 6u
#define NICLA_PRODUCT_ID 0x4Du /* 'M' */

/* Register offsets (little-endian values). */
enum {
  NICLA_REG_STATUS = 0x00,           /* bit0: BHY2 running */
  NICLA_REG_SAMPLE_COUNTER = 0x01,   /* u8, wraps */
  NICLA_REG_SOFTWARE_REVISION = 0x0C,
  NICLA_REG_PRODUCT_ID = 0x0D,
  NICLA_REG_SERIAL = 0x0E,           /* 6 bytes */
  NICLA_REG_ACCEL_RAW = 0x14,        /* 3 x i16 counts */
  NICLA_REG_GYRO_RAW = 0x1A,         /* 3 x i16 counts */
  NICLA_REG_MAG_RAW = 0x20,          /* 3 x i16 counts */
  NICLA_REG_ACCEL_RANGE_G = 0x26,    /* u16, full scale in g; 0 = not read from the hub yet */
  NICLA_REG_GYRO_RANGE_DPS = 0x28,   /* u16, full scale in dps; 0 = not read from the hub yet */
  NICLA_REG_MAG_LSB_PER_UT = 0x2A,   /* u16 */
  NICLA_REG_QUAT = 0x2C,             /* w, x, y, z, accuracy (5 x f32) */
  NICLA_REG_TEMPERATURE = 0x40,
  NICLA_REG_HUMIDITY = 0x44,
  NICLA_REG_PRESSURE = 0x48,
  NICLA_REG_GAS = 0x4C,
  NICLA_REG_IAQ = 0x50,
  NICLA_REG_IAQ_STATIC = 0x54,
  NICLA_REG_ECO2 = 0x58,
  NICLA_REG_BVOC = 0x5C,
  NICLA_REG_COMP_TEMPERATURE = 0x60,
  NICLA_REG_COMP_HUMIDITY = 0x64,
  NICLA_REG_BSEC_ACCURACY = 0x68,    /* u8 */
  NICLA_REG_CALIB_FLAGS = 0x69,      /* u8, BHY2CALIB_FLAG_* */
  NICLA_REG_CALIB_MINUTES = 0x6A,    /* u8, minutes since last profile save (255 = none) */
  NICLA_REG_STEP_COUNT = 0x6C,       /* u32 */
  NICLA_REG_ACTIVITY = 0x70,         /* u32 bitfield */
  NICLA_REG_TICK_COUNTER = 0x74,     /* u32, loop ticks since boot */
  NICLA_REG_FRESH_FLAGS = 0x78       /* u16, NICLA_FRESH_* */
};

/* Freshness bits: the virtual sensor delivered a new sample during this tick. */
#define NICLA_FRESH_ACCEL (1u << 0)
#define NICLA_FRESH_GYRO (1u << 1)
#define NICLA_FRESH_MAG (1u << 2)
#define NICLA_FRESH_QUAT (1u << 3)
#define NICLA_FRESH_TEMPERATURE (1u << 4)
#define NICLA_FRESH_HUMIDITY (1u << 5)
#define NICLA_FRESH_PRESSURE (1u << 6)
#define NICLA_FRESH_GAS (1u << 7)
#define NICLA_FRESH_BSEC (1u << 8)
#define NICLA_FRESH_STEPS (1u << 9)
#define NICLA_FRESH_ACTIVITY (1u << 10)

/* Little-endian register writers; `map` is the NICLA_REG_MAP_SIZE-byte image. */
/*@ requires offset + 2 <= NICLA_REG_MAP_SIZE && \valid(map + (0 .. NICLA_REG_MAP_SIZE - 1));
    assigns map[offset .. offset + 1];
    ensures map[offset] == value % 256 && map[offset + 1] == value / 256; */
void nicla_put_u16(uint8_t *map, size_t offset, uint16_t value);
/*@ requires offset + 2 <= NICLA_REG_MAP_SIZE && \valid(map + (0 .. NICLA_REG_MAP_SIZE - 1));
    assigns map[offset .. offset + 1]; */
void nicla_put_i16(uint8_t *map, size_t offset, int16_t value);
/*@ requires offset + 4 <= NICLA_REG_MAP_SIZE && \valid(map + (0 .. NICLA_REG_MAP_SIZE - 1));
    assigns map[offset .. offset + 3]; */
void nicla_put_u32(uint8_t *map, size_t offset, uint32_t value);
/*@ requires offset + 4 <= NICLA_REG_MAP_SIZE && \valid(map + (0 .. NICLA_REG_MAP_SIZE - 1));
    assigns map[offset .. offset + 3]; */
void nicla_put_f32(uint8_t *map, size_t offset, float value);

/* Publish the full-scale range the hub reports as in effect, in g
   (NICLA_REG_ACCEL_RANGE_G) and dps (NICLA_REG_GYRO_RANGE_DPS). A register is
   written only when the hub's answer for exactly that sensor arrived complete
   AND holds a range the sensor can have (2/4/8/16 g; 125/250/500/1000/2000
   dps). Otherwise it keeps its previous value, which is 0 ("unknown",
   consumers do not scale) until the first good read: a wrong scale is never
   published. Return whether the register was refreshed. */
/*@ requires \valid(map + (0 .. NICLA_REG_MAP_SIZE - 1));
    assigns map[NICLA_REG_ACCEL_RANGE_G .. NICLA_REG_ACCEL_RANGE_G + 1];
    ensures !\result ==> map[NICLA_REG_ACCEL_RANGE_G] == \old(map[NICLA_REG_ACCEL_RANGE_G]) &&
                         map[NICLA_REG_ACCEL_RANGE_G + 1] == \old(map[NICLA_REG_ACCEL_RANGE_G + 1]);
    ensures \result ==> map[NICLA_REG_ACCEL_RANGE_G + 1] == 0 &&
                        (map[NICLA_REG_ACCEL_RANGE_G] == 2 || map[NICLA_REG_ACCEL_RANGE_G] == 4 ||
                         map[NICLA_REG_ACCEL_RANGE_G] == 8 || map[NICLA_REG_ACCEL_RANGE_G] == 16); */
bool nicla_publish_accel_range(uint8_t *map, uint8_t sensor_id);

/*@ requires \valid(map + (0 .. NICLA_REG_MAP_SIZE - 1));
    assigns map[NICLA_REG_GYRO_RANGE_DPS .. NICLA_REG_GYRO_RANGE_DPS + 1];
    ensures !\result ==> map[NICLA_REG_GYRO_RANGE_DPS] == \old(map[NICLA_REG_GYRO_RANGE_DPS]) &&
                         map[NICLA_REG_GYRO_RANGE_DPS + 1] == \old(map[NICLA_REG_GYRO_RANGE_DPS + 1]); */
bool nicla_publish_gyro_range(uint8_t *map, uint8_t sensor_id);

/* USB serial protocol. Frame format:
     [0xA5, 0x5A, 0x7C, <124-byte register image>, crc8(image)]
   CRC8 is poly 0x07, init 0x00, computed over the image only.
   Commands (single bytes; unknown bytes are ignored):
     0x01 DUMP          reply with one frame (request/reply probing); ignored
                        while streaming, the pushed frame is the reply
     0x02 STREAM_START  push one frame per 10 ms tick; also the keepalive:
                        streaming stops unless refreshed within 2 s, so a dead
                        host cannot leave the board transmitting
     0x03 STREAM_STOP   stop pushing immediately */
#define NICLA_CMD_DUMP 0x01u
#define NICLA_CMD_STREAM_START 0x02u
#define NICLA_CMD_STREAM_STOP 0x03u
#define NICLA_STREAM_KEEPALIVE_TIMEOUT_MS 2000u
#define NICLA_FRAME_MAGIC0 0xA5u
#define NICLA_FRAME_MAGIC1 0x5Au
#define NICLA_FRAME_SIZE (3u + NICLA_REG_MAP_SIZE + 1u)

/*@ requires \valid_read(data + (0 .. len - 1));
    assigns \nothing; */
uint8_t nicla_crc8(const uint8_t *data, size_t len);

/*@ requires \valid_read(map + (0 .. NICLA_REG_MAP_SIZE - 1));
    requires \valid(frame + (0 .. NICLA_FRAME_SIZE - 1));
    requires \separated(map + (0 .. NICLA_REG_MAP_SIZE - 1), frame + (0 .. NICLA_FRAME_SIZE - 1));
    assigns frame[0 .. NICLA_FRAME_SIZE - 1];
    ensures frame[0] == NICLA_FRAME_MAGIC0 && frame[1] == NICLA_FRAME_MAGIC1 && frame[2] == NICLA_REG_MAP_SIZE; */
void nicla_build_frame(const uint8_t *map, uint8_t *frame);

/* Applies one command byte received at `now_ms`. Returns true when the byte
   asks for a dump reply (the caller decides, after draining its batch,
   whether to send it: not while streaming). */
bool nicla_stream_command(uint8_t cmd, uint32_t now_ms);

/* Whether frames should be pushed at `now_ms`. */
bool nicla_stream_active(uint32_t now_ms);

/* Same, and forgets an expired deadline: otherwise the signed comparison turns
   positive again once millis() wraps past it (~24.8 days) and streaming would
   resume unattended. Call once per tick. */
bool nicla_stream_poll(uint32_t now_ms);

#ifdef __cplusplus
}
#endif

#endif /* NICLA_PROTOCOL_H */

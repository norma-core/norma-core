/* Byte-order helpers shared by the firmware's C modules. */
#ifndef NICLA_BYTES_H
#define NICLA_BYTES_H

#include <stdint.h>

/* Little-endian 16-bit read. Written as arithmetic rather than shift-and-OR:
   the compiler emits the same code, and the proof (see ../verify) then needs
   no assumed facts about bit operations. */
/*@ requires \valid_read(p + (0 .. 1));
    assigns \nothing;
    ensures \result == p[0] + 256 * p[1]; */
static inline uint16_t nicla_le16(const uint8_t *p) {
  return (uint16_t)(p[0] + 256u * p[1]);
}

/* Little-endian 16-bit write, the counterpart of nicla_le16. */
/*@ requires \valid(p + (0 .. 1));
    assigns p[0 .. 1];
    ensures p[0] == value % 256 && p[1] == value / 256;
    ensures p[0] + 256 * p[1] == value; */
static inline void nicla_put_le16(uint8_t *p, uint16_t value) {
  p[0] = (uint8_t)(value % 256u);
  p[1] = (uint8_t)(value / 256u);
}

#endif

/*
 * Sensor-hub (BHI260AP) parameter reads that cannot return another request's
 * answer.
 *
 * The hub answers a parameter read with one entry in its status channel:
 * [code u16][length u16][payload]. Two properties of the real hub, both
 * measured on the bench (2026-11-13), break the stock Bosch/Arduino_BHY2 read:
 *
 *  - Unread entries can be pending when a request is sent (a late answer, a
 *    command-error report after BHY2.begin(), others appear during normal
 *    operation). The stock read takes whatever entry is there, decodes its
 *    payload even though it reports an error, and the Arduino wrapper
 *    (SensorClass::getConfiguration) cannot report the error at all. On the
 *    bench this published the gyroscope's range for the accelerometer and
 *    vice versa for a second or two at a time, 2 % of all frames.
 *  - When the hub processes a command it resets the status channel. A host
 *    that is reading an old entry at that moment receives a mix of old and
 *    new bytes: payloads shifted by a byte, headers with absurd lengths, even
 *    an entry with the right code and length but the wrong content. So
 *    skipping entries until the code matches is not safe either.
 *
 * The protocol used here: empty the status channel, only then send the
 * request, wait for the status flag, and accept exactly the awaited entry;
 * anything else means start over. The firmware reads hub parameters only
 * through this module.
 *
 * The comments starting with an at-sign are ACSL contracts checked by
 * Frama-C/WP (see ../verify); the compiler ignores them.
 */
#ifndef NICLA_HUB_H
#define NICLA_HUB_H

#include <stdbool.h>
#include <stdint.h>

#include "bosch/bhy2_defs.h"

#ifdef __cplusplus
extern "C" {
#endif

/* The Arduino_BHY2 library's device handle. Implemented in nicla_hub_dev.cpp,
   the one place that has to be C++ (the handle is a private class member). */
/*@ assigns \nothing;
    ensures \valid(\result); */
struct bhy2_dev *nicla_hub_dev(void);

/* Parameter read. On BHY2_OK the payload of the entry whose code is `param`
   is in buffer[0 .. *actual_len - 1]. BHY2_E_BUFFER means the answer was
   larger than the buffer; BHY2_E_TIMEOUT that no answer arrived in time or
   the channel would not settle. Blocks for a few ms, 200 ms at worst. */
/*@ requires \valid(buffer + (0 .. length - 1)) && \valid(actual_len);
    requires \separated(buffer + (0 .. length - 1), actual_len);
    assigns buffer[0 .. length - 1], *actual_len;
    ensures \result == BHY2_OK ==> *actual_len <= length; */
int8_t nicla_hub_read_parameter(uint16_t param, uint8_t *buffer, uint32_t length, uint32_t *actual_len);

/* Reads a BSX calibration state (parameters 0x201 accel, 0x203 gyro, 0x205
   mag). Never writes outside out[0 .. cap - 1] whatever the hub sends; on
   BHY2_OK *total is the state length, 1 .. cap. */
/*@ requires 1 <= cap <= 0xFFFF;
    requires \valid(out + (0 .. cap - 1)) && \valid(total);
    requires \separated(out + (0 .. cap - 1), total);
    assigns out[0 .. cap - 1], *total;
    ensures \result == BHY2_OK ==> 1 <= *total <= cap; */
int8_t nicla_hub_read_bsx_state(uint16_t param, uint8_t *out, uint32_t cap, uint32_t *total);

/*@ requires \valid_read(state + (0 .. len - 1));
    assigns \nothing; */
int8_t nicla_hub_write_bsx_state(uint16_t param, const uint8_t *state, uint32_t len);

/* Full-scale range the hub reports as in effect for a virtual sensor (g for
   the accelerometer, dps for the gyroscope). *range is written only when the
   hub's answer for exactly this sensor arrived complete. */
/*@ requires \valid(range);
    assigns *range;
    ensures !\result ==> *range == \old(*range); */
bool nicla_hub_read_sensor_range(uint8_t sensor_id, uint16_t *range);

/* Hub kernel version, 0 when it cannot be read. */
/*@ assigns \nothing; */
uint16_t nicla_hub_kernel_version(void);

#ifdef __cplusplus
}
#endif

#endif /* NICLA_HUB_H */

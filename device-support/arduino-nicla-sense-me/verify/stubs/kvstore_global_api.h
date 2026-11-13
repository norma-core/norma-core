/* Frama-C stand-in for the Mbed KVStore API: flash may return any bytes and
   any size. The real functions take void*; the firmware only ever passes its
   uint8_t record buffer, which is what the model states. */
#ifndef WP_KVSTORE_H
#define WP_KVSTORE_H
#include <stddef.h>
#include <stdint.h>

/*@ requires \valid_read(buffer + (0 .. size - 1));
    assigns \result \from \nothing; */
int kv_set(const char *full_name_key, const uint8_t *buffer, size_t size, uint32_t create_flags);

/*@ requires \valid(buffer + (0 .. buffer_size - 1)) && \valid(actual_size);
    assigns buffer[0 .. buffer_size - 1], *actual_size \from \nothing;
    assigns \result \from \nothing; */
int kv_get(const char *full_name_key, uint8_t *buffer, size_t buffer_size, size_t *actual_size);
#endif

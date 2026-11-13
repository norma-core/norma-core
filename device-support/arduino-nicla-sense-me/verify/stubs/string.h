/* Byte-buffer primitives modelled over uint8_t. WP's Typed memory model
   cannot follow the void* (or Frama-C's own char*) signatures back to the
   firmware's uint8_t buffers, so for the proof the three calls are routed to
   uint8_t-typed models with the same meaning. */
#ifndef WP_STRING_H
#define WP_STRING_H
#include <stddef.h>
#include <stdint.h>

/*@ requires \valid(dest + (0 .. n - 1)) && \valid_read(src + (0 .. n - 1));
    requires \separated(dest + (0 .. n - 1), src + (0 .. n - 1));
    assigns dest[0 .. n - 1];
    ensures \forall integer k; 0 <= k < n ==> dest[k] == src[k]; */
uint8_t *wp_memcpy(uint8_t *dest, const uint8_t *src, size_t n);

/*@ requires \valid(s + (0 .. n - 1));
    assigns s[0 .. n - 1]; */
uint8_t *wp_memset(uint8_t *s, int c, size_t n);

/*@ requires \valid_read(a + (0 .. n - 1)) && \valid_read(b + (0 .. n - 1));
    assigns \nothing; */
int wp_memcmp(const uint8_t *a, const uint8_t *b, size_t n);

#define memcpy(d, s, n) wp_memcpy((uint8_t *)(d), (const uint8_t *)(s), (n))
#define memset(s, c, n) wp_memset((uint8_t *)(s), (c), (n))
#define memcmp(a, b, n) wp_memcmp((const uint8_t *)(a), (const uint8_t *)(b), (n))
#endif

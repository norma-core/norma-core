#ifndef NORMA_PWM_OUTPUT_PROTOCOL_H
#define NORMA_PWM_OUTPUT_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#ifndef PWM_OUTPUT_PROTOCOL_MAX_PAYLOAD_SIZE
#define PWM_OUTPUT_PROTOCOL_MAX_PAYLOAD_SIZE 4096u
#endif

#define PWM_OUTPUT_PROTOCOL_HEADER_LEN 9u
#define PWM_OUTPUT_PROTOCOL_CRC_LEN 4u

enum pwm_output_protocol_status {
	PWM_OUTPUT_PROTOCOL_OK = 0,
	PWM_OUTPUT_PROTOCOL_NEED_MORE,
	PWM_OUTPUT_PROTOCOL_BAD_MAGIC,
	PWM_OUTPUT_PROTOCOL_BAD_VERSION,
	PWM_OUTPUT_PROTOCOL_BAD_LENGTH,
	PWM_OUTPUT_PROTOCOL_BAD_CRC,
};

uint32_t pwm_output_crc32(const uint8_t *data, size_t len);

enum pwm_output_protocol_status pwm_output_protocol_decode_frame(
	const uint8_t *data,
	size_t len,
	const uint8_t **payload,
	size_t *payload_len,
	size_t *frame_len);

#ifdef __cplusplus
}
#endif

#endif

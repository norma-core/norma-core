#include "protocol.h"

#include <stdbool.h>

static uint32_t read_le32(const uint8_t *data)
{
	return ((uint32_t)data[0])
	     | ((uint32_t)data[1] << 8u)
	     | ((uint32_t)data[2] << 16u)
	     | ((uint32_t)data[3] << 24u);
}

uint32_t pwm_output_crc32(const uint8_t *data, size_t len)
{
	uint32_t crc = 0xffffffffu;
	for (size_t i = 0; i < len; i++) {
		crc ^= data[i];
		for (unsigned bit = 0; bit < 8u; bit++) {
			uint32_t mask = 0u - (crc & 1u);
			crc = (crc >> 1u) ^ (0xedb88320u & mask);
		}
	}
	return ~crc;
}

enum pwm_output_protocol_status pwm_output_protocol_decode_frame(
	const uint8_t *data,
	size_t len,
	const uint8_t **payload,
	size_t *payload_len,
	size_t *frame_len)
{
	static const uint8_t magic[4] = { 'N', 'C', 'W', 'V' };

	if (payload != NULL) {
		*payload = NULL;
	}
	if (payload_len != NULL) {
		*payload_len = 0;
	}
	if (frame_len != NULL) {
		*frame_len = 0;
	}

	if (data == NULL) {
		return PWM_OUTPUT_PROTOCOL_BAD_MAGIC;
	}
	if (len < PWM_OUTPUT_PROTOCOL_HEADER_LEN) {
		return PWM_OUTPUT_PROTOCOL_NEED_MORE;
	}

	for (size_t i = 0; i < sizeof(magic); i++) {
		if (data[i] != magic[i]) {
			return PWM_OUTPUT_PROTOCOL_BAD_MAGIC;
		}
	}
	if (data[4] != 1u) {
		return PWM_OUTPUT_PROTOCOL_BAD_VERSION;
	}

	uint32_t body_len_u32 = read_le32(data + 5);
	if (body_len_u32 > PWM_OUTPUT_PROTOCOL_MAX_PAYLOAD_SIZE) {
		return PWM_OUTPUT_PROTOCOL_BAD_LENGTH;
	}

	size_t body_len = (size_t)body_len_u32;
	size_t total_len = PWM_OUTPUT_PROTOCOL_HEADER_LEN + body_len + PWM_OUTPUT_PROTOCOL_CRC_LEN;
	if (total_len < body_len) {
		return PWM_OUTPUT_PROTOCOL_BAD_LENGTH;
	}
	if (len < total_len) {
		return PWM_OUTPUT_PROTOCOL_NEED_MORE;
	}

	uint32_t expected_crc = read_le32(data + PWM_OUTPUT_PROTOCOL_HEADER_LEN + body_len);
	uint32_t actual_crc = pwm_output_crc32(data, PWM_OUTPUT_PROTOCOL_HEADER_LEN + body_len);
	if (actual_crc != expected_crc) {
		return PWM_OUTPUT_PROTOCOL_BAD_CRC;
	}

	if (payload != NULL) {
		*payload = data + PWM_OUTPUT_PROTOCOL_HEADER_LEN;
	}
	if (payload_len != NULL) {
		*payload_len = body_len;
	}
	if (frame_len != NULL) {
		*frame_len = total_len;
	}
	return PWM_OUTPUT_PROTOCOL_OK;
}

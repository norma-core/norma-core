#include "protocol.h"
#include "wave_engine.h"
#include "pwm_output.pb.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

struct level_event {
	uint32_t channel;
	enum pwm_output_wave_level level;
};

static struct level_event events[64];
static size_t event_count;

void pwm_output_wave_write_level(uint32_t channel, enum pwm_output_wave_level level)
{
	assert(event_count < sizeof(events) / sizeof(events[0]));
	events[event_count++] = (struct level_event){ channel, level };
}

static void write_le32(uint8_t *dst, uint32_t value)
{
	dst[0] = (uint8_t)(value & 0xffu);
	dst[1] = (uint8_t)((value >> 8u) & 0xffu);
	dst[2] = (uint8_t)((value >> 16u) & 0xffu);
	dst[3] = (uint8_t)((value >> 24u) & 0xffu);
}

static size_t encode_tx_payload(uint8_t *dst, size_t dst_len, uint32_t channel, uint32_t repeat)
{
	static const uint8_t command_id_bytes[] = { 1, 2, 3, 4 };
	static const uint8_t output_id_bytes[] = { 's', 't', 'e', 'e', 'r', 'i', 'n', 'g' };

	pwm_output_WaveSegment high = {
		.level = pwm_output_WaveLevel_WAVE_LEVEL_HIGH,
		.duration_us = 2,
	};
	pwm_output_WaveSegment low = {
		.level = pwm_output_WaveLevel_WAVE_LEVEL_LOW,
		.duration_us = 3,
	};
	const pwm_output_WaveSegment *segments[] = { &high, &low };
	pwm_output_WaveCommand wave = {
		.channel = channel,
		.segments = segments,
		.segments_count = sizeof(segments) / sizeof(segments[0]),
		.repeat = repeat,
	};
	pwm_output_Command command = {
		.target_output_id = { output_id_bytes, sizeof(output_id_bytes) },
		.wave = &wave,
	};
	pwm_output_TxEnvelope envelope = {
		.monotonic_stamp_ns = 10,
		.local_stamp_ns = 20,
		.app_start_id = 30,
		.command_id = { command_id_bytes, sizeof(command_id_bytes) },
		.target_output_id = { output_id_bytes, sizeof(output_id_bytes) },
		.command = &command,
	};

	size_t size = pwm_output_TxEnvelope_size(&envelope);
	assert(size <= dst_len);
	struct gremlin_writer writer;
	gremlin_writer_init(&writer, dst, dst_len);
	pwm_output_TxEnvelope_encode(&envelope, &writer);
	assert(writer.offset == size);
	return writer.offset;
}

static size_t encode_disable_payload(uint8_t *dst, size_t dst_len, uint32_t channel)
{
	pwm_output_DisableCommand disable = {
		.channel = channel,
	};
	pwm_output_Command command = {
		.disable = &disable,
	};
	pwm_output_TxEnvelope envelope = {
		.monotonic_stamp_ns = 10,
		.command = &command,
	};

	size_t size = pwm_output_TxEnvelope_size(&envelope);
	assert(size <= dst_len);
	struct gremlin_writer writer;
	gremlin_writer_init(&writer, dst, dst_len);
	pwm_output_TxEnvelope_encode(&envelope, &writer);
	assert(writer.offset == size);
	return writer.offset;
}

static size_t encode_frame(uint8_t *dst, size_t dst_len, const uint8_t *payload, size_t payload_len)
{
	assert(payload_len <= 0xffffffffu);
	size_t frame_len = PWM_OUTPUT_PROTOCOL_HEADER_LEN + payload_len + PWM_OUTPUT_PROTOCOL_CRC_LEN;
	assert(frame_len <= dst_len);

	dst[0] = 'N';
	dst[1] = 'C';
	dst[2] = 'W';
	dst[3] = 'V';
	dst[4] = 1;
	write_le32(dst + 5, (uint32_t)payload_len);
	memcpy(dst + PWM_OUTPUT_PROTOCOL_HEADER_LEN, payload, payload_len);
	uint32_t crc = pwm_output_crc32(dst, PWM_OUTPUT_PROTOCOL_HEADER_LEN + payload_len);
	write_le32(dst + PWM_OUTPUT_PROTOCOL_HEADER_LEN + payload_len, crc);
	return frame_len;
}

static void test_protocol_decode_and_wave_execution(void)
{
	uint8_t payload[256];
	uint8_t frame[320];
	size_t payload_len = encode_tx_payload(payload, sizeof(payload), 7, 2);
	size_t written_frame_len = encode_frame(frame, sizeof(frame), payload, payload_len);

	const uint8_t *decoded_payload = NULL;
	size_t decoded_payload_len = 0;
	size_t decoded_frame_len = 0;
	enum pwm_output_protocol_status frame_status = pwm_output_protocol_decode_frame(
		frame,
		written_frame_len,
		&decoded_payload,
		&decoded_payload_len,
		&decoded_frame_len);
	assert(frame_status == PWM_OUTPUT_PROTOCOL_OK);
	assert(decoded_payload == frame + PWM_OUTPUT_PROTOCOL_HEADER_LEN);
	assert(decoded_payload_len == payload_len);
	assert(decoded_frame_len == written_frame_len);

	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	event_count = 0;
	enum pwm_output_wave_status wave_status =
		pwm_output_wave_engine_apply_tx_payload(&engine, decoded_payload, decoded_payload_len);
	assert(wave_status == PWM_OUTPUT_WAVE_OK);

	assert(event_count == 1);
	assert(events[0].channel == 7);
	assert(events[0].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);

	pwm_output_wave_engine_tick(&engine, 2);
	assert(event_count == 2);
	assert(events[1].channel == 7);
	assert(events[1].level == PWM_OUTPUT_WAVE_LEVEL_LOW);

	pwm_output_wave_engine_tick(&engine, 3);
	assert(event_count == 3);
	assert(events[2].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);

	pwm_output_wave_engine_tick(&engine, 5);
	assert(event_count == 5);
	assert(events[3].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
	assert(events[4].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
	assert(!engine.channels[7].active);
}

static void test_last_write_wins(void)
{
	uint8_t payload_a[256];
	uint8_t payload_b[256];
	size_t payload_a_len = encode_tx_payload(payload_a, sizeof(payload_a), 7, 20);
	size_t payload_b_len = encode_tx_payload(payload_b, sizeof(payload_b), 7, 1);

	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	event_count = 0;

	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload_a, payload_a_len) == PWM_OUTPUT_WAVE_OK);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload_b, payload_b_len) == PWM_OUTPUT_WAVE_OK);
	assert(event_count == 2);
	assert(events[0].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);
	assert(events[1].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);

	pwm_output_wave_engine_tick(&engine, 5);
	assert(event_count == 4);
	assert(!engine.channels[7].active);
}

static void test_disable_command(void)
{
	uint8_t wave_payload[256];
	uint8_t disable_payload[128];
	size_t wave_payload_len = encode_tx_payload(wave_payload, sizeof(wave_payload), 7, 20);
	size_t disable_payload_len = encode_disable_payload(disable_payload, sizeof(disable_payload), 7);

	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	event_count = 0;

	assert(pwm_output_wave_engine_apply_tx_payload(&engine, wave_payload, wave_payload_len) == PWM_OUTPUT_WAVE_OK);
	assert(engine.channels[7].active);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, disable_payload, disable_payload_len) == PWM_OUTPUT_WAVE_OK);
	assert(!engine.channels[7].active);
	assert(events[event_count - 1].channel == 7);
	assert(events[event_count - 1].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
}

static void test_bad_crc(void)
{
	uint8_t payload[256];
	uint8_t frame[320];
	size_t payload_len = encode_tx_payload(payload, sizeof(payload), 7, 1);
	size_t frame_len = encode_frame(frame, sizeof(frame), payload, payload_len);
	frame[frame_len - 1] ^= 0xffu;

	assert(pwm_output_protocol_decode_frame(frame, frame_len, NULL, NULL, NULL)
	       == PWM_OUTPUT_PROTOCOL_BAD_CRC);
}

int main(void)
{
	test_protocol_decode_and_wave_execution();
	test_last_write_wins();
	test_disable_command();
	test_bad_crc();
	printf("pwm-output firmware tests passed\n");
	return 0;
}

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

static size_t encode_tx_wave(uint8_t *dst, size_t dst_len, uint32_t channel,
	uint32_t repeat, pwm_output_WaveRepeatMode repeat_mode, uint32_t high_us, uint32_t low_us)
{
	static const uint8_t command_id_bytes[] = { 1, 2, 3, 4 };
	static const uint8_t output_id_bytes[] = { 's', 't', 'e', 'e', 'r', 'i', 'n', 'g' };

	pwm_output_WaveSegment high = {
		.level = pwm_output_WaveLevel_WAVE_LEVEL_HIGH,
		.duration_us = high_us,
	};
	pwm_output_WaveSegment low = {
		.level = pwm_output_WaveLevel_WAVE_LEVEL_LOW,
		.duration_us = low_us,
	};
	const pwm_output_WaveSegment *segments[] = { &high, &low };
	pwm_output_WaveCommand wave = {
		.channel = channel,
		.segments = segments,
		.segments_count = sizeof(segments) / sizeof(segments[0]),
		.repeat = repeat,
		.repeat_mode = repeat_mode,
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

static size_t encode_tx_mode(uint8_t *dst, size_t dst_len, uint32_t channel,
	uint32_t repeat, pwm_output_WaveRepeatMode repeat_mode)
{
	return encode_tx_wave(dst, dst_len, channel, repeat, repeat_mode, 2, 3);
}

static size_t encode_tx_payload(uint8_t *dst, size_t dst_len, uint32_t channel, uint32_t repeat)
{
	return encode_tx_mode(dst, dst_len, channel, repeat, pwm_output_WaveRepeatMode_WAVE_REPEAT_MODE_FINITE);
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
	size_t payload_b_len = encode_tx_wave(payload_b, sizeof(payload_b), 7, 1,
		pwm_output_WaveRepeatMode_WAVE_REPEAT_MODE_FINITE, 3, 2);

	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	event_count = 0;

	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload_a, payload_a_len) == PWM_OUTPUT_WAVE_OK);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload_b, payload_b_len) == PWM_OUTPUT_WAVE_OK);
	assert(event_count == 2);
	assert(events[0].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);
	assert(events[1].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);

	pwm_output_wave_engine_tick(&engine, 2);
	assert(event_count == 2); /* Replacement high lasts 3 us, not the old 2 us. */
	pwm_output_wave_engine_tick(&engine, 1);
	assert(event_count == 3 && events[2].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
	pwm_output_wave_engine_tick(&engine, 2);
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

/* A hold must keep producing both edges without another host command, and
 * disabling one channel must not disturb another channel's hold. */
static void test_hold_until_disabled(void)
{
	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	uint8_t payload[256];
	event_count = 0;
	for (uint32_t channel = 7; channel <= 8; channel++) {
		size_t len = encode_tx_mode(payload, sizeof(payload), channel, 0, pwm_output_WaveRepeatMode_WAVE_REPEAT_MODE_FOREVER);
		assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	}
	for (unsigned cycle = 0; cycle < 10000; cycle++) {
		event_count = 0;
		pwm_output_wave_engine_tick(&engine, 2);
		assert(event_count == 2);
		assert(events[0].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
		assert(events[1].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
		pwm_output_wave_engine_tick(&engine, 3);
		assert(event_count == 4);
		assert(events[2].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);
		assert(events[3].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);
	}
	size_t len = encode_disable_payload(payload, sizeof(payload), 7);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	assert(events[event_count - 1].channel == 7);
	assert(events[event_count - 1].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
	event_count = 0;
	pwm_output_wave_engine_tick(&engine, 5);
	assert(event_count == 2);
	assert(events[0].channel == 8 && events[1].channel == 8);
	assert(!engine.channels[7].active && engine.channels[8].active);
}

static void test_hold_replaced_by_finite_wave(void)
{
	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	uint8_t payload[256];
	event_count = 0;
	size_t len = encode_tx_mode(payload, sizeof(payload), 7, 0, pwm_output_WaveRepeatMode_WAVE_REPEAT_MODE_FOREVER);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	pwm_output_wave_engine_tick(&engine, 1);
	len = encode_tx_payload(payload, sizeof(payload), 7, 1);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	event_count = 0;
	pwm_output_wave_engine_tick(&engine, 1);
	assert(event_count == 1); /* Mode change preserves the existing pulse. */
	pwm_output_wave_engine_tick(&engine, 3);
	assert(event_count == 2);
	assert(events[0].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
	assert(!engine.channels[7].active);
	event_count = 0;
	pwm_output_wave_engine_tick(&engine, 1000);
	assert(event_count == 0);
}

static void test_invalid_repeat_keeps_previous_wave(void)
{
	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	uint8_t payload[256];
	event_count = 0;
	size_t len = encode_tx_payload(payload, sizeof(payload), 7, 1);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	len = encode_tx_mode(payload, sizeof(payload), 7, 1, pwm_output_WaveRepeatMode_WAVE_REPEAT_MODE_FOREVER);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_ERROR_BAD_REPEAT);
	len = encode_tx_payload(payload, sizeof(payload), 7, 0);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_ERROR_BAD_REPEAT);
	len = encode_tx_mode(payload, sizeof(payload), 7, 1, (pwm_output_WaveRepeatMode)99);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_ERROR_BAD_REPEAT);
	pwm_output_wave_engine_tick(&engine, 5);
	assert(!engine.channels[7].active);
}

static void test_refresh_does_not_stretch_high_pulse(void)
{
	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	uint8_t payload[256];
	size_t len = encode_tx_payload(payload, sizeof(payload), 7, 2);
	event_count = 0;
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	pwm_output_wave_engine_tick(&engine, 1);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	assert(event_count == 1); /* Refresh must not drive another edge. */
	pwm_output_wave_engine_tick(&engine, 1);
	assert(event_count == 2 && events[1].level == PWM_OUTPUT_WAVE_LEVEL_LOW);
	pwm_output_wave_engine_tick(&engine, 1);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	assert(event_count == 2); /* Refresh during low must not start a short period. */
	pwm_output_wave_engine_tick(&engine, 2);
	assert(event_count == 3 && events[2].level == PWM_OUTPUT_WAVE_LEVEL_HIGH);
	pwm_output_wave_engine_tick(&engine, 5);
	assert(!engine.channels[7].active); /* Finite mode still expires after refresh. */
}

/* Reproduce the browser's 50 ms refresh of a 125-cycle, 20 ms servo wave.
 * Offset refreshes into both the high pulse and low gap, then stop sending. */
static void test_web_refresh_and_expiry(void)
{
	struct pwm_output_wave_engine engine;
	pwm_output_wave_engine_init(&engine);
	uint8_t payload[256];
	size_t len = encode_tx_wave(payload, sizeof(payload), 7, 125,
		pwm_output_WaveRepeatMode_WAVE_REPEAT_MODE_FINITE, 1500, 18500);
	event_count = 0;
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	for (unsigned time_us = 100; time_us <= 10000000; time_us += 100) {
		event_count = 0;
		pwm_output_wave_engine_tick(&engine, 100);
		unsigned phase = time_us % 20000;
		assert(event_count == ((phase == 0 || phase == 1500) ? 1 : 0));
		if (event_count) {
			assert(events[0].level == (phase == 0 ? PWM_OUTPUT_WAVE_LEVEL_HIGH : PWM_OUTPUT_WAVE_LEVEL_LOW));
		}
		if (time_us % 50000 == 500) {
			size_t before = event_count;
			assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
			assert(event_count == before);
		}
	}
	for (unsigned step = 0; step < 25000; step++) {
		event_count = 0;
		pwm_output_wave_engine_tick(&engine, 100);
	}
	assert(!engine.channels[7].active);
	assert(pwm_output_wave_engine_next_edge_us(&engine) == 0);
	event_count = 0;
	pwm_output_wave_engine_tick(&engine, 10000000);
	assert(event_count == 0);
}

static void test_prepare_and_edge_deadlines(void)
{
	struct pwm_output_wave_engine engine;
	struct pwm_output_wave_update update;
	pwm_output_wave_engine_init(&engine);
	assert(pwm_output_wave_engine_next_edge_us(&engine) == 0);
	uint8_t payload[256];
	event_count = 0;
	size_t len = encode_tx_payload(payload, sizeof(payload), 7, 2);
	assert(pwm_output_wave_prepare_tx_payload(&update, payload, len) == PWM_OUTPUT_WAVE_OK);
	assert(event_count == 0 && !engine.channels[7].active);
	memset(payload, 0, sizeof(payload)); /* Prepared state owns its data. */
	pwm_output_wave_engine_commit(&engine, &update);
	assert(event_count == 1 && pwm_output_wave_engine_next_edge_us(&engine) == 2);
	pwm_output_wave_engine_tick(&engine, 1);
	len = encode_tx_payload(payload, sizeof(payload), 8, 1);
	assert(pwm_output_wave_engine_apply_tx_payload(&engine, payload, len) == PWM_OUTPUT_WAVE_OK);
	assert(pwm_output_wave_engine_next_edge_us(&engine) == 1);
	pwm_output_wave_engine_tick(&engine, 1);
	assert(pwm_output_wave_engine_next_edge_us(&engine) == 1);
	pwm_output_wave_engine_tick(&engine, 1);
	assert(pwm_output_wave_engine_next_edge_us(&engine) == 2);
	len = encode_disable_payload(payload, sizeof(payload), 7);
	assert(pwm_output_wave_prepare_tx_payload(&update, payload, len) == PWM_OUTPUT_WAVE_OK);
	assert(engine.channels[7].active);
	pwm_output_wave_engine_commit(&engine, &update);
	assert(!engine.channels[7].active);
	assert(pwm_output_wave_engine_next_edge_us(&engine) == 3);
	pwm_output_wave_engine_tick(&engine, 3);
	assert(pwm_output_wave_engine_next_edge_us(&engine) == 0);
}

int main(void)
{
	test_refresh_does_not_stretch_high_pulse();
	test_web_refresh_and_expiry();
	test_prepare_and_edge_deadlines();
	test_protocol_decode_and_wave_execution();
	test_last_write_wins();
	test_disable_command();
	test_bad_crc();
	test_hold_until_disabled();
	test_hold_replaced_by_finite_wave();
	test_invalid_repeat_keeps_previous_wave();
	printf("pwm-output firmware tests passed\n");
	return 0;
}

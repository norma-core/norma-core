#include "wave_engine.h"

#include "pwm_output.pb.h"

#include <string.h>

#if defined(__GNUC__) || defined(__clang__)
__attribute__((weak))
#endif
void pwm_output_wave_write_level(uint32_t channel, enum pwm_output_wave_level level)
{
	(void)channel;
	(void)level;
}

void pwm_output_wave_engine_init(struct pwm_output_wave_engine *engine)
{
	if (engine == NULL) {
		return;
	}
	memset(engine, 0, sizeof(*engine));
}

static void disable_channel(struct pwm_output_wave_engine *engine, uint32_t channel)
{
	if (engine == NULL || channel >= PWM_OUTPUT_WAVE_MAX_CHANNELS) {
		return;
	}
	struct pwm_output_wave_channel_state *state = &engine->channels[channel];
	memset(state, 0, sizeof(*state));
	pwm_output_wave_write_level(channel, PWM_OUTPUT_WAVE_LEVEL_LOW);
}

static bool level_from_proto(pwm_output_WaveLevel src, enum pwm_output_wave_level *dst)
{
	if (dst == NULL) {
		return false;
	}
	if (src == pwm_output_WaveLevel_WAVE_LEVEL_LOW) {
		*dst = PWM_OUTPUT_WAVE_LEVEL_LOW;
		return true;
	}
	if (src == pwm_output_WaveLevel_WAVE_LEVEL_HIGH) {
		*dst = PWM_OUTPUT_WAVE_LEVEL_HIGH;
		return true;
	}
	return false;
}

static enum pwm_output_wave_status apply_wave(
	struct pwm_output_wave_engine *engine,
	const pwm_output_WaveCommand_reader *wave)
{
	if (engine == NULL || wave == NULL) {
		return PWM_OUTPUT_WAVE_ERROR_PROTO;
	}

	uint32_t channel = pwm_output_WaveCommand_reader_get_channel(wave);
	if (channel >= PWM_OUTPUT_WAVE_MAX_CHANNELS) {
		return PWM_OUTPUT_WAVE_ERROR_BAD_CHANNEL;
	}

	size_t count = pwm_output_WaveCommand_reader_segments_count(wave);
	if (count == 0) {
		return PWM_OUTPUT_WAVE_ERROR_EMPTY_WAVE;
	}
	if (count > PWM_OUTPUT_WAVE_MAX_SEGMENTS) {
		return PWM_OUTPUT_WAVE_ERROR_TOO_MANY_SEGMENTS;
	}

	uint32_t repeat = pwm_output_WaveCommand_reader_get_repeat(wave);
	if (repeat == 0) {
		return PWM_OUTPUT_WAVE_ERROR_BAD_REPEAT;
	}

	struct pwm_output_wave_channel_state next;
	memset(&next, 0, sizeof(next));
	next.active = true;
	next.segment_count = count;
	next.repeat_remaining = repeat;

	pwm_output_WaveCommand_reader_segments_iter it =
		pwm_output_WaveCommand_reader_segments_begin(wave);
	for (size_t i = 0; i < count; i++) {
		pwm_output_WaveSegment_reader segment;
		if (pwm_output_WaveCommand_reader_segments_next(&it, &segment) != GREMLIN_OK) {
			return PWM_OUTPUT_WAVE_ERROR_PROTO;
		}

		if (!level_from_proto(
			    pwm_output_WaveSegment_reader_get_level(&segment),
			    &next.segments[i].level)) {
			return PWM_OUTPUT_WAVE_ERROR_BAD_SEGMENT;
		}

		uint32_t duration_us = pwm_output_WaveSegment_reader_get_duration_us(&segment);
		if (duration_us == 0) {
			return PWM_OUTPUT_WAVE_ERROR_BAD_SEGMENT;
		}
		next.segments[i].duration_us = duration_us;
	}

	next.segment_index = 0;
	next.remaining_us = next.segments[0].duration_us;
	engine->channels[channel] = next;
	pwm_output_wave_write_level(channel, next.segments[0].level);
	return PWM_OUTPUT_WAVE_OK;
}

static void advance_channel(
	struct pwm_output_wave_channel_state *state,
	uint32_t channel)
{
	if (state->segment_index + 1u < state->segment_count) {
		state->segment_index++;
		state->remaining_us = state->segments[state->segment_index].duration_us;
		pwm_output_wave_write_level(channel, state->segments[state->segment_index].level);
		return;
	}

	if (state->repeat_remaining > 1u) {
		state->repeat_remaining--;
		state->segment_index = 0;
		state->remaining_us = state->segments[0].duration_us;
		pwm_output_wave_write_level(channel, state->segments[0].level);
		return;
	}

	memset(state, 0, sizeof(*state));
	pwm_output_wave_write_level(channel, PWM_OUTPUT_WAVE_LEVEL_LOW);
}

void pwm_output_wave_engine_tick(struct pwm_output_wave_engine *engine, uint32_t elapsed_us)
{
	if (engine == NULL || elapsed_us == 0) {
		return;
	}

	for (uint32_t channel = 0; channel < PWM_OUTPUT_WAVE_MAX_CHANNELS; channel++) {
		struct pwm_output_wave_channel_state *state = &engine->channels[channel];
		if (!state->active) {
			continue;
		}

		uint32_t remaining_elapsed = elapsed_us;
		while (state->active && remaining_elapsed >= state->remaining_us) {
			if (state->remaining_us == 0) {
				disable_channel(engine, channel);
				break;
			}
			remaining_elapsed -= state->remaining_us;
			advance_channel(state, channel);
		}

		if (state->active) {
			state->remaining_us -= remaining_elapsed;
		}
	}
}

enum pwm_output_wave_status pwm_output_wave_engine_apply_tx_payload(
	struct pwm_output_wave_engine *engine,
	const uint8_t *payload,
	size_t payload_len)
{
	if (engine == NULL || (payload == NULL && payload_len > 0)) {
		return PWM_OUTPUT_WAVE_ERROR_PROTO;
	}

	pwm_output_TxEnvelope_reader envelope;
	if (pwm_output_TxEnvelope_reader_init(&envelope, payload, payload_len) != GREMLIN_OK) {
		return PWM_OUTPUT_WAVE_ERROR_PROTO;
	}
	if (!envelope._has.command) {
		return PWM_OUTPUT_WAVE_ERROR_MISSING_COMMAND;
	}

	pwm_output_Command_reader command;
	if (pwm_output_TxEnvelope_reader_get_command(&envelope, &command) != GREMLIN_OK) {
		return PWM_OUTPUT_WAVE_ERROR_PROTO;
	}

	bool has_wave = command._has.wave != 0;
	bool has_disable = command._has.disable != 0;
	if (has_wave == has_disable) {
		return PWM_OUTPUT_WAVE_ERROR_BAD_VARIANT;
	}

	if (has_disable) {
		pwm_output_DisableCommand_reader disable;
		if (pwm_output_Command_reader_get_disable(&command, &disable) != GREMLIN_OK) {
			return PWM_OUTPUT_WAVE_ERROR_PROTO;
		}
		uint32_t channel = pwm_output_DisableCommand_reader_get_channel(&disable);
		if (channel >= PWM_OUTPUT_WAVE_MAX_CHANNELS) {
			return PWM_OUTPUT_WAVE_ERROR_BAD_CHANNEL;
		}
		disable_channel(engine, channel);
		return PWM_OUTPUT_WAVE_OK;
	}

	pwm_output_WaveCommand_reader wave;
	if (pwm_output_Command_reader_get_wave(&command, &wave) != GREMLIN_OK) {
		return PWM_OUTPUT_WAVE_ERROR_PROTO;
	}
	return apply_wave(engine, &wave);
}

const char *pwm_output_wave_status_name(enum pwm_output_wave_status status)
{
	switch (status) {
	case PWM_OUTPUT_WAVE_OK:
		return "ok";
	case PWM_OUTPUT_WAVE_ERROR_PROTO:
		return "proto";
	case PWM_OUTPUT_WAVE_ERROR_MISSING_COMMAND:
		return "missing-command";
	case PWM_OUTPUT_WAVE_ERROR_BAD_VARIANT:
		return "bad-variant";
	case PWM_OUTPUT_WAVE_ERROR_BAD_CHANNEL:
		return "bad-channel";
	case PWM_OUTPUT_WAVE_ERROR_EMPTY_WAVE:
		return "empty-wave";
	case PWM_OUTPUT_WAVE_ERROR_TOO_MANY_SEGMENTS:
		return "too-many-segments";
	case PWM_OUTPUT_WAVE_ERROR_BAD_REPEAT:
		return "bad-repeat";
	case PWM_OUTPUT_WAVE_ERROR_BAD_SEGMENT:
		return "bad-segment";
	default:
		return "unknown";
	}
}

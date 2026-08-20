#ifndef NORMA_PWM_OUTPUT_WAVE_ENGINE_H
#define NORMA_PWM_OUTPUT_WAVE_ENGINE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#ifndef PWM_OUTPUT_WAVE_MAX_CHANNELS
#define PWM_OUTPUT_WAVE_MAX_CHANNELS 16u
#endif

#ifndef PWM_OUTPUT_WAVE_MAX_SEGMENTS
#define PWM_OUTPUT_WAVE_MAX_SEGMENTS 16u
#endif

enum pwm_output_wave_level {
	PWM_OUTPUT_WAVE_LEVEL_LOW = 0,
	PWM_OUTPUT_WAVE_LEVEL_HIGH = 1,
};

enum pwm_output_wave_status {
	PWM_OUTPUT_WAVE_OK = 0,
	PWM_OUTPUT_WAVE_ERROR_PROTO,
	PWM_OUTPUT_WAVE_ERROR_MISSING_COMMAND,
	PWM_OUTPUT_WAVE_ERROR_BAD_VARIANT,
	PWM_OUTPUT_WAVE_ERROR_BAD_CHANNEL,
	PWM_OUTPUT_WAVE_ERROR_EMPTY_WAVE,
	PWM_OUTPUT_WAVE_ERROR_TOO_MANY_SEGMENTS,
	PWM_OUTPUT_WAVE_ERROR_BAD_REPEAT,
	PWM_OUTPUT_WAVE_ERROR_BAD_SEGMENT,
};

struct pwm_output_wave_segment_state {
	enum pwm_output_wave_level level;
	uint32_t duration_us;
};

struct pwm_output_wave_channel_state {
	bool active;
	size_t segment_index;
	size_t segment_count;
	uint32_t repeat_remaining;
	uint32_t remaining_us;
	struct pwm_output_wave_segment_state segments[PWM_OUTPUT_WAVE_MAX_SEGMENTS];
};

struct pwm_output_wave_engine {
	struct pwm_output_wave_channel_state channels[PWM_OUTPUT_WAVE_MAX_CHANNELS];
};

void pwm_output_wave_engine_init(struct pwm_output_wave_engine *engine);
void pwm_output_wave_engine_tick(struct pwm_output_wave_engine *engine, uint32_t elapsed_us);

enum pwm_output_wave_status pwm_output_wave_engine_apply_tx_payload(
	struct pwm_output_wave_engine *engine,
	const uint8_t *payload,
	size_t payload_len);

const char *pwm_output_wave_status_name(enum pwm_output_wave_status status);

void pwm_output_wave_write_level(uint32_t channel, enum pwm_output_wave_level level);

#ifdef __cplusplus
}
#endif

#endif

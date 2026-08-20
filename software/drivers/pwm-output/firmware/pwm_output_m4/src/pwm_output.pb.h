#ifndef _PWM_OUTPUT_PROTO_PB_H_
#define _PWM_OUTPUT_PROTO_PB_H_

#include <stdbool.h>
#include "gremlin.h"

typedef enum pwm_output_PwmOutputSignalType {
	pwm_output_PwmOutputSignalType_PWM_OUTPUT_SIGNAL_TYPE_UNSPECIFIED = 0,
	pwm_output_PwmOutputSignalType_PWM_OUTPUT_CONFIGURED = 1,
	pwm_output_PwmOutputSignalType_PWM_OUTPUT_COMMAND = 2,
	pwm_output_PwmOutputSignalType_PWM_OUTPUT_COMMAND_SUCCESS = 3,
	pwm_output_PwmOutputSignalType_PWM_OUTPUT_COMMAND_REJECTED = 4,
	pwm_output_PwmOutputSignalType_PWM_OUTPUT_COMMAND_FAILED = 5,
	pwm_output_PwmOutputSignalType_PWM_OUTPUT_ERROR = 6,
} pwm_output_PwmOutputSignalType;

typedef enum pwm_output_WaveLevel {
	pwm_output_WaveLevel_WAVE_LEVEL_UNSPECIFIED = 0,
	pwm_output_WaveLevel_WAVE_LEVEL_LOW = 1,
	pwm_output_WaveLevel_WAVE_LEVEL_HIGH = 2,
} pwm_output_WaveLevel;

typedef struct pwm_output_PwmOutputDevice {
	struct gremlin_bytes	id;
	size_t	_size;
} pwm_output_PwmOutputDevice;

static inline size_t
pwm_output_PwmOutputDevice_cached_size(const pwm_output_PwmOutputDevice *m)
{
	return m->_size;
}

__attribute__((noinline, unused)) static size_t
pwm_output_PwmOutputDevice_size(const pwm_output_PwmOutputDevice *m)
{
	size_t s = 0;
	if (m->id.len > 0) {
		s += 1
		   + gremlin_varint_size(m->id.len)
		   + m->id.len;
	}
	((pwm_output_PwmOutputDevice *)m)->_size = s;
	return s;
}

__attribute__((unused)) static size_t
pwm_output_PwmOutputDevice_encode_at(const pwm_output_PwmOutputDevice *m, uint8_t * __restrict__ _buf, size_t _off)
{
	if (m->id.len > 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 10u);
		_off = gremlin_varint_encode_at(_buf, _off, m->id.len);
		_off = gremlin_write_bytes_at(_buf, _off, m->id.data, m->id.len);
	}
	return _off;
}

__attribute__((unused)) static void
pwm_output_PwmOutputDevice_encode(const pwm_output_PwmOutputDevice *m, struct gremlin_writer *w)
{
	w->offset = pwm_output_PwmOutputDevice_encode_at(m, w->buf, w->offset);
}

typedef struct pwm_output_PwmOutputDevice_reader {
	const uint8_t	*src;
	size_t		 src_len;
	struct {
		unsigned	id : 1;
	} _has;
	struct gremlin_bytes	id;
} pwm_output_PwmOutputDevice_reader;

static inline enum gremlin_error
pwm_output_PwmOutputDevice_reader_init(pwm_output_PwmOutputDevice_reader *r, const uint8_t *src, size_t len)
{
	*r = (pwm_output_PwmOutputDevice_reader){ .src = src, .src_len = len };
	size_t offset = 0;
	while (offset < len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(src + offset, len - offset);
		if (t.error != GREMLIN_OK) return t.error;
		offset += t.consumed;
		if (t.value == 10u /* field 1, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->id = d.bytes;
			r->_has.id = 1;
			continue;
		}
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		uint32_t _fn = t.value / 8u;
		if (_fn == 0u || _fn > GREMLIN_MAX_FIELD_NUM)
			return GREMLIN_ERROR_INVALID_FIELD_NUM;
		struct gremlin_skip_result sk =
			gremlin_skip_data(src + offset, len - offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline struct gremlin_bytes
pwm_output_PwmOutputDevice_reader_get_id(const pwm_output_PwmOutputDevice_reader *r)
{
	if (r == NULL || !r->_has.id) return (struct gremlin_bytes){ NULL, 0 };
	return r->id;
}

typedef struct pwm_output_WaveSegment {
	pwm_output_WaveLevel	level;
	uint32_t	duration_us;
	size_t	_size;
} pwm_output_WaveSegment;

static inline size_t
pwm_output_WaveSegment_cached_size(const pwm_output_WaveSegment *m)
{
	return m->_size;
}

__attribute__((noinline, unused)) static size_t
pwm_output_WaveSegment_size(const pwm_output_WaveSegment *m)
{
	size_t s = 0;
	if (m->level != 0) {
		s += 1
		   + gremlin_varint_size((uint64_t)(int64_t)m->level);
	}
	if (m->duration_us != 0) {
		s += 1 + gremlin_varint32_size(m->duration_us);
	}
	((pwm_output_WaveSegment *)m)->_size = s;
	return s;
}

__attribute__((unused)) static size_t
pwm_output_WaveSegment_encode_at(const pwm_output_WaveSegment *m, uint8_t * __restrict__ _buf, size_t _off)
{
	if (m->level != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 8u);
		_off = gremlin_varint_encode_at(_buf, _off, (uint64_t)(int64_t)m->level);
	}
	if (m->duration_us != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 16u);
		_off = gremlin_varint32_encode_at(_buf, _off, m->duration_us);
	}
	return _off;
}

__attribute__((unused)) static void
pwm_output_WaveSegment_encode(const pwm_output_WaveSegment *m, struct gremlin_writer *w)
{
	w->offset = pwm_output_WaveSegment_encode_at(m, w->buf, w->offset);
}

typedef struct pwm_output_WaveSegment_reader {
	const uint8_t	*src;
	size_t		 src_len;
	struct {
		unsigned	level : 1;
		unsigned	duration_us : 1;
	} _has;
	pwm_output_WaveLevel	level;
	uint32_t	duration_us;
} pwm_output_WaveSegment_reader;

static inline enum gremlin_error
pwm_output_WaveSegment_reader_init(pwm_output_WaveSegment_reader *r, const uint8_t *src, size_t len)
{
	*r = (pwm_output_WaveSegment_reader){ .src = src, .src_len = len };
	size_t offset = 0;
	while (offset < len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(src + offset, len - offset);
		if (t.error != GREMLIN_OK) return t.error;
		offset += t.consumed;
		if (t.value == 8u /* field 1, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint_decode_result d =
				gremlin_varint_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->level = (pwm_output_WaveLevel)(int32_t)(uint32_t)d.value;
			r->_has.level = 1;
			continue;
		}
		if (t.value == 16u /* field 2, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint32_decode_result d =
				gremlin_varint32_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->duration_us = d.value;
			r->_has.duration_us = true;
			continue;
		}
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		uint32_t _fn = t.value / 8u;
		if (_fn == 0u || _fn > GREMLIN_MAX_FIELD_NUM)
			return GREMLIN_ERROR_INVALID_FIELD_NUM;
		struct gremlin_skip_result sk =
			gremlin_skip_data(src + offset, len - offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline pwm_output_WaveLevel
pwm_output_WaveSegment_reader_get_level(const pwm_output_WaveSegment_reader *r)
{
	if (r == NULL || !r->_has.level) return 0;
	return r->level;
}

static inline uint32_t
pwm_output_WaveSegment_reader_get_duration_us(const pwm_output_WaveSegment_reader *r)
{
	if (r == NULL || !r->_has.duration_us) return 0;
	return r->duration_us;
}

typedef struct pwm_output_WaveCommand {
	uint32_t	channel;
	const pwm_output_WaveSegment * const	*segments;
	size_t	segments_count;
	uint32_t	repeat;
	size_t	_size;
} pwm_output_WaveCommand;

static inline size_t
pwm_output_WaveCommand_cached_size(const pwm_output_WaveCommand *m)
{
	return m->_size;
}

__attribute__((noinline, unused)) static size_t
pwm_output_WaveCommand_size(const pwm_output_WaveCommand *m)
{
	size_t s = 0;
	if (m->channel != 0) {
		s += 1 + gremlin_varint32_size(m->channel);
	}
	for (size_t _i = 0; _i < m->segments_count; _i++) {
		const pwm_output_WaveSegment *_el = m->segments[_i];
		if (_el != NULL) {
			size_t _child_size = pwm_output_WaveSegment_size(_el);
			s += 1
			   + gremlin_varint_size(_child_size)
			   + _child_size;
		} else {
			s += 1 + 1;
		}
	}
	if (m->repeat != 0) {
		s += 1 + gremlin_varint32_size(m->repeat);
	}
	((pwm_output_WaveCommand *)m)->_size = s;
	return s;
}

__attribute__((unused)) static size_t
pwm_output_WaveCommand_encode_at(const pwm_output_WaveCommand *m, uint8_t * __restrict__ _buf, size_t _off)
{
	if (m->channel != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 8u);
		_off = gremlin_varint32_encode_at(_buf, _off, m->channel);
	}
	for (size_t _i = 0; _i < m->segments_count; _i++) {
		const pwm_output_WaveSegment *_el = m->segments[_i];
		if (_el != NULL) {
			_off = gremlin_varint32_encode_at(_buf, _off, 18u);
			_off = gremlin_varint_encode_at(_buf, _off, pwm_output_WaveSegment_cached_size(_el));
			_off = pwm_output_WaveSegment_encode_at(_el, _buf, _off);
		} else {
			_off = gremlin_varint32_encode_at(_buf, _off, 18u);
			_off = gremlin_varint_encode_at(_buf, _off, 0);
		}
	}
	if (m->repeat != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 24u);
		_off = gremlin_varint32_encode_at(_buf, _off, m->repeat);
	}
	return _off;
}

__attribute__((unused)) static void
pwm_output_WaveCommand_encode(const pwm_output_WaveCommand *m, struct gremlin_writer *w)
{
	w->offset = pwm_output_WaveCommand_encode_at(m, w->buf, w->offset);
}

typedef struct pwm_output_WaveCommand_reader {
	const uint8_t	*src;
	size_t		 src_len;
	struct {
		unsigned	channel : 1;
		unsigned	segments : 1;
		unsigned	repeat : 1;
	} _has;
	uint32_t	channel;
	size_t	segments_count;
	size_t	segments_first_offset;
	uint32_t	repeat;
} pwm_output_WaveCommand_reader;

static inline enum gremlin_error
pwm_output_WaveCommand_reader_init(pwm_output_WaveCommand_reader *r, const uint8_t *src, size_t len)
{
	*r = (pwm_output_WaveCommand_reader){ .src = src, .src_len = len };
	size_t offset = 0;
	while (offset < len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(src + offset, len - offset);
		if (t.error != GREMLIN_OK) return t.error;
		offset += t.consumed;
		if (t.value == 8u /* field 1, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint32_decode_result d =
				gremlin_varint32_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->channel = d.value;
			r->_has.channel = true;
			continue;
		}
		if (t.value == 18u /* field 2, GREMLIN_WIRE_LEN_PREFIX, repeated msg */) {
			if (r->segments_count == 0) {
				r->segments_first_offset = offset;
			}
			r->segments_count++;
			r->_has.segments = 1;
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			continue;
		}
		if (t.value == 24u /* field 3, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint32_decode_result d =
				gremlin_varint32_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->repeat = d.value;
			r->_has.repeat = true;
			continue;
		}
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		uint32_t _fn = t.value / 8u;
		if (_fn == 0u || _fn > GREMLIN_MAX_FIELD_NUM)
			return GREMLIN_ERROR_INVALID_FIELD_NUM;
		struct gremlin_skip_result sk =
			gremlin_skip_data(src + offset, len - offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline uint32_t
pwm_output_WaveCommand_reader_get_channel(const pwm_output_WaveCommand_reader *r)
{
	if (r == NULL || !r->_has.channel) return 0;
	return r->channel;
}

typedef struct pwm_output_WaveCommand_reader_segments_iter {
	const uint8_t	*src;
	size_t		 src_len;
	size_t		 offset;
	size_t		 count_remaining;
} pwm_output_WaveCommand_reader_segments_iter;

static inline size_t
pwm_output_WaveCommand_reader_segments_count(const pwm_output_WaveCommand_reader *r)
{
	if (r == NULL) return 0;
	return r->segments_count;
}

static inline pwm_output_WaveCommand_reader_segments_iter
pwm_output_WaveCommand_reader_segments_begin(const pwm_output_WaveCommand_reader *r)
{
	pwm_output_WaveCommand_reader_segments_iter it = {0};
	if (r == NULL || r->segments_count == 0) return it;
	it.src = r->src;
	it.src_len = r->src_len;
	it.offset = r->segments_first_offset;
	it.count_remaining = r->segments_count;
	return it;
}

static inline enum gremlin_error
pwm_output_WaveCommand_reader_segments_next(pwm_output_WaveCommand_reader_segments_iter *it, pwm_output_WaveSegment_reader *out)
{
	if (it->count_remaining == 0) {
		return pwm_output_WaveSegment_reader_init(out, NULL, 0);
	}
	struct gremlin_bytes_decode_result d =
		gremlin_bytes_decode(it->src + it->offset, it->src_len - it->offset);
	if (d.error != GREMLIN_OK) return d.error;
	it->offset += d.consumed;
	it->count_remaining--;
	enum gremlin_error _ie = pwm_output_WaveSegment_reader_init(out, d.bytes.data, d.bytes.len);
	if (_ie != GREMLIN_OK) return _ie;
	while (it->count_remaining > 0 && it->offset < it->src_len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(it->src + it->offset, it->src_len - it->offset);
		if (t.error != GREMLIN_OK) return t.error;
		it->offset += t.consumed;
		if (t.value == 18u) break;
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		struct gremlin_skip_result sk =
			gremlin_skip_data(it->src + it->offset, it->src_len - it->offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		it->offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline uint32_t
pwm_output_WaveCommand_reader_get_repeat(const pwm_output_WaveCommand_reader *r)
{
	if (r == NULL || !r->_has.repeat) return 0;
	return r->repeat;
}

typedef struct pwm_output_OutputState {
	struct gremlin_bytes	id;
	bool	enabled;
	const pwm_output_WaveCommand *	wave;
	size_t	_size;
} pwm_output_OutputState;

static inline size_t
pwm_output_OutputState_cached_size(const pwm_output_OutputState *m)
{
	return m->_size;
}

__attribute__((noinline, unused)) static size_t
pwm_output_OutputState_size(const pwm_output_OutputState *m)
{
	size_t s = 0;
	if (m->id.len > 0) {
		s += 1
		   + gremlin_varint_size(m->id.len)
		   + m->id.len;
	}
	if (m->enabled != false) {
		s += 1 + 1;
	}
	if (m->wave != NULL) {
		size_t _child_size = pwm_output_WaveCommand_size(m->wave);
		s += 1
		   + gremlin_varint_size(_child_size)
		   + _child_size;
	}
	((pwm_output_OutputState *)m)->_size = s;
	return s;
}

__attribute__((unused)) static size_t
pwm_output_OutputState_encode_at(const pwm_output_OutputState *m, uint8_t * __restrict__ _buf, size_t _off)
{
	if (m->id.len > 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 10u);
		_off = gremlin_varint_encode_at(_buf, _off, m->id.len);
		_off = gremlin_write_bytes_at(_buf, _off, m->id.data, m->id.len);
	}
	if (m->enabled != false) {
		_off = gremlin_varint32_encode_at(_buf, _off, 16u);
		_off = gremlin_varint32_encode_at(_buf, _off, m->enabled ? 1u : 0u);
	}
	if (m->wave != NULL) {
		_off = gremlin_varint32_encode_at(_buf, _off, 82u);
		_off = gremlin_varint_encode_at(_buf, _off, pwm_output_WaveCommand_cached_size(m->wave));
		_off = pwm_output_WaveCommand_encode_at(m->wave, _buf, _off);
	}
	return _off;
}

__attribute__((unused)) static void
pwm_output_OutputState_encode(const pwm_output_OutputState *m, struct gremlin_writer *w)
{
	w->offset = pwm_output_OutputState_encode_at(m, w->buf, w->offset);
}

typedef struct pwm_output_OutputState_reader {
	const uint8_t	*src;
	size_t		 src_len;
	struct {
		unsigned	id : 1;
		unsigned	enabled : 1;
		unsigned	wave : 1;
	} _has;
	struct gremlin_bytes	id;
	bool	enabled;
	struct gremlin_bytes	wave;
} pwm_output_OutputState_reader;

static inline enum gremlin_error
pwm_output_OutputState_reader_init(pwm_output_OutputState_reader *r, const uint8_t *src, size_t len)
{
	*r = (pwm_output_OutputState_reader){ .src = src, .src_len = len };
	size_t offset = 0;
	while (offset < len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(src + offset, len - offset);
		if (t.error != GREMLIN_OK) return t.error;
		offset += t.consumed;
		if (t.value == 10u /* field 1, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->id = d.bytes;
			r->_has.id = 1;
			continue;
		}
		if (t.value == 16u /* field 2, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint32_decode_result d =
				gremlin_varint32_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->enabled = (d.value != 0);
			r->_has.enabled = true;
			continue;
		}
		if (t.value == 82u /* field 10, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->wave = d.bytes;
			r->_has.wave = 1;
			continue;
		}
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		uint32_t _fn = t.value / 8u;
		if (_fn == 0u || _fn > GREMLIN_MAX_FIELD_NUM)
			return GREMLIN_ERROR_INVALID_FIELD_NUM;
		struct gremlin_skip_result sk =
			gremlin_skip_data(src + offset, len - offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline struct gremlin_bytes
pwm_output_OutputState_reader_get_id(const pwm_output_OutputState_reader *r)
{
	if (r == NULL || !r->_has.id) return (struct gremlin_bytes){ NULL, 0 };
	return r->id;
}

static inline bool
pwm_output_OutputState_reader_get_enabled(const pwm_output_OutputState_reader *r)
{
	if (r == NULL || !r->_has.enabled) return false;
	return r->enabled;
}

static inline enum gremlin_error
pwm_output_OutputState_reader_get_wave(const pwm_output_OutputState_reader *r, pwm_output_WaveCommand_reader *out)
{
	if (r == NULL || !r->_has.wave) {
		return pwm_output_WaveCommand_reader_init(out, NULL, 0);
	}
	return pwm_output_WaveCommand_reader_init(out, r->wave.data, r->wave.len);
}

typedef struct pwm_output_DisableCommand {
	uint32_t	channel;
	size_t	_size;
} pwm_output_DisableCommand;

static inline size_t
pwm_output_DisableCommand_cached_size(const pwm_output_DisableCommand *m)
{
	return m->_size;
}

__attribute__((noinline, unused)) static size_t
pwm_output_DisableCommand_size(const pwm_output_DisableCommand *m)
{
	size_t s = 0;
	if (m->channel != 0) {
		s += 1 + gremlin_varint32_size(m->channel);
	}
	((pwm_output_DisableCommand *)m)->_size = s;
	return s;
}

__attribute__((unused)) static size_t
pwm_output_DisableCommand_encode_at(const pwm_output_DisableCommand *m, uint8_t * __restrict__ _buf, size_t _off)
{
	if (m->channel != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 8u);
		_off = gremlin_varint32_encode_at(_buf, _off, m->channel);
	}
	return _off;
}

__attribute__((unused)) static void
pwm_output_DisableCommand_encode(const pwm_output_DisableCommand *m, struct gremlin_writer *w)
{
	w->offset = pwm_output_DisableCommand_encode_at(m, w->buf, w->offset);
}

typedef struct pwm_output_DisableCommand_reader {
	const uint8_t	*src;
	size_t		 src_len;
	struct {
		unsigned	channel : 1;
	} _has;
	uint32_t	channel;
} pwm_output_DisableCommand_reader;

static inline enum gremlin_error
pwm_output_DisableCommand_reader_init(pwm_output_DisableCommand_reader *r, const uint8_t *src, size_t len)
{
	*r = (pwm_output_DisableCommand_reader){ .src = src, .src_len = len };
	size_t offset = 0;
	while (offset < len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(src + offset, len - offset);
		if (t.error != GREMLIN_OK) return t.error;
		offset += t.consumed;
		if (t.value == 8u /* field 1, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint32_decode_result d =
				gremlin_varint32_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->channel = d.value;
			r->_has.channel = true;
			continue;
		}
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		uint32_t _fn = t.value / 8u;
		if (_fn == 0u || _fn > GREMLIN_MAX_FIELD_NUM)
			return GREMLIN_ERROR_INVALID_FIELD_NUM;
		struct gremlin_skip_result sk =
			gremlin_skip_data(src + offset, len - offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline uint32_t
pwm_output_DisableCommand_reader_get_channel(const pwm_output_DisableCommand_reader *r)
{
	if (r == NULL || !r->_has.channel) return 0;
	return r->channel;
}

typedef struct pwm_output_Command {
	struct gremlin_bytes	target_output_id;
	const pwm_output_WaveCommand *	wave;
	const pwm_output_DisableCommand *	disable;
	size_t	_size;
} pwm_output_Command;

static inline size_t
pwm_output_Command_cached_size(const pwm_output_Command *m)
{
	return m->_size;
}

__attribute__((noinline, unused)) static size_t
pwm_output_Command_size(const pwm_output_Command *m)
{
	size_t s = 0;
	if (m->target_output_id.len > 0) {
		s += 1
		   + gremlin_varint_size(m->target_output_id.len)
		   + m->target_output_id.len;
	}
	if (m->wave != NULL) {
		size_t _child_size = pwm_output_WaveCommand_size(m->wave);
		s += 1
		   + gremlin_varint_size(_child_size)
		   + _child_size;
	}
	if (m->disable != NULL) {
		size_t _child_size = pwm_output_DisableCommand_size(m->disable);
		s += 1
		   + gremlin_varint_size(_child_size)
		   + _child_size;
	}
	((pwm_output_Command *)m)->_size = s;
	return s;
}

__attribute__((unused)) static size_t
pwm_output_Command_encode_at(const pwm_output_Command *m, uint8_t * __restrict__ _buf, size_t _off)
{
	if (m->target_output_id.len > 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 10u);
		_off = gremlin_varint_encode_at(_buf, _off, m->target_output_id.len);
		_off = gremlin_write_bytes_at(_buf, _off, m->target_output_id.data, m->target_output_id.len);
	}
	if (m->wave != NULL) {
		_off = gremlin_varint32_encode_at(_buf, _off, 82u);
		_off = gremlin_varint_encode_at(_buf, _off, pwm_output_WaveCommand_cached_size(m->wave));
		_off = pwm_output_WaveCommand_encode_at(m->wave, _buf, _off);
	}
	if (m->disable != NULL) {
		_off = gremlin_varint32_encode_at(_buf, _off, 90u);
		_off = gremlin_varint_encode_at(_buf, _off, pwm_output_DisableCommand_cached_size(m->disable));
		_off = pwm_output_DisableCommand_encode_at(m->disable, _buf, _off);
	}
	return _off;
}

__attribute__((unused)) static void
pwm_output_Command_encode(const pwm_output_Command *m, struct gremlin_writer *w)
{
	w->offset = pwm_output_Command_encode_at(m, w->buf, w->offset);
}

typedef struct pwm_output_Command_reader {
	const uint8_t	*src;
	size_t		 src_len;
	struct {
		unsigned	target_output_id : 1;
		unsigned	wave : 1;
		unsigned	disable : 1;
	} _has;
	struct gremlin_bytes	target_output_id;
	struct gremlin_bytes	wave;
	struct gremlin_bytes	disable;
} pwm_output_Command_reader;

static inline enum gremlin_error
pwm_output_Command_reader_init(pwm_output_Command_reader *r, const uint8_t *src, size_t len)
{
	*r = (pwm_output_Command_reader){ .src = src, .src_len = len };
	size_t offset = 0;
	while (offset < len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(src + offset, len - offset);
		if (t.error != GREMLIN_OK) return t.error;
		offset += t.consumed;
		if (t.value == 10u /* field 1, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->target_output_id = d.bytes;
			r->_has.target_output_id = 1;
			continue;
		}
		if (t.value == 82u /* field 10, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->wave = d.bytes;
			r->_has.wave = 1;
			continue;
		}
		if (t.value == 90u /* field 11, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->disable = d.bytes;
			r->_has.disable = 1;
			continue;
		}
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		uint32_t _fn = t.value / 8u;
		if (_fn == 0u || _fn > GREMLIN_MAX_FIELD_NUM)
			return GREMLIN_ERROR_INVALID_FIELD_NUM;
		struct gremlin_skip_result sk =
			gremlin_skip_data(src + offset, len - offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline struct gremlin_bytes
pwm_output_Command_reader_get_target_output_id(const pwm_output_Command_reader *r)
{
	if (r == NULL || !r->_has.target_output_id) return (struct gremlin_bytes){ NULL, 0 };
	return r->target_output_id;
}

static inline enum gremlin_error
pwm_output_Command_reader_get_wave(const pwm_output_Command_reader *r, pwm_output_WaveCommand_reader *out)
{
	if (r == NULL || !r->_has.wave) {
		return pwm_output_WaveCommand_reader_init(out, NULL, 0);
	}
	return pwm_output_WaveCommand_reader_init(out, r->wave.data, r->wave.len);
}

static inline enum gremlin_error
pwm_output_Command_reader_get_disable(const pwm_output_Command_reader *r, pwm_output_DisableCommand_reader *out)
{
	if (r == NULL || !r->_has.disable) {
		return pwm_output_DisableCommand_reader_init(out, NULL, 0);
	}
	return pwm_output_DisableCommand_reader_init(out, r->disable.data, r->disable.len);
}

typedef struct pwm_output_TxEnvelope {
	uint64_t	monotonic_stamp_ns;
	uint64_t	local_stamp_ns;
	uint64_t	app_start_id;
	struct gremlin_bytes	command_id;
	struct gremlin_bytes	target_output_id;
	const pwm_output_Command *	command;
	size_t	_size;
} pwm_output_TxEnvelope;

static inline size_t
pwm_output_TxEnvelope_cached_size(const pwm_output_TxEnvelope *m)
{
	return m->_size;
}

__attribute__((noinline, unused)) static size_t
pwm_output_TxEnvelope_size(const pwm_output_TxEnvelope *m)
{
	size_t s = 0;
	if (m->monotonic_stamp_ns != 0) {
		s += 1
		   + gremlin_varint_size(m->monotonic_stamp_ns);
	}
	if (m->local_stamp_ns != 0) {
		s += 1
		   + gremlin_varint_size(m->local_stamp_ns);
	}
	if (m->app_start_id != 0) {
		s += 1
		   + gremlin_varint_size(m->app_start_id);
	}
	if (m->command_id.len > 0) {
		s += 1
		   + gremlin_varint_size(m->command_id.len)
		   + m->command_id.len;
	}
	if (m->target_output_id.len > 0) {
		s += 1
		   + gremlin_varint_size(m->target_output_id.len)
		   + m->target_output_id.len;
	}
	if (m->command != NULL) {
		size_t _child_size = pwm_output_Command_size(m->command);
		s += 1
		   + gremlin_varint_size(_child_size)
		   + _child_size;
	}
	((pwm_output_TxEnvelope *)m)->_size = s;
	return s;
}

__attribute__((unused)) static size_t
pwm_output_TxEnvelope_encode_at(const pwm_output_TxEnvelope *m, uint8_t * __restrict__ _buf, size_t _off)
{
	if (m->monotonic_stamp_ns != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 8u);
		_off = gremlin_varint_encode_at(_buf, _off, m->monotonic_stamp_ns);
	}
	if (m->local_stamp_ns != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 16u);
		_off = gremlin_varint_encode_at(_buf, _off, m->local_stamp_ns);
	}
	if (m->app_start_id != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 24u);
		_off = gremlin_varint_encode_at(_buf, _off, m->app_start_id);
	}
	if (m->command_id.len > 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 34u);
		_off = gremlin_varint_encode_at(_buf, _off, m->command_id.len);
		_off = gremlin_write_bytes_at(_buf, _off, m->command_id.data, m->command_id.len);
	}
	if (m->target_output_id.len > 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 42u);
		_off = gremlin_varint_encode_at(_buf, _off, m->target_output_id.len);
		_off = gremlin_write_bytes_at(_buf, _off, m->target_output_id.data, m->target_output_id.len);
	}
	if (m->command != NULL) {
		_off = gremlin_varint32_encode_at(_buf, _off, 82u);
		_off = gremlin_varint_encode_at(_buf, _off, pwm_output_Command_cached_size(m->command));
		_off = pwm_output_Command_encode_at(m->command, _buf, _off);
	}
	return _off;
}

__attribute__((unused)) static void
pwm_output_TxEnvelope_encode(const pwm_output_TxEnvelope *m, struct gremlin_writer *w)
{
	w->offset = pwm_output_TxEnvelope_encode_at(m, w->buf, w->offset);
}

typedef struct pwm_output_TxEnvelope_reader {
	const uint8_t	*src;
	size_t		 src_len;
	struct {
		unsigned	monotonic_stamp_ns : 1;
		unsigned	local_stamp_ns : 1;
		unsigned	app_start_id : 1;
		unsigned	command_id : 1;
		unsigned	target_output_id : 1;
		unsigned	command : 1;
	} _has;
	uint64_t	monotonic_stamp_ns;
	uint64_t	local_stamp_ns;
	uint64_t	app_start_id;
	struct gremlin_bytes	command_id;
	struct gremlin_bytes	target_output_id;
	struct gremlin_bytes	command;
} pwm_output_TxEnvelope_reader;

static inline enum gremlin_error
pwm_output_TxEnvelope_reader_init(pwm_output_TxEnvelope_reader *r, const uint8_t *src, size_t len)
{
	*r = (pwm_output_TxEnvelope_reader){ .src = src, .src_len = len };
	size_t offset = 0;
	while (offset < len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(src + offset, len - offset);
		if (t.error != GREMLIN_OK) return t.error;
		offset += t.consumed;
		if (t.value == 8u /* field 1, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint_decode_result d =
				gremlin_varint_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->monotonic_stamp_ns = d.value;
			r->_has.monotonic_stamp_ns = true;
			continue;
		}
		if (t.value == 16u /* field 2, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint_decode_result d =
				gremlin_varint_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->local_stamp_ns = d.value;
			r->_has.local_stamp_ns = true;
			continue;
		}
		if (t.value == 24u /* field 3, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint_decode_result d =
				gremlin_varint_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->app_start_id = d.value;
			r->_has.app_start_id = true;
			continue;
		}
		if (t.value == 34u /* field 4, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->command_id = d.bytes;
			r->_has.command_id = 1;
			continue;
		}
		if (t.value == 42u /* field 5, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->target_output_id = d.bytes;
			r->_has.target_output_id = 1;
			continue;
		}
		if (t.value == 82u /* field 10, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->command = d.bytes;
			r->_has.command = 1;
			continue;
		}
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		uint32_t _fn = t.value / 8u;
		if (_fn == 0u || _fn > GREMLIN_MAX_FIELD_NUM)
			return GREMLIN_ERROR_INVALID_FIELD_NUM;
		struct gremlin_skip_result sk =
			gremlin_skip_data(src + offset, len - offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline uint64_t
pwm_output_TxEnvelope_reader_get_monotonic_stamp_ns(const pwm_output_TxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.monotonic_stamp_ns) return 0;
	return r->monotonic_stamp_ns;
}

static inline uint64_t
pwm_output_TxEnvelope_reader_get_local_stamp_ns(const pwm_output_TxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.local_stamp_ns) return 0;
	return r->local_stamp_ns;
}

static inline uint64_t
pwm_output_TxEnvelope_reader_get_app_start_id(const pwm_output_TxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.app_start_id) return 0;
	return r->app_start_id;
}

static inline struct gremlin_bytes
pwm_output_TxEnvelope_reader_get_command_id(const pwm_output_TxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.command_id) return (struct gremlin_bytes){ NULL, 0 };
	return r->command_id;
}

static inline struct gremlin_bytes
pwm_output_TxEnvelope_reader_get_target_output_id(const pwm_output_TxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.target_output_id) return (struct gremlin_bytes){ NULL, 0 };
	return r->target_output_id;
}

static inline enum gremlin_error
pwm_output_TxEnvelope_reader_get_command(const pwm_output_TxEnvelope_reader *r, pwm_output_Command_reader *out)
{
	if (r == NULL || !r->_has.command) {
		return pwm_output_Command_reader_init(out, NULL, 0);
	}
	return pwm_output_Command_reader_init(out, r->command.data, r->command.len);
}

typedef struct pwm_output_RxEnvelope {
	uint64_t	monotonic_stamp_ns;
	uint64_t	local_stamp_ns;
	uint64_t	app_start_id;
	pwm_output_PwmOutputSignalType	signal_type;
	const pwm_output_PwmOutputDevice *	device;
	const pwm_output_OutputState *	state;
	const pwm_output_TxEnvelope *	command;
	struct gremlin_bytes	error;
	size_t	_size;
} pwm_output_RxEnvelope;

static inline size_t
pwm_output_RxEnvelope_cached_size(const pwm_output_RxEnvelope *m)
{
	return m->_size;
}

__attribute__((noinline, unused)) static size_t
pwm_output_RxEnvelope_size(const pwm_output_RxEnvelope *m)
{
	size_t s = 0;
	if (m->monotonic_stamp_ns != 0) {
		s += 1
		   + gremlin_varint_size(m->monotonic_stamp_ns);
	}
	if (m->local_stamp_ns != 0) {
		s += 1
		   + gremlin_varint_size(m->local_stamp_ns);
	}
	if (m->app_start_id != 0) {
		s += 1
		   + gremlin_varint_size(m->app_start_id);
	}
	if (m->signal_type != 0) {
		s += 1
		   + gremlin_varint_size((uint64_t)(int64_t)m->signal_type);
	}
	if (m->device != NULL) {
		size_t _child_size = pwm_output_PwmOutputDevice_size(m->device);
		s += 1
		   + gremlin_varint_size(_child_size)
		   + _child_size;
	}
	if (m->state != NULL) {
		size_t _child_size = pwm_output_OutputState_size(m->state);
		s += 1
		   + gremlin_varint_size(_child_size)
		   + _child_size;
	}
	if (m->command != NULL) {
		size_t _child_size = pwm_output_TxEnvelope_size(m->command);
		s += 2
		   + gremlin_varint_size(_child_size)
		   + _child_size;
	}
	if (m->error.len > 0) {
		s += 2
		   + gremlin_varint_size(m->error.len)
		   + m->error.len;
	}
	((pwm_output_RxEnvelope *)m)->_size = s;
	return s;
}

__attribute__((unused)) static size_t
pwm_output_RxEnvelope_encode_at(const pwm_output_RxEnvelope *m, uint8_t * __restrict__ _buf, size_t _off)
{
	if (m->monotonic_stamp_ns != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 8u);
		_off = gremlin_varint_encode_at(_buf, _off, m->monotonic_stamp_ns);
	}
	if (m->local_stamp_ns != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 16u);
		_off = gremlin_varint_encode_at(_buf, _off, m->local_stamp_ns);
	}
	if (m->app_start_id != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 24u);
		_off = gremlin_varint_encode_at(_buf, _off, m->app_start_id);
	}
	if (m->signal_type != 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 80u);
		_off = gremlin_varint_encode_at(_buf, _off, (uint64_t)(int64_t)m->signal_type);
	}
	if (m->device != NULL) {
		_off = gremlin_varint32_encode_at(_buf, _off, 90u);
		_off = gremlin_varint_encode_at(_buf, _off, pwm_output_PwmOutputDevice_cached_size(m->device));
		_off = pwm_output_PwmOutputDevice_encode_at(m->device, _buf, _off);
	}
	if (m->state != NULL) {
		_off = gremlin_varint32_encode_at(_buf, _off, 98u);
		_off = gremlin_varint_encode_at(_buf, _off, pwm_output_OutputState_cached_size(m->state));
		_off = pwm_output_OutputState_encode_at(m->state, _buf, _off);
	}
	if (m->command != NULL) {
		_off = gremlin_varint32_encode_at(_buf, _off, 162u);
		_off = gremlin_varint_encode_at(_buf, _off, pwm_output_TxEnvelope_cached_size(m->command));
		_off = pwm_output_TxEnvelope_encode_at(m->command, _buf, _off);
	}
	if (m->error.len > 0) {
		_off = gremlin_varint32_encode_at(_buf, _off, 402u);
		_off = gremlin_varint_encode_at(_buf, _off, m->error.len);
		_off = gremlin_write_bytes_at(_buf, _off, m->error.data, m->error.len);
	}
	return _off;
}

__attribute__((unused)) static void
pwm_output_RxEnvelope_encode(const pwm_output_RxEnvelope *m, struct gremlin_writer *w)
{
	w->offset = pwm_output_RxEnvelope_encode_at(m, w->buf, w->offset);
}

typedef struct pwm_output_RxEnvelope_reader {
	const uint8_t	*src;
	size_t		 src_len;
	struct {
		unsigned	monotonic_stamp_ns : 1;
		unsigned	local_stamp_ns : 1;
		unsigned	app_start_id : 1;
		unsigned	signal_type : 1;
		unsigned	device : 1;
		unsigned	state : 1;
		unsigned	command : 1;
		unsigned	error : 1;
	} _has;
	uint64_t	monotonic_stamp_ns;
	uint64_t	local_stamp_ns;
	uint64_t	app_start_id;
	pwm_output_PwmOutputSignalType	signal_type;
	struct gremlin_bytes	device;
	struct gremlin_bytes	state;
	struct gremlin_bytes	command;
	struct gremlin_bytes	error;
} pwm_output_RxEnvelope_reader;

static inline enum gremlin_error
pwm_output_RxEnvelope_reader_init(pwm_output_RxEnvelope_reader *r, const uint8_t *src, size_t len)
{
	*r = (pwm_output_RxEnvelope_reader){ .src = src, .src_len = len };
	size_t offset = 0;
	while (offset < len) {
		struct gremlin_varint32_decode_result t =
			gremlin_varint32_decode(src + offset, len - offset);
		if (t.error != GREMLIN_OK) return t.error;
		offset += t.consumed;
		if (t.value == 8u /* field 1, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint_decode_result d =
				gremlin_varint_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->monotonic_stamp_ns = d.value;
			r->_has.monotonic_stamp_ns = true;
			continue;
		}
		if (t.value == 16u /* field 2, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint_decode_result d =
				gremlin_varint_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->local_stamp_ns = d.value;
			r->_has.local_stamp_ns = true;
			continue;
		}
		if (t.value == 24u /* field 3, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint_decode_result d =
				gremlin_varint_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->app_start_id = d.value;
			r->_has.app_start_id = true;
			continue;
		}
		if (t.value == 80u /* field 10, GREMLIN_WIRE_VARINT */) {
			struct gremlin_varint_decode_result d =
				gremlin_varint_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->signal_type = (pwm_output_PwmOutputSignalType)(int32_t)(uint32_t)d.value;
			r->_has.signal_type = 1;
			continue;
		}
		if (t.value == 90u /* field 11, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->device = d.bytes;
			r->_has.device = 1;
			continue;
		}
		if (t.value == 98u /* field 12, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->state = d.bytes;
			r->_has.state = 1;
			continue;
		}
		if (t.value == 162u /* field 20, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->command = d.bytes;
			r->_has.command = 1;
			continue;
		}
		if (t.value == 402u /* field 50, GREMLIN_WIRE_LEN_PREFIX */) {
			struct gremlin_bytes_decode_result d =
				gremlin_bytes_decode(src + offset, len - offset);
			if (d.error != GREMLIN_OK) return d.error;
			offset += d.consumed;
			r->error = d.bytes;
			r->_has.error = 1;
			continue;
		}
		unsigned _wt = (unsigned)(t.value % 8u);
		if (_wt == 6u || _wt == 7u) return GREMLIN_ERROR_INVALID_WIRE_TYPE;
		uint32_t _fn = t.value / 8u;
		if (_fn == 0u || _fn > GREMLIN_MAX_FIELD_NUM)
			return GREMLIN_ERROR_INVALID_FIELD_NUM;
		struct gremlin_skip_result sk =
			gremlin_skip_data(src + offset, len - offset,
			                  (enum gremlin_wire_type)_wt);
		if (sk.error != GREMLIN_OK) return sk.error;
		offset += sk.consumed;
	}
	return GREMLIN_OK;
}

static inline uint64_t
pwm_output_RxEnvelope_reader_get_monotonic_stamp_ns(const pwm_output_RxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.monotonic_stamp_ns) return 0;
	return r->monotonic_stamp_ns;
}

static inline uint64_t
pwm_output_RxEnvelope_reader_get_local_stamp_ns(const pwm_output_RxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.local_stamp_ns) return 0;
	return r->local_stamp_ns;
}

static inline uint64_t
pwm_output_RxEnvelope_reader_get_app_start_id(const pwm_output_RxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.app_start_id) return 0;
	return r->app_start_id;
}

static inline pwm_output_PwmOutputSignalType
pwm_output_RxEnvelope_reader_get_signal_type(const pwm_output_RxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.signal_type) return 0;
	return r->signal_type;
}

static inline enum gremlin_error
pwm_output_RxEnvelope_reader_get_device(const pwm_output_RxEnvelope_reader *r, pwm_output_PwmOutputDevice_reader *out)
{
	if (r == NULL || !r->_has.device) {
		return pwm_output_PwmOutputDevice_reader_init(out, NULL, 0);
	}
	return pwm_output_PwmOutputDevice_reader_init(out, r->device.data, r->device.len);
}

static inline enum gremlin_error
pwm_output_RxEnvelope_reader_get_state(const pwm_output_RxEnvelope_reader *r, pwm_output_OutputState_reader *out)
{
	if (r == NULL || !r->_has.state) {
		return pwm_output_OutputState_reader_init(out, NULL, 0);
	}
	return pwm_output_OutputState_reader_init(out, r->state.data, r->state.len);
}

static inline enum gremlin_error
pwm_output_RxEnvelope_reader_get_command(const pwm_output_RxEnvelope_reader *r, pwm_output_TxEnvelope_reader *out)
{
	if (r == NULL || !r->_has.command) {
		return pwm_output_TxEnvelope_reader_init(out, NULL, 0);
	}
	return pwm_output_TxEnvelope_reader_init(out, r->command.data, r->command.len);
}

static inline struct gremlin_bytes
pwm_output_RxEnvelope_reader_get_error(const pwm_output_RxEnvelope_reader *r)
{
	if (r == NULL || !r->_has.error) return (struct gremlin_bytes){ NULL, 0 };
	return r->error;
}

#endif

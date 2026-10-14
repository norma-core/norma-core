/* VP8 on the Hantro H1 of i.MX 8M Mini, through NXP's libhantro_h1 loaded at
 * run time: the library is proprietary, so it is never linked or shipped,
 * and only the declarations below are ours. */
#include <dlfcn.h>
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef uint32_t u32;
typedef int32_t i32;

enum { FRAME_READY = 1, HW_TIMEOUT = -11 };
enum { INTRA_FRAME = 0, PREDICTED_FRAME = 1 };
enum { REFERENCE = 1, REFERENCE_AND_REFRESH = 3 };
enum { CLIENT_VP8 = 2, YUV420_PLANAR = 0 };

typedef struct {
	u32 ref_frames, width, height, rate_num, rate_denom, scaled_w, scaled_h;
} enc_config;

typedef struct {
	u32 enable, top, left, bottom, right;
} enc_area;

typedef struct {
	u32 interpolation_filter, filter_type, filter_level, filter_sharpness;
	u32 dct_partitions, error_resilient, split_mv, quarter_pixel_mv;
	u32 cir_start, cir_interval;
	enc_area intra_area, roi1_area, roi2_area;
	i32 roi1_delta_qp, roi2_delta_qp;
	u32 deadzone, max_num_passes;
	int quality_metric;
	i32 qp_delta[5];
	i32 adaptive_roi, adaptive_roi_color;
} enc_coding;

typedef struct {
	u32 picture_rc, picture_skip;
	i32 qp_hdr;
	u32 qp_min, qp_max, bit_per_second;
	u32 layer_bit_per_second[4], layer_rate_denom[4];
	u32 bitrate_window;
	i32 intra_qp_delta;
	u32 fixed_intra_qp, intra_rate, golden_rate, altref_rate;
	u32 golden_boost, adaptive_golden_boost, adaptive_golden_update;
} enc_rate;

typedef struct {
	int type;
	uint16_t a, b, c, e, f;
} enc_color;

typedef struct {
	u32 orig_width, orig_height, x_offset, y_offset;
	int input_type, rotation;
	u32 video_stabilization;
	enc_color color;
	u32 scaled_output;
} enc_preprocessing;

typedef struct {
	size_t bus_luma, bus_cb, bus_cr;
	u32 *out_buf;
	size_t bus_out_buf;
	u32 out_buf_size;
	int coding_type;
	u32 time_increment;
	size_t bus_luma_stab;
	int ipf, grf, arf;
	u32 layer_id;
} enc_in;

typedef struct {
	int coding_type;
	u32 *partition[9];
	u32 partition_size[9];
	u32 frame_size;
	int8_t *motion_vectors;
	int ipf, grf, arf;
	u32 mse_mul256;
	size_t bus_scaled_luma;
	uint8_t *scaled_picture;
} enc_out;

typedef struct {
	u32 *virt;
	u32 size;
	size_t bus;
	int fd;
} linear_mem;

static struct {
	int (*init)(const enc_config *, const void **);
	int (*release)(const void *);
	int (*get_coding)(const void *, enc_coding *);
	int (*set_coding)(const void *, const enc_coding *);
	int (*get_rate)(const void *, enc_rate *);
	int (*set_rate)(const void *, const enc_rate *);
	int (*get_pre)(const void *, enc_preprocessing *);
	int (*set_pre)(const void *, const enc_preprocessing *);
	int (*encode)(const void *, const enc_in *, enc_out *);
	const void *(*ewl_init)(const u32 *client_type);
	i32 (*ewl_release)(const void *);
	i32 (*ewl_malloc)(const void *, u32, linear_mem *);
	void (*ewl_free)(const void *, linear_mem *);
} h1;

struct nc_h1_enc {
	const void *enc;
	const void *ewl;
	linear_mem in, out;
	unsigned w, h, stride;
	int started;
	uint8_t *frame;
	size_t frame_cap;
};

static void *lib;

static int load_locked(char *msg, size_t msg_len)
{
	if (lib)
		return 0;
	void *l = dlopen("libhantro_h1.so.1", RTLD_NOW);
	if (!l)
		l = dlopen("libhantro_h1.so", RTLD_NOW);
	if (!l) {
		snprintf(msg, msg_len, "libhantro_h1 not found");
		return -1;
	}
	const struct {
		void **fn;
		const char *name;
	} syms[] = {
		{(void **)&h1.init, "VP8EncInit"},
		{(void **)&h1.release, "VP8EncRelease"},
		{(void **)&h1.get_coding, "VP8EncGetCodingCtrl"},
		{(void **)&h1.set_coding, "VP8EncSetCodingCtrl"},
		{(void **)&h1.get_rate, "VP8EncGetRateCtrl"},
		{(void **)&h1.set_rate, "VP8EncSetRateCtrl"},
		{(void **)&h1.get_pre, "VP8EncGetPreProcessing"},
		{(void **)&h1.set_pre, "VP8EncSetPreProcessing"},
		{(void **)&h1.encode, "VP8EncStrmEncode"},
		{(void **)&h1.ewl_init, "EWLInit"},
		{(void **)&h1.ewl_release, "EWLRelease"},
		{(void **)&h1.ewl_malloc, "EWLMallocLinear"},
		{(void **)&h1.ewl_free, "EWLFreeLinear"},
	};
	for (size_t i = 0; i < sizeof(syms) / sizeof(syms[0]); i++) {
		*syms[i].fn = dlsym(l, syms[i].name);
		if (!*syms[i].fn) {
			snprintf(msg, msg_len, "libhantro_h1 has no %s", syms[i].name);
			dlclose(l);
			return -1;
		}
	}
	lib = l;
	return 0;
}

/* Cameras open encoders on their own threads; the lock also publishes the
 * function table to the thread that did not load it. */
static int load(char *msg, size_t msg_len)
{
	static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
	pthread_mutex_lock(&lock);
	int ret = load_locked(msg, msg_len);
	pthread_mutex_unlock(&lock);
	return ret;
}

void nc_h1_enc_free(struct nc_h1_enc *e)
{
	if (!e)
		return;
	if (e->enc)
		h1.release(e->enc);
	if (e->ewl) {
		if (e->in.virt)
			h1.ewl_free(e->ewl, &e->in);
		if (e->out.virt)
			h1.ewl_free(e->ewl, &e->out);
		h1.ewl_release(e->ewl);
	}
	free(e->frame);
	free(e);
}

static struct nc_h1_enc *fail(struct nc_h1_enc *e, int ret, const char *what, char *msg,
    size_t msg_len)
{
	snprintf(msg, msg_len, "%s failed (%d)", what, ret);
	nc_h1_enc_free(e);
	return NULL;
}

struct nc_h1_enc *nc_h1_enc_new(unsigned w, unsigned h, char *msg, size_t msg_len)
{
	if (load(msg, msg_len) != 0)
		return NULL;
	struct nc_h1_enc *e = calloc(1, sizeof(*e));
	if (!e) {
		snprintf(msg, msg_len, "out of memory");
		return NULL;
	}
	e->w = w;
	e->h = h;
	e->stride = (w + 15) & ~15u;

	/* Counted at 30 per second, as in vp8_shim.c, for the same per-frame
	 * budget of 0.1 bit a pixel. */
	enc_config cfg = {.ref_frames = 1, .width = w, .height = h, .rate_num = 30, .rate_denom = 1};
	int ret = h1.init(&cfg, &e->enc);
	if (ret != 0) {
		e->enc = NULL;
		return fail(e, ret, "VP8EncInit", msg, msg_len);
	}

	enc_rate rc;
	if ((ret = h1.get_rate(e->enc, &rc)) != 0)
		return fail(e, ret, "VP8EncGetRateCtrl", msg, msg_len);
	rc.picture_rc = 1;
	/* Every kept frame gets an entry, and keyframes are placed by the caller. */
	rc.picture_skip = 0;
	rc.bit_per_second = w * h * 30 / 10;
	rc.intra_rate = 0;
	rc.golden_rate = 0;
	rc.altref_rate = 0;
	/* A keyframe at the default delta is 7-10 times a delta frame and stalls
	 * the frames behind it on a slow uplink; 30 halves it at the same bitrate. */
	rc.intra_qp_delta = 30;
	if ((ret = h1.set_rate(e->enc, &rc)) != 0)
		return fail(e, ret, "VP8EncSetRateCtrl", msg, msg_len);

	enc_coding cc;
	if ((ret = h1.get_coding(e->enc, &cc)) != 0)
		return fail(e, ret, "VP8EncGetCodingCtrl", msg, msg_len);
	cc.dct_partitions = 0;
	if ((ret = h1.set_coding(e->enc, &cc)) != 0)
		return fail(e, ret, "VP8EncSetCodingCtrl", msg, msg_len);

	enc_preprocessing pre;
	if ((ret = h1.get_pre(e->enc, &pre)) != 0)
		return fail(e, ret, "VP8EncGetPreProcessing", msg, msg_len);
	pre.orig_width = w;
	pre.orig_height = h;
	pre.x_offset = pre.y_offset = 0;
	pre.input_type = YUV420_PLANAR;
	pre.rotation = 0;
	pre.video_stabilization = 0;
	if ((ret = h1.set_pre(e->enc, &pre)) != 0)
		return fail(e, ret, "VP8EncSetPreProcessing", msg, msg_len);

	/* Buffers need physically contiguous memory, which only the library's
	 * own allocator hands out. */
	u32 client = CLIENT_VP8;
	e->ewl = h1.ewl_init(&client);
	if (!e->ewl)
		return fail(e, -1, "EWLInit", msg, msg_len);
	u32 picture = e->stride * h * 3 / 2;
	if ((ret = h1.ewl_malloc(e->ewl, picture, &e->in)) != 0) {
		e->in.virt = NULL;
		return fail(e, ret, "input buffer", msg, msg_len);
	}
	if ((ret = h1.ewl_malloc(e->ewl, picture * 4 < 8u << 20 ? picture * 4 : 8u << 20, &e->out)) != 0) {
		e->out.virt = NULL;
		return fail(e, ret, "output buffer", msg, msg_len);
	}
	return e;
}

/* `*out` stays valid until the next call on `e`. */
int nc_h1_enc_encode(struct nc_h1_enc *e, const uint8_t *i420, int force_keyframe,
    const uint8_t **out, size_t *out_len, int *keyframe, char *msg, size_t msg_len)
{
	unsigned w = e->w, h = e->h, cw = w / 2, ch = h / 2, cs = e->stride / 2;
	uint8_t *y = (uint8_t *)e->in.virt;
	uint8_t *u = y + (size_t)e->stride * h;
	uint8_t *v = u + (size_t)cs * ch;
	for (unsigned r = 0; r < h; r++)
		memcpy(y + (size_t)r * e->stride, i420 + (size_t)r * w, w);
	const uint8_t *su = i420 + (size_t)w * h, *sv = su + (size_t)cw * ch;
	for (unsigned r = 0; r < ch; r++) {
		memcpy(u + (size_t)r * cs, su + (size_t)r * cw, cw);
		memcpy(v + (size_t)r * cs, sv + (size_t)r * cw, cw);
	}

	enc_in in = {
		.bus_luma = e->in.bus,
		.bus_cb = e->in.bus + (size_t)e->stride * h,
		.bus_cr = e->in.bus + (size_t)e->stride * h + (size_t)cs * ch,
		.out_buf = e->out.virt,
		.bus_out_buf = e->out.bus,
		.out_buf_size = e->out.size,
		.coding_type = force_keyframe || !e->started ? INTRA_FRAME : PREDICTED_FRAME,
		.time_increment = e->started ? 1 : 0,
		.ipf = REFERENCE_AND_REFRESH,
		.grf = REFERENCE,
		.arf = REFERENCE,
	};
	enc_out o;
	int ret, tries = 0;
	do {
		ret = h1.encode(e->enc, &in, &o);
		/* A timed-out pass may have taken or overwritten the reference, so a
		 * retry starts a new chain; rate control already counted this frame's
		 * time. */
		in.coding_type = INTRA_FRAME;
		in.time_increment = 0;
	} while (ret == HW_TIMEOUT && ++tries < 4);
	if (ret != FRAME_READY) {
		snprintf(msg, msg_len, "VP8EncStrmEncode failed (%d)", ret);
		return -1;
	}
	e->started = 1;

	if (o.frame_size > e->frame_cap) {
		uint8_t *grown = realloc(e->frame, o.frame_size);
		if (!grown) {
			snprintf(msg, msg_len, "out of memory");
			return -1;
		}
		e->frame = grown;
		e->frame_cap = o.frame_size;
	}
	/* The partitions sit apart in the output buffer; joined in order they
	 * are the frame. */
	size_t n = 0;
	for (int i = 0; i < 9 && n < o.frame_size; i++) {
		u32 size = o.partition_size[i];
		if (!size)
			continue;
		if (size > o.frame_size - n) {
			snprintf(msg, msg_len, "partitions exceed the frame size");
			return -1;
		}
		memcpy(e->frame + n, o.partition[i], size);
		n += size;
	}
	if (n == 0) {
		snprintf(msg, msg_len, "encoder returned an empty frame");
		return -1;
	}
	*out = e->frame;
	*out_len = n;
	*keyframe = o.coding_type == INTRA_FRAME;
	return 0;
}

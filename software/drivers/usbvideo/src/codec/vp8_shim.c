/* Compiled against the installed libvpx headers, so the library's struct
 * layouts and ABI versions never leak into Rust. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <vpx/vp8cx.h>
#include <vpx/vp8dx.h>
#include <vpx/vpx_decoder.h>
#include <vpx/vpx_encoder.h>

struct nc_vp8_enc {
	vpx_codec_ctx_t ctx;
	unsigned w, h;
	vpx_codec_pts_t pts;
	uint8_t *out;
	size_t out_cap;
};

struct nc_vp8_dec {
	vpx_codec_ctx_t ctx;
};

static int fail(vpx_codec_ctx_t *ctx, vpx_codec_err_t err, const char *what, char *msg, size_t msg_len)
{
	const char *detail = ctx ? vpx_codec_error_detail(ctx) : NULL;
	snprintf(msg, msg_len, "%s: %s%s%s%s", what, vpx_codec_err_to_string(err),
	    detail ? " (" : "", detail ? detail : "", detail ? ")" : "");
	return -1;
}

struct nc_vp8_enc *nc_vp8_enc_new(unsigned w, unsigned h, int cq_level, int cpu_used,
    char *msg, size_t msg_len)
{
	vpx_codec_enc_cfg_t cfg;
	vpx_codec_err_t err = vpx_codec_enc_config_default(vpx_codec_vp8_cx(), &cfg, 0);
	if (err != VPX_CODEC_OK) {
		fail(NULL, err, "config", msg, msg_len);
		return NULL;
	}
	cfg.g_w = w;
	cfg.g_h = h;
	cfg.g_threads = 1;
	/* Frames are counted at 30 per second; with CQ the rate only caps the
	 * worst case, so the guess does not need to match the camera. */
	cfg.g_timebase.num = 1;
	cfg.g_timebase.den = 30;
	/* No lookahead: each frame's packet comes out of its own encode call. */
	cfg.g_lag_in_frames = 0;
	/* Rate control never drops a frame: every kept frame gets an entry. */
	cfg.rc_dropframe_thresh = 0;
	cfg.rc_resize_allowed = 0;
	cfg.rc_end_usage = VPX_CQ;
	/* kbit/s: about 4 bits a pixel at 30 fps, well above what CQ asks for. */
	cfg.rc_target_bitrate = w * h * 30 * 4 / 1000;
	cfg.rc_min_quantizer = 4;
	cfg.rc_max_quantizer = 48;
	/* Keyframes are placed by the caller. */
	cfg.kf_mode = VPX_KF_DISABLED;

	struct nc_vp8_enc *e = calloc(1, sizeof(*e));
	if (!e) {
		snprintf(msg, msg_len, "out of memory");
		return NULL;
	}
	e->w = w;
	e->h = h;
	err = vpx_codec_enc_init(&e->ctx, vpx_codec_vp8_cx(), &cfg, 0);
	if (err != VPX_CODEC_OK) {
		fail(NULL, err, "encoder init", msg, msg_len);
		free(e);
		return NULL;
	}
	/* Altref frames are invisible and reorder references; one visible frame
	 * per packet keeps entry N = frame N. */
	if ((err = vpx_codec_control(&e->ctx, VP8E_SET_ENABLEAUTOALTREF, 0)) != VPX_CODEC_OK ||
	    (err = vpx_codec_control(&e->ctx, VP8E_SET_CPUUSED, cpu_used)) != VPX_CODEC_OK ||
	    (err = vpx_codec_control(&e->ctx, VP8E_SET_CQ_LEVEL, cq_level)) != VPX_CODEC_OK) {
		fail(&e->ctx, err, "encoder control", msg, msg_len);
		vpx_codec_destroy(&e->ctx);
		free(e);
		return NULL;
	}
	return e;
}

/* `*out` stays valid until the next call on `e`. */
int nc_vp8_enc_encode(struct nc_vp8_enc *e, uint8_t *i420, int force_keyframe,
    const uint8_t **out, size_t *out_len, int *keyframe, char *msg, size_t msg_len)
{
	vpx_image_t img;
	if (!vpx_img_wrap(&img, VPX_IMG_FMT_I420, e->w, e->h, 1, i420)) {
		snprintf(msg, msg_len, "wrapping the frame failed");
		return -1;
	}
	vpx_codec_err_t err = vpx_codec_encode(&e->ctx, &img, e->pts++, 1,
	    force_keyframe ? VPX_EFLAG_FORCE_KF : 0, VPX_DL_REALTIME);
	if (err != VPX_CODEC_OK)
		return fail(&e->ctx, err, "encode", msg, msg_len);

	int packets = 0;
	vpx_codec_iter_t iter = NULL;
	const vpx_codec_cx_pkt_t *pkt;
	while ((pkt = vpx_codec_get_cx_data(&e->ctx, &iter)) != NULL) {
		if (pkt->kind != VPX_CODEC_CX_FRAME_PKT)
			continue;
		if (++packets > 1) {
			snprintf(msg, msg_len, "encoder returned more than one packet for a frame");
			return -1;
		}
		if (pkt->data.frame.sz > e->out_cap) {
			uint8_t *grown = realloc(e->out, pkt->data.frame.sz);
			if (!grown) {
				snprintf(msg, msg_len, "out of memory");
				return -1;
			}
			e->out = grown;
			e->out_cap = pkt->data.frame.sz;
		}
		memcpy(e->out, pkt->data.frame.buf, pkt->data.frame.sz);
		*out_len = pkt->data.frame.sz;
		*keyframe = (pkt->data.frame.flags & VPX_FRAME_IS_KEY) != 0;
	}
	if (packets == 0) {
		snprintf(msg, msg_len, "encoder returned no packet for a frame");
		return -1;
	}
	*out = e->out;
	return 0;
}

void nc_vp8_enc_free(struct nc_vp8_enc *e)
{
	if (!e)
		return;
	vpx_codec_destroy(&e->ctx);
	free(e->out);
	free(e);
}

struct nc_vp8_dec *nc_vp8_dec_new(char *msg, size_t msg_len)
{
	struct nc_vp8_dec *d = calloc(1, sizeof(*d));
	if (!d) {
		snprintf(msg, msg_len, "out of memory");
		return NULL;
	}
	vpx_codec_err_t err = vpx_codec_dec_init(&d->ctx, vpx_codec_vp8_dx(), NULL, 0);
	if (err != VPX_CODEC_OK) {
		fail(NULL, err, "decoder init", msg, msg_len);
		free(d);
		return NULL;
	}
	return d;
}

/* The planes belong to `d` and stay valid until the next call on it. */
int nc_vp8_dec_decode(struct nc_vp8_dec *d, const uint8_t *data, size_t len,
    unsigned *w, unsigned *h, const uint8_t *planes[3], int strides[3],
    char *msg, size_t msg_len)
{
	vpx_codec_err_t err = vpx_codec_decode(&d->ctx, data, (unsigned)len, NULL, 0);
	if (err != VPX_CODEC_OK)
		return fail(&d->ctx, err, "decode", msg, msg_len);
	vpx_codec_iter_t iter = NULL;
	vpx_image_t *img = vpx_codec_get_frame(&d->ctx, &iter);
	if (!img) {
		snprintf(msg, msg_len, "decoder returned no frame for a packet");
		return -1;
	}
	if (img->fmt != VPX_IMG_FMT_I420) {
		snprintf(msg, msg_len, "unexpected decoded format %d", (int)img->fmt);
		return -1;
	}
	*w = img->d_w;
	*h = img->d_h;
	for (int i = 0; i < 3; i++) {
		planes[i] = img->planes[i];
		strides[i] = img->stride[i];
	}
	return 0;
}

void nc_vp8_dec_free(struct nc_vp8_dec *d)
{
	if (!d)
		return;
	vpx_codec_destroy(&d->ctx);
	free(d);
}

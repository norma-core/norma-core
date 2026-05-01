/* SPDX-License-Identifier: GPL-2.0-only WITH Linux-syscall-note */
/*
 * Copyright (C) 2021 - 2023, Raspberry Pi Ltd
 *
 * pisp_fe_config.h - PiSP Front End Driver Configuration structures
 */
#ifndef _PISP_FE_CONFIG_
#define _PISP_FE_CONFIG_

#include "common/pisp_common.h"

#include "pisp_statistics.h"

#define PISP_FE_NUM_OUTPUTS 2

#define PISP_FE_ENABLE_CROP(i) (PISP_FE_ENABLE_CROP0<<(4*i))
#define PISP_FE_ENABLE_DOWNSCALE(i) (PISP_FE_ENABLE_DOWNSCALE0<<(4*i))
#define PISP_FE_ENABLE_COMPRESS(i) (PISP_FE_ENABLE_COMPRESS0<<(4*i))
#define PISP_FE_ENABLE_OUTPUT(i) (PISP_FE_ENABLE_OUTPUT0<<(4*i))


typedef enum {
	PISP_FE_ENABLE_INPUT = 0x000001,
	PISP_FE_ENABLE_DECOMPRESS = 0x000002,
	PISP_FE_ENABLE_DECOMPAND = 0x000004,
	PISP_FE_ENABLE_BLA = 0x000008,
	PISP_FE_ENABLE_DPC = 0x000010,
	PISP_FE_ENABLE_STATS_CROP = 0x000020,
	PISP_FE_ENABLE_DECIMATE = 0x000040,
	PISP_FE_ENABLE_BLC = 0x000080,
	PISP_FE_ENABLE_CDAF_STATS = 0x000100,
	PISP_FE_ENABLE_AWB_STATS = 0x000200,
	PISP_FE_ENABLE_RGBY = 0x000400,
	PISP_FE_ENABLE_LSC = 0x000800,
	PISP_FE_ENABLE_AGC_STATS = 0x001000,
	PISP_FE_ENABLE_CROP0 = 0x010000,
	PISP_FE_ENABLE_DOWNSCALE0 = 0x020000,
	PISP_FE_ENABLE_COMPRESS0 = 0x040000,
	PISP_FE_ENABLE_OUTPUT0 = 0x080000,
	PISP_FE_ENABLE_CROP1 = 0x100000,
	PISP_FE_ENABLE_DOWNSCALE1 = 0x200000,
	PISP_FE_ENABLE_COMPRESS1 = 0x400000,
	PISP_FE_ENABLE_OUTPUT1 = 0x800000
} pisp_fe_enable;

/*
 * We use the enable flags to show when blocks are "dirty", but we need some
 * extra ones too.
 */
typedef enum {
	PISP_FE_DIRTY_GLOBAL = 0x0001,
	PISP_FE_DIRTY_FLOATING = 0x0002,
	PISP_FE_DIRTY_OUTPUT_AXI = 0x0004
} pisp_fe_dirty;

typedef struct {
	uint32_t enables;
	uint8_t bayer_order;
	uint8_t pad[3];
} pisp_fe_global_config;

typedef struct {
	/* burst length minus one, in the range 0..15; OR'd with flags */
	uint8_t maxlen_flags;
	/* { prot[2:0], cache[3:0] } fields */
	uint8_t cache_prot;
	/* QoS (only 4 LS bits are used) */
	uint16_t qos;
} pisp_fe_input_axi_config;

typedef struct {
	/* burst length minus one, in the range 0..15; OR'd with flags */
	uint8_t maxlen_flags;
	/* { prot[2:0], cache[3:0] } fields */
	uint8_t cache_prot;
	/* QoS (4 bitfields of 4 bits each for different panic levels) */
	uint16_t qos;
	/*  For Panic mode: Output FIFO panic threshold */
	uint16_t thresh;
	/*  For Panic mode: Output FIFO statistics throttle threshold */
	uint16_t throttle;
} pisp_fe_output_axi_config;

typedef struct {
	uint8_t streaming;
	uint8_t pad[3];
	pisp_image_format_config format;
	pisp_fe_input_axi_config axi;
	/* Extra cycles delay before issuing each burst request */
	uint8_t holdoff;
	uint8_t pad2[3];
} pisp_fe_input_config;

typedef struct {
	pisp_image_format_config format;
	uint16_t ilines;
	uint8_t pad[2];
} pisp_fe_output_config;

typedef struct {
	uint32_t addr_lo;
	uint32_t addr_hi;
	uint16_t frame_id;
	uint16_t pad;
} pisp_fe_input_buffer_config;

#define PISP_FE_DECOMPAND_LUT_SIZE 65

typedef struct {
	uint16_t lut[PISP_FE_DECOMPAND_LUT_SIZE];
	uint16_t pad;
} pisp_fe_decompand_config;

typedef struct {
	uint8_t coeff_level;
	uint8_t coeff_range;
	uint8_t coeff_range2;
#define PISP_FE_DPC_FLAG_FOLDBACK 1
#define PISP_FE_DPC_FLAG_VFLAG 2
	uint8_t flags;
} pisp_fe_dpc_config;

#define PISP_FE_LSC_LUT_SIZE 16

typedef struct {
	uint8_t shift;
	uint8_t pad0;
	uint16_t scale;
	uint16_t centre_x;
	uint16_t centre_y;
	uint16_t lut[PISP_FE_LSC_LUT_SIZE];
} pisp_fe_lsc_config;

typedef struct {
	uint16_t gain_r;
	uint16_t gain_g;
	uint16_t gain_b;
	uint8_t maxflag;
	uint8_t pad;
} pisp_fe_rgby_config;

typedef struct {
	uint16_t offset_x;
	uint16_t offset_y;
	uint16_t size_x;
	uint16_t size_y;
	/* each weight only 4 bits */
	uint8_t weights[PISP_AGC_STATS_NUM_ZONES / 2];
	uint16_t row_offset_x;
	uint16_t row_offset_y;
	uint16_t row_size_x;
	uint16_t row_size_y;
	uint8_t row_shift;
	uint8_t float_shift;
	uint8_t pad1[2];
} pisp_fe_agc_stats_config;

typedef struct {
	uint16_t offset_x;
	uint16_t offset_y;
	uint16_t size_x;
	uint16_t size_y;
	uint8_t shift;
	uint8_t pad[3];
	uint16_t r_lo;
	uint16_t r_hi;
	uint16_t g_lo;
	uint16_t g_hi;
	uint16_t b_lo;
	uint16_t b_hi;
} pisp_fe_awb_stats_config;

typedef struct {
	uint16_t offset_x;
	uint16_t offset_y;
	uint16_t size_x;
	uint16_t size_y;
} pisp_fe_floating_stats_region;

typedef struct {
	pisp_fe_floating_stats_region regions[PISP_FLOATING_STATS_NUM_ZONES];
} pisp_fe_floating_stats_config;

#define PISP_FE_CDAF_NUM_WEIGHTS 8

typedef struct {
	uint16_t noise_constant;
	uint16_t noise_slope;
	uint16_t offset_x;
	uint16_t offset_y;
	uint16_t size_x;
	uint16_t size_y;
	uint16_t skip_x;
	uint16_t skip_y;
	uint32_t mode;
} pisp_fe_cdaf_stats_config;

typedef struct {
	uint32_t addr_lo;
	uint32_t addr_hi;
} pisp_fe_stats_buffer_config;

typedef struct {
	uint16_t offset_x;
	uint16_t offset_y;
	uint16_t width;
	uint16_t height;
} pisp_fe_crop_config;

typedef enum {
	DOWNSCALE_BAYER =
		1, /* downscale the four Bayer components independently... */
	DOWNSCALE_BIN =
		2 /* ...without trying to preserve their spatial relationship */
} pisp_fe_downscale_flags;

typedef struct {
	uint8_t xin;
	uint8_t xout;
	uint8_t yin;
	uint8_t yout;
	uint8_t flags; /* enum pisp_fe_downscale_flags */
	uint8_t pad[3];
	uint16_t output_width;
	uint16_t output_height;
} pisp_fe_downscale_config;

typedef struct {
	uint32_t addr_lo;
	uint32_t addr_hi;
} pisp_fe_output_buffer_config;

/* Each of the two output channels/branches: */
typedef struct {
	pisp_fe_crop_config crop;
	pisp_fe_downscale_config downscale;
	pisp_compress_config compress;
	pisp_fe_output_config output;
	uint32_t pad;
} pisp_fe_output_branch_config;

/* And finally one to rule them all: */
typedef struct {
	/* I/O configuration: */
	pisp_fe_stats_buffer_config stats_buffer;
	pisp_fe_output_buffer_config output_buffer[PISP_FE_NUM_OUTPUTS];
	pisp_fe_input_buffer_config input_buffer;
	/* processing configuration: */
	pisp_fe_global_config global;
	pisp_fe_input_config input;
	pisp_decompress_config decompress;
	pisp_fe_decompand_config decompand;
	pisp_bla_config bla;
	pisp_fe_dpc_config dpc;
	pisp_fe_crop_config stats_crop;
	uint32_t spare1; /* placeholder for future decimate configuration */
	pisp_bla_config blc;
	pisp_fe_rgby_config rgby;
	pisp_fe_lsc_config lsc;
	pisp_fe_agc_stats_config agc_stats;
	pisp_fe_awb_stats_config awb_stats;
	pisp_fe_cdaf_stats_config cdaf_stats;
	pisp_fe_floating_stats_config floating_stats;
	pisp_fe_output_axi_config output_axi;
	pisp_fe_output_branch_config ch[PISP_FE_NUM_OUTPUTS];
	/* non-register fields: */
	uint32_t dirty_flags; /* these use pisp_fe_enable */
	uint32_t dirty_flags_extra; /* these use pisp_fe_dirty */
} pisp_fe_config;

#endif /* _PISP_FE_CONFIG_ */

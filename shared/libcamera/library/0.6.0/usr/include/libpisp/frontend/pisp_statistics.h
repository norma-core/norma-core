/* SPDX-License-Identifier: GPL-2.0-only WITH Linux-syscall-note */
/*
 * PY PiSP Front End statistics definitions
 *
 * Copyright (C) 2021 - 2023, Raspberry Pi Ltd
 *
 */
#ifndef _PISP_FE_STATISTICS_H_
#define _PISP_FE_STATISTICS_H_

#include <stdint.h>

#define PISP_FLOATING_STATS_NUM_ZONES 4
#define PISP_AGC_STATS_NUM_BINS 1024
#define PISP_AGC_STATS_SIZE 16
#define PISP_AGC_STATS_NUM_ZONES (PISP_AGC_STATS_SIZE * PISP_AGC_STATS_SIZE)
#define PISP_AGC_STATS_NUM_ROW_SUMS 512

typedef struct {
	uint64_t Y_sum;
	uint32_t counted;
	uint32_t pad;
} pisp_agc_statistics_zone;

typedef struct {
	uint32_t row_sums[PISP_AGC_STATS_NUM_ROW_SUMS];
	/*
	 * 32-bits per bin means an image (just less than) 16384x16384 pixels
	 * in size can weight every pixel from 0 to 15.
	 */
	uint32_t histogram[PISP_AGC_STATS_NUM_BINS];
	pisp_agc_statistics_zone floating[PISP_FLOATING_STATS_NUM_ZONES];
} pisp_agc_statistics;

#define PISP_AWB_STATS_SIZE 32
#define PISP_AWB_STATS_NUM_ZONES (PISP_AWB_STATS_SIZE * PISP_AWB_STATS_SIZE)

typedef struct {
	uint32_t R_sum;
	uint32_t G_sum;
	uint32_t B_sum;
	uint32_t counted;
} pisp_awb_statistics_zone;

typedef struct {
	pisp_awb_statistics_zone zones[PISP_AWB_STATS_NUM_ZONES];
	pisp_awb_statistics_zone floating[PISP_FLOATING_STATS_NUM_ZONES];
} pisp_awb_statistics;

#define PISP_CDAF_STATS_SIZE 8
#define PISP_CDAF_STATS_NUM_FOMS (PISP_CDAF_STATS_SIZE * PISP_CDAF_STATS_SIZE)

typedef struct {
	uint64_t foms[PISP_CDAF_STATS_NUM_FOMS];
	uint64_t floating[PISP_FLOATING_STATS_NUM_ZONES];
} pisp_cdaf_statistics;

typedef struct {
	pisp_awb_statistics awb;
	pisp_agc_statistics agc;
	pisp_cdaf_statistics cdaf;
} pisp_statistics;

#endif /* _PISP_FE_STATISTICS_H_ */

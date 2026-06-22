/* SPDX-License-Identifier: BSD-2-Clause */
/*
 * Copyright (C) 2021 - 2023, Raspberry Pi Ltd
 *
 * pisp_tiling.hpp - Tiling library top level
 */
#pragma once

// Some data structures and an API function to make it easier to tile up and image for a PiSP-like pipeline.

#include <iostream>

#include "types.hpp"

namespace libpisp
{

constexpr int NumOutputBranches = 2;

struct Tile
{
	tiling::Region input;
	tiling::Region decompress;
	tiling::Region context;
	tiling::Region crop[NumOutputBranches];
	tiling::Region downscale[NumOutputBranches];
	tiling::Region resample[NumOutputBranches];
	tiling::Region output[NumOutputBranches];
};

struct TilingConfig
{
	tiling::Length2 input_image_size;
	tiling::Interval2 crop[NumOutputBranches];
	tiling::Length2 downscale_image_size[NumOutputBranches];
	tiling::Length2 output_image_size[NumOutputBranches];
	tiling::Length2 max_tile_size;
	tiling::Length2 min_tile_size;
	tiling::Length2 downscale_factor[NumOutputBranches];
	tiling::Length2 resample_factor[NumOutputBranches];
	bool output_h_mirror[NumOutputBranches];
	int resample_enables;
	int downscale_enables;
	bool compressed_input;
	tiling::Length2 input_alignment;
	tiling::Length2 output_max_alignment[NumOutputBranches]; // "preferred" alignment
	tiling::Length2 output_min_alignment[NumOutputBranches]; // "required" minimum alignment
};

inline std::ostream &operator<<(std::ostream &os, TilingConfig const &tc)
{
	os << "TilingConfig:" << std::endl;
	os << "\tinput_image_size " << tc.input_image_size << " align " << tc.input_alignment << std::endl;
	for (int i = 0; i < NumOutputBranches; i++)
	{
		os << "\tcrop[" << i << "] " << tc.crop[i] << std::endl;
		os << "\toutput_image_size[" << i << "] " << tc.output_image_size[i] << " align max "
		   << tc.output_max_alignment[i] << " min " << tc.output_min_alignment[i] << std::endl;
		os << "\tdownscale_image_size " << tc.downscale_image_size[i] << " downscale_factor " << tc.downscale_factor[i]
		   << " resample_factor " << tc.resample_factor[i] << std::endl;
	}
	os << "\tenables resample " << tc.resample_enables << " downscale " << tc.downscale_enables << std::endl;
	return os << "\tmax_tile_size " << tc.max_tile_size;
}

void tile_pipeline(TilingConfig const &config, Tile *tile, int num_tile, tiling::Length2 *grid);

} // namespace libpisp

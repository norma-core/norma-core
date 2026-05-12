
/* SPDX-License-Identifier: BSD-2-Clause */
/*
 * Copyright (C) 2021 - 2023, Raspberry Pi Ltd
 *
 * backend.hpp - PiSP backend implementation
 */
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <type_traits>
#include <utility>

#include "common/shm_mutex.hpp"
#include "tiling/pisp_tiling.hpp"
#include "variants/variant.hpp"

#include "pisp_be_config.h"

// Definition of the PiSP Back End class.

namespace libpisp
{

using TileArray = std::array<pisp_tile, PISP_BACK_END_NUM_TILES>;

// We use std::array<std::pair<.,.>> insead of std::map<.,.> to ensure this object provides a standard layout.
using YcbcrMap = std::array<std::pair<std::string, pisp_be_ccm_config>, 16>;
using ResampleMap = std::array<std::pair<std::string, pisp_be_resample_config>, 16>;
using ResampleList = std::array<std::pair<double, std::string>, 16>;

class BackEnd final
{
public:
	struct Config
	{
		enum Flags
		{
			NONE = 0,
			LOW_LATENCY = 1,	// Attempt to process image with lowest possible latency (no longer implemented)
			HIGH_PRIORITY = 2 	// Not currently implemented
		};

		Config(unsigned int _max_stripe_height = 0, unsigned int _max_tile_width = 0, unsigned int _flags = 0,
			   std::string _defaults_file = {})
			: max_stripe_height(_max_stripe_height), max_tile_width(_max_tile_width), flags(_flags),
			  defaults_file(_defaults_file)
		{
		}

		unsigned int max_stripe_height; // Use zero to get "default behaviour"
		unsigned int max_tile_width; // Can only go larger than h/w defined limit in simulations
		unsigned int flags; // An "or" of the Flags above
		std::string defaults_file; // json file for default IQ settings
	};

	struct SmartResize
	{
		uint16_t width = 0;
		uint16_t height = 0;
	};

	BackEnd(Config const &user_config, PiSPVariant const &variant);
	~BackEnd();

	void SetGlobal(pisp_be_global_config const &global);
	void GetGlobal(pisp_be_global_config &global) const;
	void SetInputFormat(pisp_image_format_config const &input_format);
	void GetInputFormat(pisp_image_format_config &input_format) const;
	void SetDecompress(pisp_decompress_config const &decompress);
	void GetDecompress(pisp_decompress_config &decompress) const;
	void SetDpc(pisp_be_dpc_config const &dpc);
	void GetDpc(pisp_be_dpc_config &dpc) const;
	void SetGeq(pisp_be_geq_config const &geq);
	void GetGeq(pisp_be_geq_config &geq) const;
	void SetTdnInputFormat(pisp_image_format_config const &tdn_input_format);
	void GetTdnInputFormat(pisp_image_format_config &tdn_input_format) const;
	void SetTdnDecompress(pisp_decompress_config const &tdn_decompress);
	void GetTdnDecompress(pisp_decompress_config &tdn_decompress) const;
	void SetTdn(pisp_be_tdn_config const &tdn);
	void GetTdn(pisp_be_tdn_config &tdn) const;
	void SetTdnCompress(pisp_compress_config const &tdn_compress);
	void GetTdnCompress(pisp_compress_config &tdn_compress) const;
	void SetTdnOutputFormat(pisp_image_format_config const &tdn_output_format);
	void GetTdnOutputFormat(pisp_image_format_config &tdn_output_format) const;
	void SetSdn(pisp_be_sdn_config const &sdn);
	void GetSdn(pisp_be_sdn_config &sdn) const;
	void SetBlc(pisp_bla_config const &blc);
	void GetBlc(pisp_bla_config &blc) const;
	void SetStitchInputFormat(pisp_image_format_config const &stitch_input_format);
	void GetStitchInputFormat(pisp_image_format_config &stitch_input_format) const;
	void SetStitchDecompress(pisp_decompress_config const &stitch_decompress);
	void GetStitchDecompress(pisp_decompress_config &stitch_decompress) const;
	void SetStitch(pisp_be_stitch_config const &stitch);
	void GetStitch(pisp_be_stitch_config &stitch) const;
	void SetStitchCompress(pisp_compress_config const &stitch_compress);
	void GetStitchCompress(pisp_compress_config &stitch_compress) const;
	void SetStitchOutputFormat(pisp_image_format_config const &stitch_output_format);
	void GetStitchOutputFormat(pisp_image_format_config &stitch_output_format) const;
	void SetWbg(pisp_wbg_config const &wbg);
	void GetWbg(pisp_wbg_config &wbg) const;
	void SetCdn(pisp_be_cdn_config const &cdn);
	void GetCdn(pisp_be_cdn_config &cdn) const;
	void SetLsc(pisp_be_lsc_config const &lsc, pisp_be_lsc_extra lsc_extra = { 0, 0 });
	void GetLsc(pisp_be_lsc_config &lsc, pisp_be_lsc_extra &lsc_extra) const;
	void SetCac(pisp_be_cac_config const &cac, pisp_be_cac_extra cac_extra = { 0, 0 });
	void GetCac(pisp_be_cac_config &cac, pisp_be_cac_extra &cac_extra) const;
	void SetDebin(pisp_be_debin_config const &debin);
	void GetDebin(pisp_be_debin_config &debin) const;
	void SetTonemap(pisp_be_tonemap_config const &tonemap);
	void GetTonemap(pisp_be_tonemap_config &tonemap) const;
	void SetDemosaic(pisp_be_demosaic_config const &demosaic);
	void GetDemosaic(pisp_be_demosaic_config &demosaic) const;
	void SetCcm(pisp_be_ccm_config const &ccm);
	void GetCcm(pisp_be_ccm_config &ccm) const;
	void SetSatControl(pisp_be_sat_control_config const &sat_control);
	void GetSatControl(pisp_be_sat_control_config &sat_control) const;
	void SetYcbcr(pisp_be_ccm_config const &ycbcr);
	void GetYcbcr(pisp_be_ccm_config &ccm) const;
	void SetFalseColour(pisp_be_false_colour_config const &false_colour);
	void GetFalseColour(pisp_be_false_colour_config &false_colour) const;
	void SetSharpen(pisp_be_sharpen_config const &sharpen);
	void GetSharpen(pisp_be_sharpen_config &sharpen) const;
	void SetShFcCombine(pisp_be_sh_fc_combine_config const &sh_fc_combine);
	void GetShFcCombine(pisp_be_sh_fc_combine_config &sh_fc_combine) const;
	void SetYcbcrInverse(pisp_be_ccm_config const &ycbcr_inverse);
	void GetYcbcrInverse(pisp_be_ccm_config &ycbcr_inverse) const;
	void SetGamma(pisp_be_gamma_config const &gamma);
	void GetGamma(pisp_be_gamma_config &gamma) const;
	void SetCrop(pisp_be_crop_config const &crop);
	void GetCrop(pisp_be_crop_config &crop) const;
	void SetCrop(unsigned int i, pisp_be_crop_config const &crop);
	void GetCrop(unsigned int i, pisp_be_crop_config &crop) const;
	void SetCsc(unsigned int i, pisp_be_ccm_config const &csc);
	void GetCsc(unsigned int i, pisp_be_ccm_config &csc) const;
	void SetOutputFormat(unsigned int i, pisp_be_output_format_config const &output_format);
	void GetOutputFormat(unsigned int i, pisp_be_output_format_config &output_format) const;
	void SetResample(unsigned int i, pisp_be_resample_config const &resample,
					 pisp_be_resample_extra const &resample_extra);
	void GetResample(unsigned int i, pisp_be_resample_config &resample,
					 pisp_be_resample_extra &resample_extra) const;
	void SetResample(unsigned int i, pisp_be_resample_extra const &resample_extra);
	void GetResample(unsigned int i, pisp_be_resample_extra &resample_extra) const;
	void SetDownscale(unsigned int i, pisp_be_downscale_config const &downscale,
					  pisp_be_downscale_extra const &downscale_extra);
	void GetDownscale(unsigned int i, pisp_be_downscale_config &downscale,
					  pisp_be_downscale_extra &downscale_extra) const;
	void SetDownscale(unsigned int i, pisp_be_downscale_extra const &downscale_extra);
	void GetDownscale(unsigned int i, pisp_be_downscale_extra &downscale_extra) const;

	void InitialiseYcbcr(pisp_be_ccm_config &ycbcr, const std::string &colour_space);
	void InitialiseYcbcrInverse(pisp_be_ccm_config &ycbcr_inverse, const std::string &colour_space);
	void InitialiseResample(pisp_be_resample_config &resample, const std::string &filter);
	void InitialiseResample(pisp_be_resample_config &resample, double downscale);
	void InitialiseSharpen(pisp_be_sharpen_config &sharpen, pisp_be_sh_fc_combine_config &shfc);

	void Prepare(pisp_be_tiles_config *config);

	bool ComputeOutputImageFormat(unsigned int i, pisp_image_format_config &output_format,
								  pisp_image_format_config const &input_format) const;

	void SetSmartResize(unsigned int i, SmartResize const &smart_resize);

	unsigned int GetMaxDownscale() const;

	std::string GetJsonConfig(pisp_be_tiles_config *config);
	void SetJsonConfig(const std::string &json_config);

	void SetMaxTileWidth(unsigned int width)
	{
		config_.max_tile_width = width;
	}

	void SetMaxStripeHeight(unsigned int height)
	{
		config_.max_stripe_height = height;
	}

	void lock()
	{
		mutex_.lock();
	}

	void unlock()
	{
		mutex_.unlock();
	}

	bool try_lock()
	{
		return mutex_.try_lock();
	}

private:
	struct BeConfigExtra
	{
		// Non-register fields:
		pisp_be_lsc_extra lsc;
		pisp_be_cac_extra cac;
		pisp_be_downscale_extra downscale[PISP_BACK_END_NUM_OUTPUTS];
		pisp_be_resample_extra resample[PISP_BACK_END_NUM_OUTPUTS];
		pisp_be_crop_config crop[PISP_BACK_END_NUM_OUTPUTS];
		uint32_t dirty_flags_bayer; //these use pisp_be_bayer_enable
		uint32_t dirty_flags_rgb; //use pisp_be_rgb_enable
		uint32_t dirty_flags_extra; //these use pisp_be_dirty_t
	};

	void finaliseConfig();
	void updateSmartResize();
	void updateTiles();
	TileArray retilePipeline(TilingConfig const &tiling_config);
	void finaliseTiling();
	void getOutputSize(int output_num, uint16_t *width, uint16_t *height, pisp_image_format_config const &ifmt) const;

	void initialiseDefaultConfig(const std::string &filename);

	Config config_;
	const PiSPVariant variant_;
	pisp_be_config be_config_;
	BeConfigExtra be_config_extra_;
	pisp_image_format_config max_input_;
	bool retile_;
	bool finalise_tiling_;
	TileArray tiles_;
	int num_tiles_x_, num_tiles_y_;
	mutable ShmMutex mutex_;
	std::array<SmartResize, PISP_BACK_END_NUM_OUTPUTS> smart_resize_;
	uint32_t smart_resize_dirty_;

	// Default config
	YcbcrMap ycbcr_map_;
	YcbcrMap inverse_ycbcr_map_;
	ResampleMap resample_filter_map_;
	ResampleList resample_select_list_;
	pisp_be_sharpen_config default_sharpen_;
	pisp_be_sh_fc_combine_config default_shfc_;
};

// This is required to ensure we can safely share a BackEnd object across multiple processes.
static_assert(std::is_standard_layout<BackEnd>::value, "BackEnd must be a standard layout type");

} // namespace libpisp

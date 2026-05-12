/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * libcamera Pixel Format
 */

#pragma once

#include <ostream>
#include <stdint.h>
#include <string>

namespace libcamera {

class PixelFormat
{
public:
	constexpr PixelFormat()
		: fourcc_(0), modifier_(0)
	{
	}

	explicit constexpr PixelFormat(uint32_t fourcc, uint64_t modifier = 0)
		: fourcc_(fourcc), modifier_(modifier)
	{
	}

	bool operator==(const PixelFormat &other) const;
	bool operator!=(const PixelFormat &other) const { return !(*this == other); }
	bool operator<(const PixelFormat &other) const;

	constexpr bool isValid() const { return fourcc_ != 0; }

	constexpr operator uint32_t() const { return fourcc_; }
	constexpr uint32_t fourcc() const { return fourcc_; }
	constexpr uint64_t modifier() const { return modifier_; }

	std::string toString() const;

	static PixelFormat fromString(const std::string &name);

private:
	uint32_t fourcc_;
	uint64_t modifier_;
};

std::ostream &operator<<(std::ostream &out, const PixelFormat &f);

} /* namespace libcamera */

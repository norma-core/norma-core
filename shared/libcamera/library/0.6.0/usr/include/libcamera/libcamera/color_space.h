/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2021, Raspberry Pi Ltd
 *
 * color space definitions
 */

#pragma once

#include <optional>
#include <string>

namespace libcamera {

class PixelFormat;

class ColorSpace
{
public:
	enum class Primaries {
		Raw,
		Smpte170m,
		Rec709,
		Rec2020,
	};

	enum class TransferFunction {
		Linear,
		Srgb,
		Rec709,
	};

	enum class YcbcrEncoding {
		None,
		Rec601,
		Rec709,
		Rec2020,
	};

	enum class Range {
		Full,
		Limited,
	};

	constexpr ColorSpace(Primaries p, TransferFunction t, YcbcrEncoding e, Range r)
		: primaries(p), transferFunction(t), ycbcrEncoding(e), range(r)
	{
	}

	static const ColorSpace Raw;
	static const ColorSpace Srgb;
	static const ColorSpace Sycc;
	static const ColorSpace Smpte170m;
	static const ColorSpace Rec709;
	static const ColorSpace Rec2020;

	Primaries primaries;
	TransferFunction transferFunction;
	YcbcrEncoding ycbcrEncoding;
	Range range;

	std::string toString() const;
	static std::string toString(const std::optional<ColorSpace> &colorSpace);

	static std::optional<ColorSpace> fromString(const std::string &str);

	bool adjust(PixelFormat format);
};

bool operator==(const ColorSpace &lhs, const ColorSpace &rhs);
static inline bool operator!=(const ColorSpace &lhs, const ColorSpace &rhs)
{
	return !(lhs == rhs);
}

} /* namespace libcamera */

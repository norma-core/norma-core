/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2020, Google Inc.
 *
 * Formats
 *
 * This file is auto-generated. Do not edit.
 */

#pragma once

#include <stdint.h>

#include <libcamera/pixel_format.h>

namespace libcamera {

namespace formats {

namespace {

constexpr uint32_t __fourcc(char a, char b, char c, char d)
{
	return (static_cast<uint32_t>(a) <<  0) |
	       (static_cast<uint32_t>(b) <<  8) |
	       (static_cast<uint32_t>(c) << 16) |
	       (static_cast<uint32_t>(d) << 24);
}

constexpr uint64_t __mod(unsigned int vendor, unsigned int mod)
{
	return (static_cast<uint64_t>(vendor) << 56) |
	       (static_cast<uint64_t>(mod) << 0);
}

constexpr uint32_t kDrmFormatBigEndian = uint32_t(1) << 31; /* DRM_FORMAT_BIG_ENDIAN */

} /* namespace */

constexpr PixelFormat R8(__fourcc('R', '8', ' ', ' '), __mod(0, 0));
constexpr PixelFormat R10(__fourcc('R', '1', '0', ' '), __mod(0, 0));
constexpr PixelFormat R12(__fourcc('R', '1', '2', ' '), __mod(0, 0));
constexpr PixelFormat R16(__fourcc('R', '1', '6', ' '), __mod(0, 0));
constexpr PixelFormat RGB565(__fourcc('R', 'G', '1', '6'), __mod(0, 0));
constexpr PixelFormat RGB565_BE(__fourcc('R', 'G', '1', '6') | kDrmFormatBigEndian, __mod(0, 0));
constexpr PixelFormat RGB888(__fourcc('R', 'G', '2', '4'), __mod(0, 0));
constexpr PixelFormat BGR888(__fourcc('B', 'G', '2', '4'), __mod(0, 0));
constexpr PixelFormat XRGB8888(__fourcc('X', 'R', '2', '4'), __mod(0, 0));
constexpr PixelFormat XBGR8888(__fourcc('X', 'B', '2', '4'), __mod(0, 0));
constexpr PixelFormat RGBX8888(__fourcc('R', 'X', '2', '4'), __mod(0, 0));
constexpr PixelFormat BGRX8888(__fourcc('B', 'X', '2', '4'), __mod(0, 0));
constexpr PixelFormat ARGB8888(__fourcc('A', 'R', '2', '4'), __mod(0, 0));
constexpr PixelFormat ABGR8888(__fourcc('A', 'B', '2', '4'), __mod(0, 0));
constexpr PixelFormat RGBA8888(__fourcc('R', 'A', '2', '4'), __mod(0, 0));
constexpr PixelFormat BGRA8888(__fourcc('B', 'A', '2', '4'), __mod(0, 0));
constexpr PixelFormat RGB161616(__fourcc('R', 'G', '4', '8'), __mod(0, 0));
constexpr PixelFormat BGR161616(__fourcc('B', 'G', '4', '8'), __mod(0, 0));
constexpr PixelFormat YUYV(__fourcc('Y', 'U', 'Y', 'V'), __mod(0, 0));
constexpr PixelFormat YVYU(__fourcc('Y', 'V', 'Y', 'U'), __mod(0, 0));
constexpr PixelFormat UYVY(__fourcc('U', 'Y', 'V', 'Y'), __mod(0, 0));
constexpr PixelFormat VYUY(__fourcc('V', 'Y', 'U', 'Y'), __mod(0, 0));
constexpr PixelFormat AVUY8888(__fourcc('A', 'V', 'U', 'Y'), __mod(0, 0));
constexpr PixelFormat XVUY8888(__fourcc('X', 'V', 'U', 'Y'), __mod(0, 0));
constexpr PixelFormat NV12(__fourcc('N', 'V', '1', '2'), __mod(0, 0));
constexpr PixelFormat NV21(__fourcc('N', 'V', '2', '1'), __mod(0, 0));
constexpr PixelFormat NV16(__fourcc('N', 'V', '1', '6'), __mod(0, 0));
constexpr PixelFormat NV61(__fourcc('N', 'V', '6', '1'), __mod(0, 0));
constexpr PixelFormat NV24(__fourcc('N', 'V', '2', '4'), __mod(0, 0));
constexpr PixelFormat NV42(__fourcc('N', 'V', '4', '2'), __mod(0, 0));
constexpr PixelFormat YUV420(__fourcc('Y', 'U', '1', '2'), __mod(0, 0));
constexpr PixelFormat YVU420(__fourcc('Y', 'V', '1', '2'), __mod(0, 0));
constexpr PixelFormat YUV422(__fourcc('Y', 'U', '1', '6'), __mod(0, 0));
constexpr PixelFormat YVU422(__fourcc('Y', 'V', '1', '6'), __mod(0, 0));
constexpr PixelFormat YUV444(__fourcc('Y', 'U', '2', '4'), __mod(0, 0));
constexpr PixelFormat YVU444(__fourcc('Y', 'V', '2', '4'), __mod(0, 0));
constexpr PixelFormat MJPEG(__fourcc('M', 'J', 'P', 'G'), __mod(0, 0));
constexpr PixelFormat SRGGB8(__fourcc('R', 'G', 'G', 'B'), __mod(0, 0));
constexpr PixelFormat SGRBG8(__fourcc('G', 'R', 'B', 'G'), __mod(0, 0));
constexpr PixelFormat SGBRG8(__fourcc('G', 'B', 'R', 'G'), __mod(0, 0));
constexpr PixelFormat SBGGR8(__fourcc('B', 'A', '8', '1'), __mod(0, 0));
constexpr PixelFormat SRGGB10(__fourcc('R', 'G', '1', '0'), __mod(0, 0));
constexpr PixelFormat SGRBG10(__fourcc('B', 'A', '1', '0'), __mod(0, 0));
constexpr PixelFormat SGBRG10(__fourcc('G', 'B', '1', '0'), __mod(0, 0));
constexpr PixelFormat SBGGR10(__fourcc('B', 'G', '1', '0'), __mod(0, 0));
constexpr PixelFormat SRGGB12(__fourcc('R', 'G', '1', '2'), __mod(0, 0));
constexpr PixelFormat SGRBG12(__fourcc('B', 'A', '1', '2'), __mod(0, 0));
constexpr PixelFormat SGBRG12(__fourcc('G', 'B', '1', '2'), __mod(0, 0));
constexpr PixelFormat SBGGR12(__fourcc('B', 'G', '1', '2'), __mod(0, 0));
constexpr PixelFormat SRGGB14(__fourcc('R', 'G', '1', '4'), __mod(0, 0));
constexpr PixelFormat SGRBG14(__fourcc('B', 'A', '1', '4'), __mod(0, 0));
constexpr PixelFormat SGBRG14(__fourcc('G', 'B', '1', '4'), __mod(0, 0));
constexpr PixelFormat SBGGR14(__fourcc('B', 'G', '1', '4'), __mod(0, 0));
constexpr PixelFormat SRGGB16(__fourcc('R', 'G', 'B', '6'), __mod(0, 0));
constexpr PixelFormat SGRBG16(__fourcc('G', 'R', '1', '6'), __mod(0, 0));
constexpr PixelFormat SGBRG16(__fourcc('G', 'B', '1', '6'), __mod(0, 0));
constexpr PixelFormat SBGGR16(__fourcc('B', 'Y', 'R', '2'), __mod(0, 0));
constexpr PixelFormat R10_CSI2P(__fourcc('R', '1', '0', ' '), __mod(11, 1));
constexpr PixelFormat R12_CSI2P(__fourcc('R', '1', '2', ' '), __mod(11, 1));
constexpr PixelFormat SRGGB10_CSI2P(__fourcc('R', 'G', '1', '0'), __mod(11, 1));
constexpr PixelFormat SGRBG10_CSI2P(__fourcc('B', 'A', '1', '0'), __mod(11, 1));
constexpr PixelFormat SGBRG10_CSI2P(__fourcc('G', 'B', '1', '0'), __mod(11, 1));
constexpr PixelFormat SBGGR10_CSI2P(__fourcc('B', 'G', '1', '0'), __mod(11, 1));
constexpr PixelFormat SRGGB12_CSI2P(__fourcc('R', 'G', '1', '2'), __mod(11, 1));
constexpr PixelFormat SGRBG12_CSI2P(__fourcc('B', 'A', '1', '2'), __mod(11, 1));
constexpr PixelFormat SGBRG12_CSI2P(__fourcc('G', 'B', '1', '2'), __mod(11, 1));
constexpr PixelFormat SBGGR12_CSI2P(__fourcc('B', 'G', '1', '2'), __mod(11, 1));
constexpr PixelFormat SRGGB14_CSI2P(__fourcc('R', 'G', '1', '4'), __mod(11, 1));
constexpr PixelFormat SGRBG14_CSI2P(__fourcc('B', 'A', '1', '4'), __mod(11, 1));
constexpr PixelFormat SGBRG14_CSI2P(__fourcc('G', 'B', '1', '4'), __mod(11, 1));
constexpr PixelFormat SBGGR14_CSI2P(__fourcc('B', 'G', '1', '4'), __mod(11, 1));
constexpr PixelFormat SRGGB10_IPU3(__fourcc('R', 'G', '1', '0'), __mod(1, 13));
constexpr PixelFormat SGRBG10_IPU3(__fourcc('B', 'A', '1', '0'), __mod(1, 13));
constexpr PixelFormat SGBRG10_IPU3(__fourcc('G', 'B', '1', '0'), __mod(1, 13));
constexpr PixelFormat SBGGR10_IPU3(__fourcc('B', 'G', '1', '0'), __mod(1, 13));
constexpr PixelFormat RGGB_PISP_COMP1(__fourcc('R', 'G', 'B', '6'), __mod(12, 1));
constexpr PixelFormat GRBG_PISP_COMP1(__fourcc('G', 'R', '1', '6'), __mod(12, 1));
constexpr PixelFormat GBRG_PISP_COMP1(__fourcc('G', 'B', '1', '6'), __mod(12, 1));
constexpr PixelFormat BGGR_PISP_COMP1(__fourcc('B', 'Y', 'R', '2'), __mod(12, 1));
constexpr PixelFormat MONO_PISP_COMP1(__fourcc('R', '1', '6', ' '), __mod(12, 1));


} /* namespace formats */

} /* namespace libcamera */
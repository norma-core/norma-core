/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2020, Raspberry Pi Ltd
 *
 * 2D plane transforms
 */

#pragma once

namespace libcamera {

enum class Orientation;

enum class Transform : int {
	Identity = 0,
	Rot0 = Identity,
	HFlip = 1,
	VFlip = 2,
	HVFlip = HFlip | VFlip,
	Rot180 = HVFlip,
	Transpose = 4,
	Rot270 = HFlip | Transpose,
	Rot90 = VFlip | Transpose,
	Rot180Transpose = HFlip | VFlip | Transpose
};

constexpr Transform operator&(Transform t0, Transform t1)
{
	return static_cast<Transform>(static_cast<int>(t0) & static_cast<int>(t1));
}

constexpr Transform operator|(Transform t0, Transform t1)
{
	return static_cast<Transform>(static_cast<int>(t0) | static_cast<int>(t1));
}

constexpr Transform operator^(Transform t0, Transform t1)
{
	return static_cast<Transform>(static_cast<int>(t0) ^ static_cast<int>(t1));
}

constexpr Transform &operator&=(Transform &t0, Transform t1)
{
	return t0 = t0 & t1;
}

constexpr Transform &operator|=(Transform &t0, Transform t1)
{
	return t0 = t0 | t1;
}

constexpr Transform &operator^=(Transform &t0, Transform t1)
{
	return t0 = t0 ^ t1;
}

Transform operator*(Transform t0, Transform t1);

Transform operator-(Transform t);

constexpr bool operator!(Transform t)
{
	return t == Transform::Identity;
}

constexpr Transform operator~(Transform t)
{
	return static_cast<Transform>(~static_cast<int>(t) & 7);
}

Transform transformFromRotation(int angle, bool *success = nullptr);

Transform operator/(const Orientation &o1, const Orientation &o2);
Orientation operator*(const Orientation &o, const Transform &t);

const char *transformToString(Transform t);

} /* namespace libcamera */

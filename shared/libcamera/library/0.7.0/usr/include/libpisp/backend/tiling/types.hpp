/* SPDX-License-Identifier: BSD-2-Clause */
/*
 * Copyright (C) 2021 - 2023, Raspberry Pi Ltd
 *
 * types.hpp - Tiling library type definitions
 */
#pragma once

#include <iostream>

namespace tiling
{

enum class Dir
{
	X = 0,
	Y = 1
};

inline std::ostream &operator<<(std::ostream &os, Dir dir)
{
	return os << (dir == Dir::X ? "X" : "Y");
}

struct Length2
{
	Length2() : Length2(0, 0) {}
	Length2(int _dx, int _dy) : dx(_dx), dy(_dy) {}
	explicit Length2(int len) : Length2(len, len) {}
	int dx, dy;
	int operator[](Dir dir) const { return dir == Dir::Y ? dy : dx; }
	Length2 operator-(Length2 const &other) { return Length2(dx - other.dx, dy - other.dy); }
	Length2 operator/(int num) { return Length2(dx / num, dy / num); }
};

inline std::ostream &operator<<(std::ostream &os, Length2 const &l)
{
	return os << "(" << l.dx << ", " << l.dy << ")";
}

struct Crop
{
	Crop() : Crop(0, 0) {}
	Crop(int _start, int _end) : start(_start), end(_end) {}
	explicit Crop(int crop) : Crop(crop, crop) {}
	int start, end;
	Crop operator+(Crop const &other) { return Crop(start + other.start, end + other.end); }
};

inline std::ostream &operator<<(std::ostream &os, Crop const &c)
{
	return os << "<s " << c.start << " e " << c.end << ">";
}

struct Interval
{
	Interval() : Interval(0, 0) {}
	Interval(int _offset, int _length) : offset(_offset), length(_length) {}
	explicit Interval(int _offset) : offset(_offset), length(0) {}
	int offset, length;
	int End() const { return offset + length; }
	void SetStart(int start) { length += (offset - start), offset = start; } // leave End unchanged
	void SetEnd(int end) { length = end - offset; }
	bool operator==(Interval const &other) { return offset == other.offset && length == other.length; }
	Interval operator-(Crop const &crop) const { return Interval(offset - crop.start, length - crop.start - crop.end); }
	Crop operator-(Interval const &other) { return Crop(other.offset - offset, End() - other.End()); }
	bool operator>(Interval const &other) { return offset <= other.offset && End() >= other.End(); } // contains
	bool operator<(Interval const &other) { return offset >= other.offset && End() <= other.End(); } // is contained
	Interval &operator|=(int off)
	{
		if (off < offset)
			SetStart(off);
		else if (off > End())
			SetEnd(off);
		return *this;
	}
};

inline std::ostream &operator<<(std::ostream &os, Interval const &i)
{
	return os << "[off " << i.offset << " len " << i.length << "]";
}

struct Crop2
{
	Crop2() {}
	Crop2(Crop const &_x, Crop const &_y) : x(_x), y(_y) {}
	Crop x, y;
	Crop operator[](Dir dir) const { return dir == Dir::Y ? y : x; }
	Crop &operator[](Dir dir) { return dir == Dir::Y ? y : x; }
	Crop2 operator+(Crop2 const &other) { return Crop2(x + other.x, y + other.y); }
};

inline std::ostream &operator<<(std::ostream &os, Crop2 const &c)
{
	return os << "< X " << c.x << " Y " << c.y << " >";
}

struct Interval2
{
	Interval2() {}
	Interval2(Interval const &_x, Interval const &_y) : x(_x), y(_y) {}
	Interval2(Length2 const &offset, Length2 const &size) : x(offset.dx, size.dx), y(offset.dy, size.dy) {}
	Interval x, y;
	Interval operator[](Dir dir) const { return dir == Dir::Y ? y : x; }
	Interval &operator[](Dir dir) { return dir == Dir::Y ? y : x; }
	bool operator==(Interval2 const &other) { return x == other.x && y == other.y; }
	bool operator!=(Interval2 const &other) { return !(*this == other); }
};

inline std::ostream &operator<<(std::ostream &os, Interval2 const &i)
{
	return os << "[ X " << i.x << " Y " << i.y << " ]";
}

struct Region
{
	Interval2 input;
	Crop2 crop;
	Interval2 output;
};

inline std::ostream &operator<<(std::ostream &os, Region const &r)
{
	os << "\t{ input " << r.input << std::endl;
	os << "\t   crop " << r.crop << std::endl;
	os << "\t output " << r.output << " }";
	return os;
}

} // namespace tiling
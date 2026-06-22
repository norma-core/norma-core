/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2020, Google Inc.
 *
 * Type-safe enum-based bitfields
 */

#pragma once

#include <type_traits>

namespace libcamera {

template<typename E>
class Flags
{
public:
	static_assert(std::is_enum<E>::value,
		      "Flags<> template parameter must be an enum");

	using Type = std::underlying_type_t<E>;

	constexpr Flags()
		: value_(0)
	{
	}

	constexpr Flags(E flag)
		: value_(static_cast<Type>(flag))
	{
	}

	constexpr Flags &operator&=(E flag)
	{
		value_ &= static_cast<Type>(flag);
		return *this;
	}

	constexpr Flags &operator&=(Flags other)
	{
		value_ &= other.value_;
		return *this;
	}

	constexpr Flags &operator|=(E flag)
	{
		value_ |= static_cast<Type>(flag);
		return *this;
	}

	constexpr Flags &operator|=(Flags other)
	{
		value_ |= other.value_;
		return *this;
	}

	constexpr Flags &operator^=(E flag)
	{
		value_ ^= static_cast<Type>(flag);
		return *this;
	}

	constexpr Flags &operator^=(Flags other)
	{
		value_ ^= other.value_;
		return *this;
	}

	constexpr bool operator==(E flag)
	{
		return value_ == static_cast<Type>(flag);
	}

	constexpr bool operator==(Flags other)
	{
		return value_ == static_cast<Type>(other);
	}

	constexpr bool operator!=(E flag)
	{
		return value_ != static_cast<Type>(flag);
	}

	constexpr bool operator!=(Flags other)
	{
		return value_ != static_cast<Type>(other);
	}

	constexpr explicit operator Type() const
	{
		return value_;
	}

	constexpr explicit operator bool() const
	{
		return !!value_;
	}

	constexpr Flags operator&(E flag) const
	{
		return Flags(static_cast<E>(value_ & static_cast<Type>(flag)));
	}

	constexpr Flags operator&(Flags other) const
	{
		return Flags(static_cast<E>(value_ & other.value_));
	}

	constexpr Flags operator|(E flag) const
	{
		return Flags(static_cast<E>(value_ | static_cast<Type>(flag)));
	}

	constexpr Flags operator|(Flags other) const
	{
		return Flags(static_cast<E>(value_ | other.value_));
	}

	constexpr Flags operator^(E flag) const
	{
		return Flags(static_cast<E>(value_ ^ static_cast<Type>(flag)));
	}

	constexpr Flags operator^(Flags other) const
	{
		return Flags(static_cast<E>(value_ ^ other.value_));
	}

	constexpr Flags operator~() const
	{
		return Flags(static_cast<E>(~value_));
	}

	constexpr bool operator!() const
	{
		return !value_;
	}

private:
	Type value_;
};

#ifndef __DOXYGEN__
template<typename E>
struct flags_enable_operators {
	static const bool enable = false;
};

template<typename E>
std::enable_if_t<flags_enable_operators<E>::enable, Flags<E>>
operator|(E lhs, E rhs)
{
	using type = std::underlying_type_t<E>;
	return Flags<E>(static_cast<E>(static_cast<type>(lhs) | static_cast<type>(rhs)));
}

template<typename E>
std::enable_if_t<flags_enable_operators<E>::enable, Flags<E>>
operator&(E lhs, E rhs)
{
	using type = std::underlying_type_t<E>;
	return Flags<E>(static_cast<E>(static_cast<type>(lhs) & static_cast<type>(rhs)));
}

template<typename E>
std::enable_if_t<flags_enable_operators<E>::enable, Flags<E>>
operator^(E lhs, E rhs)
{
	using type = std::underlying_type_t<E>;
	return Flags<E>(static_cast<E>(static_cast<type>(lhs) ^ static_cast<type>(rhs)));
}

template<typename E>
std::enable_if_t<flags_enable_operators<E>::enable, Flags<E>>
operator~(E rhs)
{
	using type = std::underlying_type_t<E>;
	return Flags<E>(static_cast<E>(~static_cast<type>(rhs)));
}

#define LIBCAMERA_FLAGS_ENABLE_OPERATORS(_enum)				\
template<>								\
struct flags_enable_operators<_enum> {					\
	static const bool enable = true;				\
};

#else /* __DOXYGEN__ */

#define LIBCAMERA_FLAGS_ENABLE_OPERATORS(_enum)

#endif /* __DOXYGEN__ */

} /* namespace libcamera */

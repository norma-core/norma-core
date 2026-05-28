/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2020, Google Inc.
 *
 * C++20 std::span<> implementation for C++11
 */

#pragma once

#include <array>
#include <iterator>
#include <limits>
#include <type_traits>

namespace libcamera {

static constexpr std::size_t dynamic_extent = std::numeric_limits<std::size_t>::max();

template<typename T, std::size_t Extent = dynamic_extent>
class Span;

namespace details {

template<typename U>
struct is_array : public std::false_type {
};

template<typename U, std::size_t N>
struct is_array<std::array<U, N>> : public std::true_type {
};

template<typename U>
struct is_span : public std::false_type {
};

template<typename U, std::size_t Extent>
struct is_span<Span<U, Extent>> : public std::true_type {
};

} /* namespace details */

namespace utils {

template<typename C>
constexpr auto size(const C &c) -> decltype(c.size())
{
	return c.size();
}

template<typename C>
constexpr auto data(const C &c) -> decltype(c.data())
{
	return c.data();
}

template<typename C>
constexpr auto data(C &c) -> decltype(c.data())
{
	return c.data();
}

template<class T, std::size_t N>
constexpr T *data(T (&array)[N]) noexcept
{
	return array;
}

template<std::size_t I, typename T>
struct tuple_element;

template<std::size_t I, typename T, std::size_t N>
struct tuple_element<I, Span<T, N>> {
	using type = T;
};

template<typename T>
struct tuple_size;

template<typename T, std::size_t N>
struct tuple_size<Span<T, N>> : public std::integral_constant<std::size_t, N> {
};

template<typename T>
struct tuple_size<Span<T, dynamic_extent>>;

} /* namespace utils */

template<typename T, std::size_t Extent>
class Span
{
public:
	using element_type = T;
	using value_type = typename std::remove_cv_t<T>;
	using size_type = std::size_t;
	using difference_type = std::ptrdiff_t;
	using pointer = T *;
	using const_pointer = const T *;
	using reference = T &;
	using const_reference = const T &;
	using iterator = pointer;
	using const_iterator = const_pointer;
	using reverse_iterator = std::reverse_iterator<iterator>;
	using const_reverse_iterator = std::reverse_iterator<const_iterator>;

	static constexpr std::size_t extent = Extent;

	template<bool Dependent = false,
		 typename = std::enable_if_t<Dependent || Extent == 0>>
	constexpr Span() noexcept
		: data_(nullptr)
	{
	}

	explicit constexpr Span(pointer ptr, [[maybe_unused]] size_type count)
		: data_(ptr)
	{
	}

	explicit constexpr Span(pointer first, [[maybe_unused]] pointer last)
		: data_(first)
	{
	}

	template<std::size_t N>
	constexpr Span(element_type (&arr)[N],
		       std::enable_if_t<std::is_convertible<std::remove_pointer_t<decltype(utils::data(arr))> (*)[],
							    element_type (*)[]>::value &&
					N == Extent,
					std::nullptr_t> = nullptr) noexcept
		: data_(arr)
	{
	}

	template<std::size_t N>
	constexpr Span(std::array<value_type, N> &arr,
		       std::enable_if_t<std::is_convertible<std::remove_pointer_t<decltype(utils::data(arr))> (*)[],
							    element_type (*)[]>::value &&
					N == Extent,
					std::nullptr_t> = nullptr) noexcept
		: data_(arr.data())
	{
	}

	template<std::size_t N>
	constexpr Span(const std::array<value_type, N> &arr,
		       std::enable_if_t<std::is_convertible<std::remove_pointer_t<decltype(utils::data(arr))> (*)[],
							    element_type (*)[]>::value &&
					N == Extent,
					std::nullptr_t> = nullptr) noexcept
		: data_(arr.data())
	{
	}

	template<class Container>
	explicit constexpr Span(Container &cont,
				std::enable_if_t<!details::is_span<Container>::value &&
						 !details::is_array<Container>::value &&
						 !std::is_array<Container>::value &&
						 std::is_convertible<std::remove_pointer_t<decltype(utils::data(cont))> (*)[],
								     element_type (*)[]>::value,
						 std::nullptr_t> = nullptr)
		: data_(utils::data(cont))
	{
	}

	template<class Container>
	explicit constexpr Span(const Container &cont,
				std::enable_if_t<!details::is_span<Container>::value &&
						 !details::is_array<Container>::value &&
						 !std::is_array<Container>::value &&
						 std::is_convertible<std::remove_pointer_t<decltype(utils::data(cont))> (*)[],
								     element_type (*)[]>::value,
						 std::nullptr_t> = nullptr)
		: data_(utils::data(cont))
	{
		static_assert(utils::size(cont) == Extent, "Size mismatch");
	}

	template<class U, std::size_t N>
	explicit constexpr Span(const Span<U, N> &s,
				std::enable_if_t<std::is_convertible<U (*)[], element_type (*)[]>::value &&
						 N == Extent,
						 std::nullptr_t> = nullptr) noexcept
		: data_(s.data())
	{
	}

	constexpr Span(const Span &other) noexcept = default;
	constexpr Span &operator=(const Span &other) noexcept = default;

	constexpr iterator begin() const { return data(); }
	constexpr const_iterator cbegin() const { return begin(); }
	constexpr iterator end() const { return data() + size(); }
	constexpr const_iterator cend() const { return end(); }
	constexpr reverse_iterator rbegin() const { return reverse_iterator(end()); }
	constexpr const_reverse_iterator crbegin() const { return rbegin(); }
	constexpr reverse_iterator rend() const { return reverse_iterator(begin()); }
	constexpr const_reverse_iterator crend() const { return rend(); }

	constexpr reference front() const { return *data(); }
	constexpr reference back() const { return *(data() + size() - 1); }
	constexpr reference operator[](size_type idx) const { return data()[idx]; }
	constexpr pointer data() const noexcept { return data_; }

	constexpr size_type size() const noexcept { return Extent; }
	constexpr size_type size_bytes() const noexcept { return size() * sizeof(element_type); }
	constexpr bool empty() const noexcept { return size() == 0; }

	template<std::size_t Count>
	constexpr Span<element_type, Count> first() const
	{
		static_assert(Count <= Extent, "Count larger than size");
		return Span<element_type, Count>{ data(), Count };
	}

	constexpr Span<element_type, dynamic_extent> first(std::size_t Count) const
	{
		return Span<element_type, dynamic_extent>{ data(), Count };
	}

	template<std::size_t Count>
	constexpr Span<element_type, Count> last() const
	{
		static_assert(Count <= Extent, "Count larger than size");
		return Span<element_type, Count>{ data() + size() - Count, Count };
	}

	constexpr Span<element_type, dynamic_extent> last(std::size_t Count) const
	{
		return Span<element_type, dynamic_extent>{ data() + size() - Count, Count };
	}

	template<std::size_t Offset, std::size_t Count = dynamic_extent>
	constexpr Span<element_type, Count != dynamic_extent ? Count : Extent - Offset> subspan() const
	{
		static_assert(Offset <= Extent, "Offset larger than size");
		static_assert(Count == dynamic_extent || Count + Offset <= Extent,
			      "Offset + Count larger than size");
		return Span<element_type, Count != dynamic_extent ? Count : Extent - Offset>{
			data() + Offset,
			Count == dynamic_extent ? size() - Offset : Count
		};
	}

	constexpr Span<element_type, dynamic_extent>
	subspan(std::size_t Offset, std::size_t Count = dynamic_extent) const
	{
		return Span<element_type, dynamic_extent>{
			data() + Offset,
			Count == dynamic_extent ? size() - Offset : Count
		};
	}

private:
	pointer data_;
};

template<typename T>
class Span<T, dynamic_extent>
{
public:
	using element_type = T;
	using value_type = typename std::remove_cv_t<T>;
	using size_type = std::size_t;
	using difference_type = std::ptrdiff_t;
	using pointer = T *;
	using const_pointer = const T *;
	using reference = T &;
	using const_reference = const T &;
	using iterator = T *;
	using const_iterator = const T *;
	using reverse_iterator = std::reverse_iterator<iterator>;
	using const_reverse_iterator = std::reverse_iterator<const_iterator>;

	static constexpr std::size_t extent = dynamic_extent;

	constexpr Span() noexcept
		: data_(nullptr), size_(0)
	{
	}

	constexpr Span(pointer ptr, size_type count)
		: data_(ptr), size_(count)
	{
	}

	constexpr Span(pointer first, pointer last)
		: data_(first), size_(last - first)
	{
	}

	template<std::size_t N>
	constexpr Span(element_type (&arr)[N],
		       std::enable_if_t<std::is_convertible<std::remove_pointer_t<decltype(utils::data(arr))> (*)[],
							    element_type (*)[]>::value,
					std::nullptr_t> = nullptr) noexcept
		: data_(arr), size_(N)
	{
	}

	template<std::size_t N>
	constexpr Span(std::array<value_type, N> &arr,
		       std::enable_if_t<std::is_convertible<std::remove_pointer_t<decltype(utils::data(arr))> (*)[],
							    element_type (*)[]>::value,
					std::nullptr_t> = nullptr) noexcept
		: data_(utils::data(arr)), size_(N)
	{
	}

	template<std::size_t N>
	constexpr Span(const std::array<value_type, N> &arr) noexcept
		: data_(utils::data(arr)), size_(N)
	{
	}

	template<class Container>
	constexpr Span(Container &cont,
		       std::enable_if_t<!details::is_span<Container>::value &&
					!details::is_array<Container>::value &&
					!std::is_array<Container>::value &&
					std::is_convertible<std::remove_pointer_t<decltype(utils::data(cont))> (*)[],
							    element_type (*)[]>::value,
					std::nullptr_t> = nullptr)
		: data_(utils::data(cont)), size_(utils::size(cont))
	{
	}

	template<class Container>
	constexpr Span(const Container &cont,
		       std::enable_if_t<!details::is_span<Container>::value &&
					!details::is_array<Container>::value &&
					!std::is_array<Container>::value &&
					std::is_convertible<std::remove_pointer_t<decltype(utils::data(cont))> (*)[],
							    element_type (*)[]>::value,
					std::nullptr_t> = nullptr)
		: data_(utils::data(cont)), size_(utils::size(cont))
	{
	}

	template<class U, std::size_t N>
	constexpr Span(const Span<U, N> &s,
		       std::enable_if_t<std::is_convertible<U (*)[], element_type (*)[]>::value,
					std::nullptr_t> = nullptr) noexcept
		: data_(s.data()), size_(s.size())
	{
	}

	constexpr Span(const Span &other) noexcept = default;
	constexpr Span &operator=(const Span &other) noexcept = default;

	constexpr iterator begin() const { return data(); }
	constexpr const_iterator cbegin() const { return begin(); }
	constexpr iterator end() const { return data() + size(); }
	constexpr const_iterator cend() const { return end(); }
	constexpr reverse_iterator rbegin() const { return reverse_iterator(end()); }
	constexpr const_reverse_iterator crbegin() const { return rbegin(); }
	constexpr reverse_iterator rend() const { return reverse_iterator(begin()); }
	constexpr const_reverse_iterator crend() const { return rend(); }

	constexpr reference front() const { return *data(); }
	constexpr reference back() const { return *(data() + size() - 1); }
	constexpr reference operator[](size_type idx) const { return data()[idx]; }
	constexpr pointer data() const noexcept { return data_; }

	constexpr size_type size() const noexcept { return size_; }
	constexpr size_type size_bytes() const noexcept { return size() * sizeof(element_type); }
	constexpr bool empty() const noexcept { return size() == 0; }

	template<std::size_t Count>
	constexpr Span<element_type, Count> first() const
	{
		return Span<element_type, Count>{ data(), Count };
	}

	constexpr Span<element_type, dynamic_extent> first(std::size_t Count) const
	{
		return { data(), Count };
	}

	template<std::size_t Count>
	constexpr Span<element_type, Count> last() const
	{
		return Span<element_type, Count>{ data() + size() - Count, Count };
	}

	constexpr Span<element_type, dynamic_extent> last(std::size_t Count) const
	{
		return Span<element_type, dynamic_extent>{ data() + size() - Count, Count };
	}

	template<std::size_t Offset, std::size_t Count = dynamic_extent>
	constexpr Span<element_type, Count> subspan() const
	{
		return Span<element_type, Count>{
			data() + Offset,
			Count == dynamic_extent ? size() - Offset : Count
		};
	}

	constexpr Span<element_type, dynamic_extent>
	subspan(std::size_t Offset, std::size_t Count = dynamic_extent) const
	{
		return Span<element_type, dynamic_extent>{
			data() + Offset,
			Count == dynamic_extent ? size() - Offset : Count
		};
	}

private:
	pointer data_;
	size_type size_;
};

} /* namespace libcamera */

/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2020, Google Inc.
 *
 * Utilities and helpers for classes
 */

#pragma once

#include <memory>

namespace libcamera {

#ifndef __DOXYGEN__
#define LIBCAMERA_DISABLE_COPY(klass)  \
	klass(const klass &) = delete; \
	klass &operator=(const klass &) = delete;

#define LIBCAMERA_DISABLE_MOVE(klass) \
	klass(klass &&) = delete;     \
	klass &operator=(klass &&) = delete;

#define LIBCAMERA_DISABLE_COPY_AND_MOVE(klass) \
	LIBCAMERA_DISABLE_COPY(klass)          \
	LIBCAMERA_DISABLE_MOVE(klass)
#else
#define LIBCAMERA_DISABLE_COPY(klass)
#define LIBCAMERA_DISABLE_MOVE(klass)
#define LIBCAMERA_DISABLE_COPY_AND_MOVE(klass)
#endif

#ifndef __DOXYGEN__
#define LIBCAMERA_DECLARE_PRIVATE()					\
public:									\
	class Private;							\
	friend class Private;						\
	template <bool B = true>					\
	const Private *_d() const					\
	{								\
		return Extensible::_d<Private>();			\
	}								\
	template <bool B = true>					\
	Private *_d()							\
	{								\
		return Extensible::_d<Private>();			\
	}

#define LIBCAMERA_DECLARE_PUBLIC(klass)					\
	friend class klass;						\
	using Public = klass;

#define LIBCAMERA_O_PTR()						\
	_o<Public>()

#else
#define LIBCAMERA_DECLARE_PRIVATE()
#define LIBCAMERA_DECLARE_PUBLIC(klass)
#define LIBCAMERA_O_PTR()
#endif

class Extensible
{
public:
	class Private
	{
	public:
		Private();
		virtual ~Private();

#ifndef __DOXYGEN__
		template<typename T>
		const T *_o() const
		{
			return static_cast<const T *>(o_);
		}

		template<typename T>
		T *_o()
		{
			return static_cast<T *>(o_);
		}
#endif

	private:
		/* To initialize o_ from Extensible. */
		friend class Extensible;
		Extensible *const o_;
	};

	Extensible(std::unique_ptr<Private> d);

protected:
	template<typename T>
	const T *_d() const
	{
		return static_cast<const T *>(d_.get());
	}

	template<typename T>
	T *_d()
	{
		return static_cast<T *>(d_.get());
	}

private:
	const std::unique_ptr<Private> d_;
};

} /* namespace libcamera */

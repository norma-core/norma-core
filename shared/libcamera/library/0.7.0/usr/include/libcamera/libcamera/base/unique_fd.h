/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2021, Google Inc.
 *
 * File descriptor wrapper that owns a file descriptor.
 */

#pragma once

#include <utility>

#include <libcamera/base/class.h>

namespace libcamera {

class UniqueFD final
{
public:
	UniqueFD()
		: fd_(-1)
	{
	}

	explicit UniqueFD(int fd)
		: fd_(fd)
	{
	}

	UniqueFD(UniqueFD &&other)
		: fd_(other.release())
	{
	}

	~UniqueFD()
	{
		reset();
	}

	UniqueFD &operator=(UniqueFD &&other)
	{
		reset(other.release());
		return *this;
	}

	[[nodiscard]] int release()
	{
		int fd = fd_;
		fd_ = -1;
		return fd;
	}

	void reset(int fd = -1);

	void swap(UniqueFD &other)
	{
		std::swap(fd_, other.fd_);
	}

	int get() const { return fd_; }
	bool isValid() const { return fd_ >= 0; }

private:
	LIBCAMERA_DISABLE_COPY(UniqueFD)

	int fd_;
};

} /* namespace libcamera */

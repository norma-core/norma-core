/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2021, Google Inc.
 *
 * Synchronization fence
 */

#pragma once

#include <libcamera/base/class.h>
#include <libcamera/base/unique_fd.h>

namespace libcamera {

class Fence
{
public:
	Fence(UniqueFD fd);

	bool isValid() const { return fd_.isValid(); }
	const UniqueFD &fd() const { return fd_; }

	UniqueFD release() { return std::move(fd_); }

private:
	LIBCAMERA_DISABLE_COPY_AND_MOVE(Fence)

	UniqueFD fd_;
};

} /* namespace libcamera */

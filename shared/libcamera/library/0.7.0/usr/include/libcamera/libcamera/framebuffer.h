/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * Frame buffer handling
 */

#pragma once

#include <limits>
#include <memory>
#include <stdint.h>
#include <vector>

#include <libcamera/base/class.h>
#include <libcamera/base/shared_fd.h>
#include <libcamera/base/span.h>

namespace libcamera {

class Fence;
class Request;

struct FrameMetadata {
	enum Status {
		FrameSuccess,
		FrameError,
		FrameCancelled,
		FrameStartup,
	};

	struct Plane {
		unsigned int bytesused;
	};

	Status status;
	unsigned int sequence;
	uint64_t timestamp;

	Span<Plane> planes() { return planes_; }
	Span<const Plane> planes() const { return planes_; }

private:
	friend class FrameBuffer;

	std::vector<Plane> planes_;
};

class FrameBuffer : public Extensible
{
	LIBCAMERA_DECLARE_PRIVATE()

public:
	struct Plane {
		static constexpr unsigned int kInvalidOffset = std::numeric_limits<unsigned int>::max();
		SharedFD fd;
		unsigned int offset = kInvalidOffset;
		unsigned int length;
	};

	FrameBuffer(Span<const Plane> planes, unsigned int cookie = 0);
	FrameBuffer(std::unique_ptr<Private> d);
	virtual ~FrameBuffer() {}

	Span<const Plane> planes() const;
	Request *request() const;
	const FrameMetadata &metadata() const;

	uint64_t cookie() const;
	void setCookie(uint64_t cookie);

	std::unique_ptr<Fence> releaseFence();

private:
	LIBCAMERA_DISABLE_COPY_AND_MOVE(FrameBuffer)
};

} /* namespace libcamera */

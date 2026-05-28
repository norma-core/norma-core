/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * FrameBuffer allocator
 */

#pragma once

#include <map>
#include <memory>
#include <vector>

#include <libcamera/base/class.h>

namespace libcamera {

class Camera;
class FrameBuffer;
class Stream;

class FrameBufferAllocator
{
public:
	FrameBufferAllocator(std::shared_ptr<Camera> camera);
	~FrameBufferAllocator();

	int allocate(Stream *stream);
	int free(Stream *stream);

	bool allocated() const { return !buffers_.empty(); }
	const std::vector<std::unique_ptr<FrameBuffer>> &buffers(Stream *stream) const;

private:
	LIBCAMERA_DISABLE_COPY(FrameBufferAllocator)

	std::shared_ptr<Camera> camera_;
	std::map<Stream *, std::vector<std::unique_ptr<FrameBuffer>>> buffers_;
};

} /* namespace libcamera */

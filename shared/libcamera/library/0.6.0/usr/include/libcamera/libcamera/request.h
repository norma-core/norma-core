/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * Capture request handling
 */

#pragma once

#include <map>
#include <memory>
#include <ostream>
#include <stdint.h>
#include <string>

#include <libcamera/base/class.h>
#include <libcamera/base/signal.h>

#include <libcamera/controls.h>
#include <libcamera/fence.h>

namespace libcamera {

class Camera;
class CameraControlValidator;
class FrameBuffer;
class Stream;

class Request : public Extensible
{
	LIBCAMERA_DECLARE_PRIVATE()

public:
	enum Status {
		RequestPending,
		RequestComplete,
		RequestCancelled,
	};

	enum ReuseFlag {
		Default = 0,
		ReuseBuffers = (1 << 0),
	};

	using BufferMap = std::map<const Stream *, FrameBuffer *>;

	Request(Camera *camera, uint64_t cookie = 0);
	~Request();

	void reuse(ReuseFlag flags = Default);

	ControlList &controls() { return *controls_; }
	ControlList &metadata() { return *metadata_; }
	const BufferMap &buffers() const { return bufferMap_; }
	int addBuffer(const Stream *stream, FrameBuffer *buffer,
		      std::unique_ptr<Fence> &&fence = {});
	FrameBuffer *findBuffer(const Stream *stream) const;

	uint32_t sequence() const;
	uint64_t cookie() const { return cookie_; }
	Status status() const { return status_; }

	bool hasPendingBuffers() const;

	std::string toString() const;

private:
	LIBCAMERA_DISABLE_COPY(Request)

	ControlList *controls_;
	ControlList *metadata_;
	BufferMap bufferMap_;

	const uint64_t cookie_;
	Status status_;
};

std::ostream &operator<<(std::ostream &out, const Request &r);

} /* namespace libcamera */

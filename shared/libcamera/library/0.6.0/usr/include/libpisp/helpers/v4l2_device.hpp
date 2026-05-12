
/* SPDX-License-Identifier: BSD-2-Clause */
/*
 * Copyright (C) 2025 Raspberry Pi Ltd
 *
 * v4l2_device.hpp - PiSP V4L2 device helper
 */
#pragma once

#include <array>
#include <optional>
#include <queue>
#include <stdint.h>
#include <vector>

#include <linux/videodev2.h>

#include "libpisp/backend/pisp_be_config.h"

#include "device_fd.hpp"

namespace libpisp::helpers
{

class V4l2Device
{
public:
	V4l2Device(const std::string &device);
	~V4l2Device();

	V4l2Device(V4l2Device &&) = default;
	V4l2Device &operator=(V4l2Device &&) = default;

	V4l2Device(const V4l2Device &) = delete;
	V4l2Device &operator=(const V4l2Device &) = delete;

	unsigned int Fd()
	{
		return fd_.Get();
	}

	bool Valid()
	{
		return fd_.Valid();
	}

	void Close()
	{
		if (fd_.Valid())
			fd_.Close();
	}

	struct Buffer
	{
		Buffer()
		{
		}

		Buffer(const v4l2_buffer& buf)
			: buffer(buf), size({}), mem({})
		{
		}

		v4l2_buffer buffer;
		std::array<size_t, 3> size;
		std::array<uint8_t *, 3> mem;
	};

	int RequestBuffers(unsigned int count = 1);
	void ReturnBuffers();

	std::optional<Buffer> AcquireBuffer();
	void ReleaseBuffer(const Buffer &buffer);
	const std::vector<Buffer> &Buffers() const
	{
		return v4l2_buffers_;
	};

	int QueueBuffer(unsigned int index);
	int DequeueBuffer(unsigned int timeout_ms = 500);

	void SetFormat(const pisp_image_format_config &format, bool use_opaque_format = false);

	void StreamOn();
	void StreamOff();

private:
	bool isMeta()
	{
		return buf_type_ == V4L2_BUF_TYPE_META_OUTPUT;
	}

	bool isCapture()
	{
		return buf_type_ == V4L2_BUF_TYPE_VIDEO_CAPTURE_MPLANE;
	}

	bool isOutput()
	{
		return !isCapture();
	}

	std::optional<Buffer> findBuffer(unsigned int index) const;

	std::queue<unsigned int> available_buffers_;
	std::vector<Buffer> v4l2_buffers_;
	DeviceFd fd_;
	enum v4l2_buf_type buf_type_;
	unsigned int num_memory_planes_;
};

} // namespace libpisp

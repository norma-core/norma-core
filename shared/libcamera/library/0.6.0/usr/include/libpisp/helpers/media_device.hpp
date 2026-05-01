
/* SPDX-License-Identifier: BSD-2-Clause */
/*
 * Copyright (C) 2025 Raspberry Pi Ltd
 *
 * media_device.hpp - PiSP media device helper
 */
#pragma once

#include <map>
#include <string>
#include <vector>

#include <linux/media.h>

#include "device_fd.hpp"
#include "v4l2_device.hpp"

class MediaEnumerator;

namespace libpisp::helpers
{

using V4l2DevMap = std::map<std::string, V4l2Device>;

class MediaDevice
{
public:
	MediaDevice();
	~MediaDevice();

	std::string Acquire(const std::string &device = {});
	void Release(const std::string &device);

	V4l2DevMap OpenV4l2Nodes(const std::string &device) const;
	void CloseV4l2Nodes(V4l2DevMap &device_map);

	std::string List() const;
	struct media_device_info DeviceInfo(const std::string &device) const;

private:
	std::map<std::string, DeviceFd>::iterator unlock(const std::string &device);
	std::map<std::string, DeviceFd> lock_map_;
	const MediaEnumerator *media_enumerator_;
};

} // namespace libpisp

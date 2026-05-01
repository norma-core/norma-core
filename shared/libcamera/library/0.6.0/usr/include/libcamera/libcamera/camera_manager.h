/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2018, Google Inc.
 *
 * Camera management
 */

#pragma once

#include <memory>
#include <string>
#include <string_view>
#include <sys/types.h>
#include <vector>

#include <libcamera/base/class.h>
#include <libcamera/base/object.h>
#include <libcamera/base/signal.h>

namespace libcamera {

class Camera;

class CameraManager : public Object, public Extensible
{
	LIBCAMERA_DECLARE_PRIVATE()
public:
	CameraManager();
	~CameraManager();

	int start();
	void stop();

	std::vector<std::shared_ptr<Camera>> cameras() const;
	std::shared_ptr<Camera> get(std::string_view id);

	static const std::string &version() { return version_; }

	Signal<std::shared_ptr<Camera>> cameraAdded;
	Signal<std::shared_ptr<Camera>> cameraRemoved;

private:
	LIBCAMERA_DISABLE_COPY(CameraManager)

	static const std::string version_;
	static CameraManager *self_;
};

} /* namespace libcamera */

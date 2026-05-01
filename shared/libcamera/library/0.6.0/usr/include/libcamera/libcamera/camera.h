/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2018, Google Inc.
 *
 * Camera object interface
 */

#pragma once

#include <initializer_list>
#include <memory>
#include <optional>
#include <set>
#include <stdint.h>
#include <string>

#include <libcamera/base/class.h>
#include <libcamera/base/flags.h>
#include <libcamera/base/object.h>
#include <libcamera/base/signal.h>

#include <libcamera/controls.h>
#include <libcamera/geometry.h>
#include <libcamera/orientation.h>
#include <libcamera/request.h>
#include <libcamera/stream.h>

namespace libcamera {

class FrameBuffer;
class FrameBufferAllocator;
class PipelineHandler;
class Request;

class SensorConfiguration
{
public:
	unsigned int bitDepth = 0;

	Rectangle analogCrop;

	struct {
		unsigned int binX = 1;
		unsigned int binY = 1;
	} binning;

	struct {
		unsigned int xOddInc = 1;
		unsigned int xEvenInc = 1;
		unsigned int yOddInc = 1;
		unsigned int yEvenInc = 1;
	} skipping;

	Size outputSize;

	bool isValid() const;
};

class CameraConfiguration
{
public:
	enum Status {
		Valid,
		Adjusted,
		Invalid,
	};

	using iterator = std::vector<StreamConfiguration>::iterator;
	using const_iterator = std::vector<StreamConfiguration>::const_iterator;

	virtual ~CameraConfiguration();

	void addConfiguration(const StreamConfiguration &cfg);
	virtual Status validate() = 0;

	StreamConfiguration &at(unsigned int index);
	const StreamConfiguration &at(unsigned int index) const;
	StreamConfiguration &operator[](unsigned int index)
	{
		return at(index);
	}
	const StreamConfiguration &operator[](unsigned int index) const
	{
		return at(index);
	}

	iterator begin();
	const_iterator begin() const;
	iterator end();
	const_iterator end() const;

	bool empty() const;
	std::size_t size() const;

	std::optional<SensorConfiguration> sensorConfig;
	Orientation orientation;

protected:
	CameraConfiguration();

	enum class ColorSpaceFlag {
		None,
		StreamsShareColorSpace,
	};

	using ColorSpaceFlags = Flags<ColorSpaceFlag>;

	Status validateColorSpaces(ColorSpaceFlags flags = ColorSpaceFlag::None);

	std::vector<StreamConfiguration> config_;
};

class Camera final : public Object, public std::enable_shared_from_this<Camera>,
		     public Extensible
{
	LIBCAMERA_DECLARE_PRIVATE()

public:
	static std::shared_ptr<Camera> create(std::unique_ptr<Private> d,
					      const std::string &id,
					      const std::set<Stream *> &streams);

	const std::string &id() const;

	Signal<Request *, FrameBuffer *> bufferCompleted;
	Signal<Request *> requestCompleted;
	Signal<> disconnected;

	int acquire();
	int release();

	const ControlInfoMap &controls() const;
	const ControlList &properties() const;

	const std::set<Stream *> &streams() const;

	std::unique_ptr<CameraConfiguration>
	generateConfiguration(Span<const StreamRole> roles = {});

	std::unique_ptr<CameraConfiguration>
	generateConfiguration(std::initializer_list<StreamRole> roles)
	{
		return generateConfiguration(Span(roles.begin(), roles.end()));
	}

	int configure(CameraConfiguration *config);

	std::unique_ptr<Request> createRequest(uint64_t cookie = 0);
	int queueRequest(Request *request);

	int start(const ControlList *controls = nullptr);
	int stop();

private:
	LIBCAMERA_DISABLE_COPY(Camera)

	Camera(std::unique_ptr<Private> d, const std::string &id,
	       const std::set<Stream *> &streams);
	~Camera();

	friend class PipelineHandler;
	void disconnect();
	void requestComplete(Request *request);

	friend class FrameBufferAllocator;
	int exportFrameBuffers(Stream *stream,
			       std::vector<std::unique_ptr<FrameBuffer>> *buffers);

	void patchControlList(ControlList &controls);
};

} /* namespace libcamera */

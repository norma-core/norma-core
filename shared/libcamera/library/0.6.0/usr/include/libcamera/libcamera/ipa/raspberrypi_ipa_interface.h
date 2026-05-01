/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2020, Google Inc.
 *
 * Image Processing Algorithm interface for raspberrypi
 *
 * This file is auto-generated. Do not edit.
 */

#pragma once


#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include <libcamera/base/flags.h>
#include <libcamera/base/signal.h>

#include <libcamera/controls.h>
#include <libcamera/framebuffer.h>
#include <libcamera/geometry.h>

#include <libcamera/ipa/core_ipa_interface.h>
#include <libcamera/ipa/ipa_interface.h>

namespace libcamera {

namespace ipa {

namespace RPi {



const uint32_t MaxLsGridSize = 0x8000;


enum class _RPiCmd {
	Exit = 0,
	Init = 1,
	Start = 2,
	Stop = 3,
	Configure = 4,
	MapBuffers = 5,
	UnmapBuffers = 6,
	PrepareIsp = 7,
	ProcessStats = 8,
};

enum class _RPiEventCmd {
	PrepareIspComplete = 1,
	ProcessStatsComplete = 2,
	MetadataReady = 3,
	SetIspControls = 4,
	SetDelayedControls = 5,
	SetLensControls = 6,
	SetCameraTimeout = 7,
};


struct SensorConfig
{
public:
#ifndef __DOXYGEN__
	SensorConfig() = default;

	template<
		typename T1 = uint32_t,
		std::enable_if_t<std::is_convertible_v<T1&&, uint32_t>> * = nullptr
	>
	SensorConfig(T1 &&_sensorMetadata)
		: sensorMetadata(std::forward<T1>(_sensorMetadata))
	{
	}
#endif


	uint32_t sensorMetadata{ 0 };
};

struct InitParams
{
public:
#ifndef __DOXYGEN__
	InitParams() = default;

	template<
		typename T1 = bool,
		typename T2 = IPACameraSensorInfo,
		typename T3 = SharedFD,
		typename T4 = SharedFD,
		std::enable_if_t<std::is_convertible_v<T1&&, bool>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T2&&, IPACameraSensorInfo>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T3&&, SharedFD>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T4&&, SharedFD>> * = nullptr
	>
	InitParams(T1 &&_lensPresent, T2 &&_sensorInfo, T3 &&_fe, T4 &&_be)
		: lensPresent(std::forward<T1>(_lensPresent))
		, sensorInfo(std::forward<T2>(_sensorInfo))
		, fe(std::forward<T3>(_fe))
		, be(std::forward<T4>(_be))
	{
	}
#endif


	bool lensPresent{ 0 };
	IPACameraSensorInfo sensorInfo;
	SharedFD fe{ -1 };
	SharedFD be{ -1 };
};

struct InitResult
{
public:
#ifndef __DOXYGEN__
	InitResult() = default;

	template<
		typename T1 = SensorConfig,
		typename T2 = ControlInfoMap,
		std::enable_if_t<std::is_convertible_v<T1&&, SensorConfig>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T2&&, ControlInfoMap>> * = nullptr
	>
	InitResult(T1 &&_sensorConfig, T2 &&_controlInfo)
		: sensorConfig(std::forward<T1>(_sensorConfig))
		, controlInfo(std::forward<T2>(_controlInfo))
	{
	}
#endif


	SensorConfig sensorConfig;
	ControlInfoMap controlInfo;
};

struct BufferIds
{
public:
#ifndef __DOXYGEN__
	BufferIds() = default;

	template<
		typename T1 = uint32_t,
		typename T2 = uint32_t,
		typename T3 = uint32_t,
		std::enable_if_t<std::is_convertible_v<T1&&, uint32_t>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T2&&, uint32_t>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T3&&, uint32_t>> * = nullptr
	>
	BufferIds(T1 &&_bayer, T2 &&_embedded, T3 &&_stats)
		: bayer(std::forward<T1>(_bayer))
		, embedded(std::forward<T2>(_embedded))
		, stats(std::forward<T3>(_stats))
	{
	}
#endif


	uint32_t bayer{ 0 };
	uint32_t embedded{ 0 };
	uint32_t stats{ 0 };
};

struct ConfigParams
{
public:
#ifndef __DOXYGEN__
	ConfigParams() = default;

	template<
		typename T1 = uint32_t,
		typename T2 = ControlInfoMap,
		typename T3 = ControlInfoMap,
		typename T4 = ControlInfoMap,
		typename T5 = SharedFD,
		std::enable_if_t<std::is_convertible_v<T1&&, uint32_t>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T2&&, ControlInfoMap>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T3&&, ControlInfoMap>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T4&&, ControlInfoMap>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T5&&, SharedFD>> * = nullptr
	>
	ConfigParams(T1 &&_transform, T2 &&_sensorControls, T3 &&_ispControls, T4 &&_lensControls, T5 &&_lsTableHandle)
		: transform(std::forward<T1>(_transform))
		, sensorControls(std::forward<T2>(_sensorControls))
		, ispControls(std::forward<T3>(_ispControls))
		, lensControls(std::forward<T4>(_lensControls))
		, lsTableHandle(std::forward<T5>(_lsTableHandle))
	{
	}
#endif


	uint32_t transform{ 0 };
	ControlInfoMap sensorControls;
	ControlInfoMap ispControls;
	ControlInfoMap lensControls;
	SharedFD lsTableHandle{ -1 };
};

struct ConfigResult
{
public:
#ifndef __DOXYGEN__
	ConfigResult() = default;

	template<
		typename T1 = float,
		typename T2 = ControlInfoMap,
		typename T3 = ControlList,
		typename T4 = ControlList,
		std::enable_if_t<std::is_convertible_v<T1&&, float>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T2&&, ControlInfoMap>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T3&&, ControlList>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T4&&, ControlList>> * = nullptr
	>
	ConfigResult(T1 &&_modeSensitivity, T2 &&_controlInfo, T3 &&_sensorControls, T4 &&_lensControls)
		: modeSensitivity(std::forward<T1>(_modeSensitivity))
		, controlInfo(std::forward<T2>(_controlInfo))
		, sensorControls(std::forward<T3>(_sensorControls))
		, lensControls(std::forward<T4>(_lensControls))
	{
	}
#endif


	float modeSensitivity{ 0 };
	ControlInfoMap controlInfo;
	ControlList sensorControls;
	ControlList lensControls;
};

struct StartResult
{
public:
#ifndef __DOXYGEN__
	StartResult() = default;

	template<
		typename T1 = ControlList,
		typename T2 = int32_t,
		typename T3 = int32_t,
		std::enable_if_t<std::is_convertible_v<T1&&, ControlList>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T2&&, int32_t>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T3&&, int32_t>> * = nullptr
	>
	StartResult(T1 &&_controls, T2 &&_startupFrameCount, T3 &&_invalidFrameCount)
		: controls(std::forward<T1>(_controls))
		, startupFrameCount(std::forward<T2>(_startupFrameCount))
		, invalidFrameCount(std::forward<T3>(_invalidFrameCount))
	{
	}
#endif


	ControlList controls;
	int32_t startupFrameCount{ 0 };
	int32_t invalidFrameCount{ 0 };
};

struct PrepareParams
{
public:
#ifndef __DOXYGEN__
	PrepareParams() = default;

	template<
		typename T1 = BufferIds,
		typename T2 = ControlList,
		typename T3 = ControlList,
		typename T4 = uint32_t,
		typename T5 = uint32_t,
		std::enable_if_t<std::is_convertible_v<T1&&, BufferIds>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T2&&, ControlList>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T3&&, ControlList>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T4&&, uint32_t>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T5&&, uint32_t>> * = nullptr
	>
	PrepareParams(T1 &&_buffers, T2 &&_sensorControls, T3 &&_requestControls, T4 &&_ipaContext, T5 &&_delayContext)
		: buffers(std::forward<T1>(_buffers))
		, sensorControls(std::forward<T2>(_sensorControls))
		, requestControls(std::forward<T3>(_requestControls))
		, ipaContext(std::forward<T4>(_ipaContext))
		, delayContext(std::forward<T5>(_delayContext))
	{
	}
#endif


	BufferIds buffers;
	ControlList sensorControls;
	ControlList requestControls;
	uint32_t ipaContext{ 0 };
	uint32_t delayContext{ 0 };
};

struct ProcessParams
{
public:
#ifndef __DOXYGEN__
	ProcessParams() = default;

	template<
		typename T1 = BufferIds,
		typename T2 = uint32_t,
		std::enable_if_t<std::is_convertible_v<T1&&, BufferIds>> * = nullptr,
		std::enable_if_t<std::is_convertible_v<T2&&, uint32_t>> * = nullptr
	>
	ProcessParams(T1 &&_buffers, T2 &&_ipaContext)
		: buffers(std::forward<T1>(_buffers))
		, ipaContext(std::forward<T2>(_ipaContext))
	{
	}
#endif


	BufferIds buffers;
	uint32_t ipaContext{ 0 };
};

class IPARPiInterface : public IPAInterface
{
public:

	virtual int32_t init(
		const IPASettings &settings,
		const InitParams &params,
		InitResult *result) = 0;

	virtual void start(
		const ControlList &controls,
		StartResult *result) = 0;

	virtual void stop() = 0;

	virtual int32_t configure(
		const IPACameraSensorInfo &sensorInfo,
		const ConfigParams &params,
		ConfigResult *result) = 0;

	virtual void mapBuffers(
		const std::vector<libcamera::IPABuffer> &buffers) = 0;

	virtual void unmapBuffers(
		const std::vector<uint32_t> &ids) = 0;

	virtual void prepareIsp(
		const PrepareParams &params) = 0;

	virtual void processStats(
		const ProcessParams &params) = 0;

	Signal<const BufferIds &, bool> prepareIspComplete;

	Signal<const BufferIds &> processStatsComplete;

	Signal<const ControlList &> metadataReady;

	Signal<const ControlList &> setIspControls;

	Signal<const ControlList &, uint32_t> setDelayedControls;

	Signal<const ControlList &> setLensControls;

	Signal<uint32_t> setCameraTimeout;
};

} /* namespace RPi */

} /* namespace ipa */

} /* namespace libcamera */
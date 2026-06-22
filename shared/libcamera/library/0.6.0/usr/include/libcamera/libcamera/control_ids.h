/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * Controls ID list
 *
 * This file is auto-generated. Do not edit.
 */

#pragma once

#include <array>
#include <map>
#include <stdint.h>
#include <string>
#include <string_view>

#include <libcamera/controls.h>

namespace libcamera {

namespace controls {

extern const ControlIdMap controls;


enum {
	AE_ENABLE = 1,
	AE_STATE = 2,
	AE_METERING_MODE = 3,
	AE_CONSTRAINT_MODE = 4,
	AE_EXPOSURE_MODE = 5,
	EXPOSURE_VALUE = 6,
	EXPOSURE_TIME = 7,
	EXPOSURE_TIME_MODE = 8,
	ANALOGUE_GAIN = 9,
	ANALOGUE_GAIN_MODE = 10,
	AE_FLICKER_MODE = 11,
	AE_FLICKER_PERIOD = 12,
	AE_FLICKER_DETECTED = 13,
	BRIGHTNESS = 14,
	CONTRAST = 15,
	LUX = 16,
	AWB_ENABLE = 17,
	AWB_MODE = 18,
	AWB_LOCKED = 19,
	COLOUR_GAINS = 20,
	COLOUR_TEMPERATURE = 21,
	SATURATION = 22,
	SENSOR_BLACK_LEVELS = 23,
	SHARPNESS = 24,
	FOCUS_FO_M = 25,
	COLOUR_CORRECTION_MATRIX = 26,
	SCALER_CROP = 27,
	DIGITAL_GAIN = 28,
	FRAME_DURATION = 29,
	FRAME_DURATION_LIMITS = 30,
	SENSOR_TEMPERATURE = 31,
	SENSOR_TIMESTAMP = 32,
	AF_MODE = 33,
	AF_RANGE = 34,
	AF_SPEED = 35,
	AF_METERING = 36,
	AF_WINDOWS = 37,
	AF_TRIGGER = 38,
	AF_PAUSE = 39,
	LENS_POSITION = 40,
	AF_STATE = 41,
	AF_PAUSE_STATE = 42,
	HDR_MODE = 43,
	HDR_CHANNEL = 44,
	GAMMA = 45,
	DEBUG_METADATA_ENABLE = 46,
	FRAME_WALL_CLOCK = 47,
	WDR_MODE = 48,
	WDR_STRENGTH = 49,
	WDR_MAX_BRIGHT_PIXELS = 50,
	LENS_DEWARP_ENABLE = 51,
};


extern const Control<bool> AeEnable;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AE_ENABLE
enum AeStateEnum {
	AeStateIdle = 0,
	AeStateSearching = 1,
	AeStateConverged = 2,
};
extern const std::array<const ControlValue, 3> AeStateValues;
extern const std::map<std::string, int32_t> AeStateNameValueMap;
extern const Control<int32_t> AeState;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AE_STATE
enum AeMeteringModeEnum {
	MeteringCentreWeighted = 0,
	MeteringSpot = 1,
	MeteringMatrix = 2,
	MeteringCustom = 3,
};
extern const std::array<const ControlValue, 4> AeMeteringModeValues;
extern const std::map<std::string, int32_t> AeMeteringModeNameValueMap;
extern const Control<int32_t> AeMeteringMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AE_METERING_MODE
enum AeConstraintModeEnum {
	ConstraintNormal = 0,
	ConstraintHighlight = 1,
	ConstraintShadows = 2,
	ConstraintCustom = 3,
};
extern const std::array<const ControlValue, 4> AeConstraintModeValues;
extern const std::map<std::string, int32_t> AeConstraintModeNameValueMap;
extern const Control<int32_t> AeConstraintMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AE_CONSTRAINT_MODE
enum AeExposureModeEnum {
	ExposureNormal = 0,
	ExposureShort = 1,
	ExposureLong = 2,
	ExposureCustom = 3,
};
extern const std::array<const ControlValue, 4> AeExposureModeValues;
extern const std::map<std::string, int32_t> AeExposureModeNameValueMap;
extern const Control<int32_t> AeExposureMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AE_EXPOSURE_MODE
extern const Control<float> ExposureValue;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_EXPOSURE_VALUE
extern const Control<int32_t> ExposureTime;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_EXPOSURE_TIME
enum ExposureTimeModeEnum {
	ExposureTimeModeAuto = 0,
	ExposureTimeModeManual = 1,
};
extern const std::array<const ControlValue, 2> ExposureTimeModeValues;
extern const std::map<std::string, int32_t> ExposureTimeModeNameValueMap;
extern const Control<int32_t> ExposureTimeMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_EXPOSURE_TIME_MODE
extern const Control<float> AnalogueGain;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_ANALOGUE_GAIN
enum AnalogueGainModeEnum {
	AnalogueGainModeAuto = 0,
	AnalogueGainModeManual = 1,
};
extern const std::array<const ControlValue, 2> AnalogueGainModeValues;
extern const std::map<std::string, int32_t> AnalogueGainModeNameValueMap;
extern const Control<int32_t> AnalogueGainMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_ANALOGUE_GAIN_MODE
enum AeFlickerModeEnum {
	FlickerOff = 0,
	FlickerManual = 1,
	FlickerAuto = 2,
};
extern const std::array<const ControlValue, 3> AeFlickerModeValues;
extern const std::map<std::string, int32_t> AeFlickerModeNameValueMap;
extern const Control<int32_t> AeFlickerMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AE_FLICKER_MODE
extern const Control<int32_t> AeFlickerPeriod;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AE_FLICKER_PERIOD
extern const Control<int32_t> AeFlickerDetected;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AE_FLICKER_DETECTED
extern const Control<float> Brightness;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_BRIGHTNESS
extern const Control<float> Contrast;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_CONTRAST
extern const Control<float> Lux;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_LUX
extern const Control<bool> AwbEnable;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AWB_ENABLE
enum AwbModeEnum {
	AwbAuto = 0,
	AwbIncandescent = 1,
	AwbTungsten = 2,
	AwbFluorescent = 3,
	AwbIndoor = 4,
	AwbDaylight = 5,
	AwbCloudy = 6,
	AwbCustom = 7,
};
extern const std::array<const ControlValue, 8> AwbModeValues;
extern const std::map<std::string, int32_t> AwbModeNameValueMap;
extern const Control<int32_t> AwbMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AWB_MODE
extern const Control<bool> AwbLocked;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AWB_LOCKED
extern const Control<Span<const float, 2>> ColourGains;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_COLOUR_GAINS
extern const Control<int32_t> ColourTemperature;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_COLOUR_TEMPERATURE
extern const Control<float> Saturation;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_SATURATION
extern const Control<Span<const int32_t, 4>> SensorBlackLevels;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_SENSOR_BLACK_LEVELS
extern const Control<float> Sharpness;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_SHARPNESS
extern const Control<int32_t> FocusFoM;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_FOCUS_FO_M
extern const Control<Span<const float, 9>> ColourCorrectionMatrix;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_COLOUR_CORRECTION_MATRIX
extern const Control<Rectangle> ScalerCrop;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_SCALER_CROP
extern const Control<float> DigitalGain;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_DIGITAL_GAIN
extern const Control<int64_t> FrameDuration;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_FRAME_DURATION
extern const Control<Span<const int64_t, 2>> FrameDurationLimits;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_FRAME_DURATION_LIMITS
extern const Control<float> SensorTemperature;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_SENSOR_TEMPERATURE
extern const Control<int64_t> SensorTimestamp;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_SENSOR_TIMESTAMP
enum AfModeEnum {
	AfModeManual = 0,
	AfModeAuto = 1,
	AfModeContinuous = 2,
};
extern const std::array<const ControlValue, 3> AfModeValues;
extern const std::map<std::string, int32_t> AfModeNameValueMap;
extern const Control<int32_t> AfMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_MODE
enum AfRangeEnum {
	AfRangeNormal = 0,
	AfRangeMacro = 1,
	AfRangeFull = 2,
};
extern const std::array<const ControlValue, 3> AfRangeValues;
extern const std::map<std::string, int32_t> AfRangeNameValueMap;
extern const Control<int32_t> AfRange;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_RANGE
enum AfSpeedEnum {
	AfSpeedNormal = 0,
	AfSpeedFast = 1,
};
extern const std::array<const ControlValue, 2> AfSpeedValues;
extern const std::map<std::string, int32_t> AfSpeedNameValueMap;
extern const Control<int32_t> AfSpeed;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_SPEED
enum AfMeteringEnum {
	AfMeteringAuto = 0,
	AfMeteringWindows = 1,
};
extern const std::array<const ControlValue, 2> AfMeteringValues;
extern const std::map<std::string, int32_t> AfMeteringNameValueMap;
extern const Control<int32_t> AfMetering;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_METERING
extern const Control<Span<const Rectangle>> AfWindows;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_WINDOWS
enum AfTriggerEnum {
	AfTriggerStart = 0,
	AfTriggerCancel = 1,
};
extern const std::array<const ControlValue, 2> AfTriggerValues;
extern const std::map<std::string, int32_t> AfTriggerNameValueMap;
extern const Control<int32_t> AfTrigger;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_TRIGGER
enum AfPauseEnum {
	AfPauseImmediate = 0,
	AfPauseDeferred = 1,
	AfPauseResume = 2,
};
extern const std::array<const ControlValue, 3> AfPauseValues;
extern const std::map<std::string, int32_t> AfPauseNameValueMap;
extern const Control<int32_t> AfPause;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_PAUSE
extern const Control<float> LensPosition;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_LENS_POSITION
enum AfStateEnum {
	AfStateIdle = 0,
	AfStateScanning = 1,
	AfStateFocused = 2,
	AfStateFailed = 3,
};
extern const std::array<const ControlValue, 4> AfStateValues;
extern const std::map<std::string, int32_t> AfStateNameValueMap;
extern const Control<int32_t> AfState;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_STATE
enum AfPauseStateEnum {
	AfPauseStateRunning = 0,
	AfPauseStatePausing = 1,
	AfPauseStatePaused = 2,
};
extern const std::array<const ControlValue, 3> AfPauseStateValues;
extern const std::map<std::string, int32_t> AfPauseStateNameValueMap;
extern const Control<int32_t> AfPauseState;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_AF_PAUSE_STATE
enum HdrModeEnum {
	HdrModeOff = 0,
	HdrModeMultiExposureUnmerged = 1,
	HdrModeMultiExposure = 2,
	HdrModeSingleExposure = 3,
	HdrModeNight = 4,
};
extern const std::array<const ControlValue, 5> HdrModeValues;
extern const std::map<std::string, int32_t> HdrModeNameValueMap;
extern const Control<int32_t> HdrMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_HDR_MODE
enum HdrChannelEnum {
	HdrChannelNone = 0,
	HdrChannelShort = 1,
	HdrChannelMedium = 2,
	HdrChannelLong = 3,
};
extern const std::array<const ControlValue, 4> HdrChannelValues;
extern const std::map<std::string, int32_t> HdrChannelNameValueMap;
extern const Control<int32_t> HdrChannel;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_HDR_CHANNEL
extern const Control<float> Gamma;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_GAMMA
extern const Control<bool> DebugMetadataEnable;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_DEBUG_METADATA_ENABLE
extern const Control<int64_t> FrameWallClock;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_FRAME_WALL_CLOCK
enum WdrModeEnum {
	WdrOff = 0,
	WdrLinear = 1,
	WdrPower = 2,
	WdrExponential = 3,
	WdrHistogramEqualization = 4,
};
extern const std::array<const ControlValue, 5> WdrModeValues;
extern const std::map<std::string, int32_t> WdrModeNameValueMap;
extern const Control<int32_t> WdrMode;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_WDR_MODE
extern const Control<float> WdrStrength;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_WDR_STRENGTH
extern const Control<float> WdrMaxBrightPixels;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_WDR_MAX_BRIGHT_PIXELS
extern const Control<bool> LensDewarpEnable;
#define LIBCAMERA_HAS_LIBCAMERA_VENDOR_CONTROLS_LENS_DEWARP_ENABLE

namespace draft {

#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS


enum {
	AE_PRECAPTURE_TRIGGER = 10001,
	NOISE_REDUCTION_MODE = 10002,
	COLOR_CORRECTION_ABERRATION_MODE = 10003,
	AWB_STATE = 10004,
	SENSOR_ROLLING_SHUTTER_SKEW = 10005,
	LENS_SHADING_MAP_MODE = 10006,
	PIPELINE_DEPTH = 10007,
	MAX_LATENCY = 10008,
	TEST_PATTERN_MODE = 10009,
	FACE_DETECT_MODE = 10010,
	FACE_DETECT_FACE_RECTANGLES = 10011,
	FACE_DETECT_FACE_SCORES = 10012,
	FACE_DETECT_FACE_LANDMARKS = 10013,
	FACE_DETECT_FACE_IDS = 10014,
};


enum AePrecaptureTriggerEnum {
	AePrecaptureTriggerIdle = 0,
	AePrecaptureTriggerStart = 1,
	AePrecaptureTriggerCancel = 2,
};
extern const std::array<const ControlValue, 3> AePrecaptureTriggerValues;
extern const std::map<std::string, int32_t> AePrecaptureTriggerNameValueMap;
extern const Control<int32_t> AePrecaptureTrigger;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_AE_PRECAPTURE_TRIGGER
enum NoiseReductionModeEnum {
	NoiseReductionModeOff = 0,
	NoiseReductionModeFast = 1,
	NoiseReductionModeHighQuality = 2,
	NoiseReductionModeMinimal = 3,
	NoiseReductionModeZSL = 4,
};
extern const std::array<const ControlValue, 5> NoiseReductionModeValues;
extern const std::map<std::string, int32_t> NoiseReductionModeNameValueMap;
extern const Control<int32_t> NoiseReductionMode;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_NOISE_REDUCTION_MODE
enum ColorCorrectionAberrationModeEnum {
	ColorCorrectionAberrationOff = 0,
	ColorCorrectionAberrationFast = 1,
	ColorCorrectionAberrationHighQuality = 2,
};
extern const std::array<const ControlValue, 3> ColorCorrectionAberrationModeValues;
extern const std::map<std::string, int32_t> ColorCorrectionAberrationModeNameValueMap;
extern const Control<int32_t> ColorCorrectionAberrationMode;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_COLOR_CORRECTION_ABERRATION_MODE
enum AwbStateEnum {
	AwbStateInactive = 0,
	AwbStateSearching = 1,
	AwbConverged = 2,
	AwbLocked = 3,
};
extern const std::array<const ControlValue, 4> AwbStateValues;
extern const std::map<std::string, int32_t> AwbStateNameValueMap;
extern const Control<int32_t> AwbState;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_AWB_STATE
extern const Control<int64_t> SensorRollingShutterSkew;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_SENSOR_ROLLING_SHUTTER_SKEW
enum LensShadingMapModeEnum {
	LensShadingMapModeOff = 0,
	LensShadingMapModeOn = 1,
};
extern const std::array<const ControlValue, 2> LensShadingMapModeValues;
extern const std::map<std::string, int32_t> LensShadingMapModeNameValueMap;
extern const Control<int32_t> LensShadingMapMode;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_LENS_SHADING_MAP_MODE
extern const Control<int32_t> PipelineDepth;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_PIPELINE_DEPTH
extern const Control<int32_t> MaxLatency;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_MAX_LATENCY
enum TestPatternModeEnum {
	TestPatternModeOff = 0,
	TestPatternModeSolidColor = 1,
	TestPatternModeColorBars = 2,
	TestPatternModeColorBarsFadeToGray = 3,
	TestPatternModePn9 = 4,
	TestPatternModeCustom1 = 256,
};
extern const std::array<const ControlValue, 6> TestPatternModeValues;
extern const std::map<std::string, int32_t> TestPatternModeNameValueMap;
extern const Control<int32_t> TestPatternMode;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_TEST_PATTERN_MODE
enum FaceDetectModeEnum {
	FaceDetectModeOff = 0,
	FaceDetectModeSimple = 1,
	FaceDetectModeFull = 2,
};
extern const std::array<const ControlValue, 3> FaceDetectModeValues;
extern const std::map<std::string, int32_t> FaceDetectModeNameValueMap;
extern const Control<int32_t> FaceDetectMode;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_FACE_DETECT_MODE
extern const Control<Span<const Rectangle>> FaceDetectFaceRectangles;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_FACE_DETECT_FACE_RECTANGLES
extern const Control<Span<const uint8_t>> FaceDetectFaceScores;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_FACE_DETECT_FACE_SCORES
extern const Control<Span<const Point>> FaceDetectFaceLandmarks;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_FACE_DETECT_FACE_LANDMARKS
extern const Control<Span<const int32_t>> FaceDetectFaceIds;
#define LIBCAMERA_HAS_DRAFT_VENDOR_CONTROLS_FACE_DETECT_FACE_IDS

} /* namespace draft */

namespace rpi {

#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS


enum {
	STATS_OUTPUT_ENABLE = 20001,
	BCM2835_STATS_OUTPUT = 20002,
	SCALER_CROPS = 20003,
	PISP_STATS_OUTPUT = 20004,
	SYNC_MODE = 20005,
	SYNC_READY = 20006,
	SYNC_TIMER = 20007,
	SYNC_FRAMES = 20008,
};


extern const Control<bool> StatsOutputEnable;
#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS_STATS_OUTPUT_ENABLE
extern const Control<Span<const uint8_t>> Bcm2835StatsOutput;
#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS_BCM2835_STATS_OUTPUT
extern const Control<Span<const Rectangle>> ScalerCrops;
#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS_SCALER_CROPS
extern const Control<Span<const uint8_t>> PispStatsOutput;
#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS_PISP_STATS_OUTPUT
enum SyncModeEnum {
	SyncModeOff = 0,
	SyncModeServer = 1,
	SyncModeClient = 2,
};
extern const std::array<const ControlValue, 3> SyncModeValues;
extern const std::map<std::string, int32_t> SyncModeNameValueMap;
extern const Control<int32_t> SyncMode;
#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS_SYNC_MODE
extern const Control<bool> SyncReady;
#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS_SYNC_READY
extern const Control<int64_t> SyncTimer;
#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS_SYNC_TIMER
extern const Control<int32_t> SyncFrames;
#define LIBCAMERA_HAS_RPI_VENDOR_CONTROLS_SYNC_FRAMES

} /* namespace rpi */

namespace debug {

#define LIBCAMERA_HAS_DEBUG_VENDOR_CONTROLS




} /* namespace debug */

} /* namespace controls */

} /* namespace libcamera */
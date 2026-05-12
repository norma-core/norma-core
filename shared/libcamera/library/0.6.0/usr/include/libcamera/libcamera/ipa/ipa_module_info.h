/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * Image Processing Algorithm module information
 */

#pragma once

#include <stdint.h>

#define IPA_MODULE_API_VERSION 1

namespace libcamera {

struct IPAModuleInfo {
	int moduleAPIVersion;
	uint32_t pipelineVersion;
	char pipelineName[256];
	char name[256];
} __attribute__((packed));

extern "C" {
extern const struct IPAModuleInfo ipaModuleInfo;
}

} /* namespace libcamera */

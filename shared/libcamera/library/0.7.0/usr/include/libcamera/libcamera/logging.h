/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * Logging infrastructure
 */

#pragma once

#include <ostream>

namespace libcamera {

enum LoggingTarget {
	LoggingTargetNone,
	LoggingTargetSyslog,
	LoggingTargetFile,
	LoggingTargetStream,
};

int logSetFile(const char *path, bool color = false);
int logSetStream(std::ostream *stream, bool color = false);
int logSetTarget(LoggingTarget target);
void logSetLevel(const char *category, const char *level);

} /* namespace libcamera */

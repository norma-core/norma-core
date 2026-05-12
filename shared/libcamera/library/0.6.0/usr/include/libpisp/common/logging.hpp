/* SPDX-License-Identifier: BSD-2-Clause */
/*
 * Copyright (C) 2021 - 2023, Raspberry Pi Ltd
 *
 * logging.hpp - PiSP logging library
 */
#pragma once

#include <cassert>

#ifndef PISP_LOGGING_ENABLE
#define PISP_LOGGING_ENABLE 0
#endif

#if PISP_LOGGING_ENABLE

#include <boost/log/trivial.hpp>

#define PISP_LOG(sev, stuff) \
do { \
	if (PISP_LOGGING_ENABLE) \
		BOOST_LOG_TRIVIAL(sev) << __FUNCTION__ << ": " << stuff; \
} while (0)

#else

#define PISP_LOG(sev, stuff) do { } while(0)

#endif

#define PISP_ASSERT(x) assert(x)

namespace libpisp
{
	// Call this before you try and use any logging.
	void logging_init();
} // namespace libpisp
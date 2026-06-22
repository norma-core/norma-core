/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * Image Processing Algorithm interface
 */

#pragma once

namespace libcamera {

/*
 * Structs and enums that are defined in core.mojom that have the skipHeader
 * tag must be #included here.
 */

class IPAInterface
{
public:
	virtual ~IPAInterface() = default;
};

extern "C" {
libcamera::IPAInterface *ipaCreate();
}

} /* namespace libcamera */

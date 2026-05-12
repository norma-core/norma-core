/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * File descriptor wrapper with shared ownership
 */

#pragma once

#include <memory>

namespace libcamera {

class UniqueFD;

class SharedFD final
{
public:
	explicit SharedFD(const int &fd = -1);
	explicit SharedFD(int &&fd);
	explicit SharedFD(UniqueFD fd);
	SharedFD(const SharedFD &other);
	SharedFD(SharedFD &&other);
	~SharedFD();

	SharedFD &operator=(const SharedFD &other);
	SharedFD &operator=(SharedFD &&other);

	bool isValid() const { return fd_ != nullptr; }
	int get() const { return fd_ ? fd_->fd() : -1; }
	UniqueFD dup() const;

private:
	class Descriptor
	{
	public:
		Descriptor(int fd, bool duplicate);
		~Descriptor();

		int fd() const { return fd_; }

	private:
		int fd_;
	};

	std::shared_ptr<Descriptor> fd_;
};

static inline bool operator==(const SharedFD &lhs, const SharedFD &rhs)
{
	return lhs.get() == rhs.get();
}

static inline bool operator!=(const SharedFD &lhs, const SharedFD &rhs)
{
	return !(lhs == rhs);
}

} /* namespace libcamera */

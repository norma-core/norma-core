/* SPDX-License-Identifier: BSD-2-Clause */
/*
 * Copyright (C) 2021 - 2023, Raspberry Pi Ltd
 *
 * shm_mutex.hpp - PiSP interprocess mutex implementation
 */
#pragma once

#include <pthread.h>

namespace libpisp
{

class ShmMutex
{
public:
	ShmMutex()
	{
		pthread_mutexattr_t attr;
		pthread_mutexattr_init(&attr);
		pthread_mutexattr_setrobust(&attr, PTHREAD_MUTEX_ROBUST);
		pthread_mutexattr_setpshared(&attr, PTHREAD_PROCESS_SHARED);
		pthread_mutex_init(&mutex_, &attr);
		pthread_mutexattr_destroy(&attr);
	}

	~ShmMutex()
	{
		pthread_mutex_destroy(&mutex_);
	}

	void lock()
	{
		pthread_mutex_lock(&mutex_);
	}

	void unlock()
	{
		pthread_mutex_unlock(&mutex_);
	}

	bool try_lock()
	{
		return pthread_mutex_trylock(&mutex_) == 0;
	}

private:
	pthread_mutex_t mutex_;
};

} // namespace libpisp

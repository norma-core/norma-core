/* SPDX-License-Identifier: LGPL-2.1-or-later */
/*
 * Copyright (C) 2019, Google Inc.
 *
 * Base object
 */

#pragma once

#include <list>
#include <memory>
#include <utility>
#include <vector>

#include <libcamera/base/bound_method.h>
#include <libcamera/base/class.h>

namespace libcamera {

class Message;
template<typename... Args>
class Signal;
class SignalBase;
class Thread;

class Object
{
public:
	Object(Object *parent = nullptr);
	virtual ~Object();

	void deleteLater();

	void postMessage(std::unique_ptr<Message> msg);

	template<typename T, typename R, typename... FuncArgs, typename... Args,
		 std::enable_if_t<std::is_base_of<Object, T>::value> * = nullptr>
	R invokeMethod(R (T::*func)(FuncArgs...), ConnectionType type,
		       Args&&... args)
	{
		T *obj = static_cast<T *>(this);
		auto *method = new BoundMethodMember<T, R, FuncArgs...>(obj, this, func, type);
		return method->activate(std::forward<Args>(args)..., true);
	}

	Thread *thread() const { return thread_; }
	void moveToThread(Thread *thread);

	Object *parent() const { return parent_; }

protected:
	virtual void message(Message *msg);

	bool assertThreadBound(const char *message);

private:
	LIBCAMERA_DISABLE_COPY_AND_MOVE(Object)

	friend class SignalBase;
	friend class Thread;

	void notifyThreadMove();

	void connect(SignalBase *signal);
	void disconnect(SignalBase *signal);

	Object *parent_;
	std::vector<Object *> children_;

	Thread *thread_;
	std::list<SignalBase *> signals_;
	unsigned int pendingMessages_;
};

} /* namespace libcamera */

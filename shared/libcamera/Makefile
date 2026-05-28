# Makefile for building libcamera shared library for station drivers.

DOCKER_TAG := latest
LIBCAMERA_IMAGE := libcamera-build-deps
WORKSPACE_ROOT := $(shell pwd)/../..
LIBCAMERA_VERSION ?= 0.7.0
LIBCAMERA_SRC_DIR := target/tmp/libcamera
LIBCAMERA_INSTALL_DIR := shared/libcamera/library/$(LIBCAMERA_VERSION)
LIBCAMERA_WORK_BUILD := $(WORKSPACE_ROOT)/target/tmp/libcamera-build
LIBCAMERA_BUILD_DIR := build-shared
LIBCAMERA_DOCKERFILE := $(shell pwd)/Dockerfile
LIBCAMERA_BUILD_SCRIPT := $(shell pwd)/build.sh
LIBCAMERA_REPO := https://github.com/raspberrypi/libcamera.git

.PHONY: build-libcamera

build-libcamera:
	@echo "Building libcamera shared library..."
	@mkdir -p "$(LIBCAMERA_WORK_BUILD)"
	@cp "$(LIBCAMERA_DOCKERFILE)" "$(LIBCAMERA_WORK_BUILD)/Dockerfile"
	@cp "$(LIBCAMERA_BUILD_SCRIPT)" "$(LIBCAMERA_WORK_BUILD)/build.sh"
	@chmod +x "$(LIBCAMERA_WORK_BUILD)/build.sh"
	docker buildx build --platform linux/arm64 -t $(LIBCAMERA_IMAGE):$(DOCKER_TAG) -f "$(LIBCAMERA_WORK_BUILD)/Dockerfile" --load "$(LIBCAMERA_WORK_BUILD)"
	ROOT_DIR=$(WORKSPACE_ROOT) \
	LIBCAMERA_REPO=$(LIBCAMERA_REPO) \
	LIBCAMERA_VERSION=$(LIBCAMERA_VERSION) \
	LIBCAMERA_SRC_DIR=$(LIBCAMERA_SRC_DIR) \
	LIBCAMERA_BUILD_DIR=$(LIBCAMERA_BUILD_DIR) \
	LIBCAMERA_INSTALL_DIR=$(LIBCAMERA_INSTALL_DIR) \
	BUILD_IMAGE=$(LIBCAMERA_IMAGE):$(DOCKER_TAG) \
	"$(LIBCAMERA_WORK_BUILD)/build.sh"

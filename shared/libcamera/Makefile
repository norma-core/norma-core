# Makefile for building libcamera shared library for station drivers.
#
# LIBCAMERA_VARIANT selects the Debian base image to build inside, which
# determines the glibc baseline the resulting .so files require:
#   trixie   (default) - debian:trixie-slim
#   bookworm            - glibc 2.36, Raspberry Pi OS / Debian 12
#   bullseye             - glibc 2.31, Raspberry Pi OS / Debian 11

DOCKER_TAG := $(LIBCAMERA_VARIANT)
LIBCAMERA_IMAGE := libcamera-build-deps
WORKSPACE_ROOT := $(shell pwd)/../..
LIBCAMERA_VERSION ?= 0.7.0
LIBCAMERA_VARIANT ?= trixie
BASE_IMAGE_trixie := debian:trixie-slim
BASE_IMAGE_bookworm := debian:bookworm-slim
BASE_IMAGE_bullseye := debian:bullseye-slim
BASE_IMAGE := $(BASE_IMAGE_$(LIBCAMERA_VARIANT))
LIBCAMERA_SRC_DIR := target/tmp/libcamera-$(LIBCAMERA_VARIANT)
LIBCAMERA_INSTALL_DIR := shared/libcamera/library/$(LIBCAMERA_VERSION)-$(LIBCAMERA_VARIANT)
LIBCAMERA_WORK_BUILD := $(WORKSPACE_ROOT)/target/tmp/libcamera-build-$(LIBCAMERA_VARIANT)
LIBCAMERA_BUILD_DIR := build-shared
LIBCAMERA_DOCKERFILE := $(shell pwd)/Dockerfile
LIBCAMERA_BUILD_SCRIPT := $(shell pwd)/build.sh
LIBCAMERA_REPO := https://github.com/raspberrypi/libcamera.git

.PHONY: build-libcamera

build-libcamera:
	@if [ -z "$(BASE_IMAGE)" ]; then echo "Unknown LIBCAMERA_VARIANT=$(LIBCAMERA_VARIANT) (expected trixie, bookworm, or bullseye)"; exit 1; fi
	@echo "Building libcamera shared library (variant=$(LIBCAMERA_VARIANT), base=$(BASE_IMAGE))..."
	@mkdir -p "$(LIBCAMERA_WORK_BUILD)"
	@cp "$(LIBCAMERA_DOCKERFILE)" "$(LIBCAMERA_WORK_BUILD)/Dockerfile"
	@cp "$(LIBCAMERA_BUILD_SCRIPT)" "$(LIBCAMERA_WORK_BUILD)/build.sh"
	@chmod +x "$(LIBCAMERA_WORK_BUILD)/build.sh"
	docker buildx build --platform linux/arm64 --build-arg BASE_IMAGE=$(BASE_IMAGE) -t $(LIBCAMERA_IMAGE):$(DOCKER_TAG) -f "$(LIBCAMERA_WORK_BUILD)/Dockerfile" --load "$(LIBCAMERA_WORK_BUILD)"
	ROOT_DIR=$(WORKSPACE_ROOT) \
	LIBCAMERA_REPO=$(LIBCAMERA_REPO) \
	LIBCAMERA_VERSION=$(LIBCAMERA_VERSION) \
	LIBCAMERA_SRC_DIR=$(LIBCAMERA_SRC_DIR) \
	LIBCAMERA_BUILD_DIR=$(LIBCAMERA_BUILD_DIR) \
	LIBCAMERA_INSTALL_DIR=$(LIBCAMERA_INSTALL_DIR) \
	BUILD_IMAGE=$(LIBCAMERA_IMAGE):$(DOCKER_TAG) \
	"$(LIBCAMERA_WORK_BUILD)/build.sh"

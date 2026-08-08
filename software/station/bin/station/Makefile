# Makefile for building station binary for ARM64 and AMD64 Linux using cargo-zigbuild

# Configuration
TARGET_ARM64_BASE := aarch64-unknown-linux-gnu
TARGET_AMD64 := x86_64-unknown-linux-gnu

# Use rustup-managed rustc (Homebrew rustc lacks cross-compilation targets)
RUSTC := $(shell rustup which rustc 2>/dev/null)
export RUSTC
BINARY_NAME := station
OUTPUT_DIR_ARM64 := target/$(TARGET_ARM64_BASE)/release
OUTPUT_DIR_AMD64 := target/$(TARGET_AMD64)/release
PACKAGE := station
WORKSPACE_ROOT := $(shell cd ../../../.. && pwd)
LIBCAMERA_VERSION ?= 0.7.0

# Build flags
FEATURES ?=
empty :=
space := $(empty) $(empty)
comma := ,
FEATURE_WORDS := $(strip $(subst $(comma),$(space),$(FEATURES)))
FEATURES_EXPANDED := $(strip $(FEATURE_WORDS) $(if $(filter yahboom-dogzilla-lite,$(FEATURE_WORDS)),ov5647,))
FEATURES_UNIQUE := $(subst $(space),$(comma),$(sort $(FEATURES_EXPANDED)))
CARGO_FEATURES := $(if $(FEATURES_UNIQUE),--features $(FEATURES_UNIQUE),)
CARGO_FLAGS := --release --package=$(PACKAGE) $(CARGO_FEATURES)

HAS_LIBCAMERA := $(filter ov5647,$(FEATURES_EXPANDED))

# 2.36 (default when ov5647 is on) = Raspberry Pi OS 5 / Debian Bookworm
# 2.31 = Raspberry Pi OS 4 / Debian Bullseye
GLIBC ?= $(if $(HAS_LIBCAMERA),2.36,)
LIBCAMERA_VARIANT_2.36 := bookworm
LIBCAMERA_VARIANT_2.31 := bullseye
LIBCAMERA_VARIANT := $(LIBCAMERA_VARIANT_$(GLIBC))
LIBCAMERA_DIR_SUFFIX := $(if $(LIBCAMERA_VARIANT),-$(LIBCAMERA_VARIANT),)
LIBCAMERA_INSTALL_DIR := $(WORKSPACE_ROOT)/shared/libcamera/library/$(LIBCAMERA_VERSION)$(LIBCAMERA_DIR_SUFFIX)
LIBCAMERA_LIB_DIR := $(LIBCAMERA_INSTALL_DIR)/usr/lib/aarch64-linux-gnu
LIBCAMERA_PKG_CONFIG_PATH := $(LIBCAMERA_LIB_DIR)/pkgconfig

LIBCAMERA_ENV := \
	PKG_CONFIG_LIBDIR=$(LIBCAMERA_PKG_CONFIG_PATH) \
	PKG_CONFIG_ALLOW_CROSS=1 \
	LIBCAMERA_LIB_DIR=$(LIBCAMERA_LIB_DIR)
BUILD_ENV := $(if $(HAS_LIBCAMERA),$(LIBCAMERA_ENV),)

TARGET_ARM64 := $(if $(GLIBC),$(TARGET_ARM64_BASE).$(GLIBC),$(TARGET_ARM64_BASE))

.PHONY: all build client build-macos build-arm64 build-amd64 clean help libcamera-preflight

all: build

build: client
	@echo "Building station..."
	cargo build $(CARGO_FLAGS)
	@echo "=========================================================================================================="
	@echo "Binary built at: "
	@realpath ../../../../target/release/$(BINARY_NAME)

libcamera-preflight:
	@if [ -n "$(HAS_LIBCAMERA)" ] && [ -z "$(LIBCAMERA_VARIANT)" ]; then \
		echo "ov5647 requires GLIBC=2.36 or GLIBC=2.31 (got '$(GLIBC)')"; \
		exit 1; \
	fi
	@if [ -n "$(HAS_LIBCAMERA)" ] && [ ! -d "$(LIBCAMERA_INSTALL_DIR)" ]; then \
		echo "Missing $(LIBCAMERA_INSTALL_DIR)."; \
		echo "Build it first: make -C $(WORKSPACE_ROOT)/shared/libcamera build-libcamera LIBCAMERA_VARIANT=$(LIBCAMERA_VARIANT)"; \
		exit 1; \
	fi

# Build the station binary for ARM64 Linux
build-arm64: libcamera-preflight client
	@echo "Building station for ARM64 Linux using cargo-zigbuild..."
	ulimit -n 10240 && $(BUILD_ENV) cargo zigbuild $(CARGO_FLAGS) --target=$(TARGET_ARM64)
	@echo "Binary built at: $(OUTPUT_DIR_ARM64)/$(BINARY_NAME)"

# Build the station binary for AMD64 Linux
build-amd64: client
	@echo "Building station for AMD64 Linux using cargo-zigbuild..."
	ulimit -n 10240 && cargo zigbuild $(CARGO_FLAGS) --target=$(TARGET_AMD64)
	@echo "Binary built at: $(OUTPUT_DIR_AMD64)/$(BINARY_NAME)"

# Build the client
client:
	@echo "Building client..."
	cd ../../clients/station-viewer && npm ci && npm run build

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	cargo clean

# Show help
help:
	@echo "Station Multi-Architecture Linux Build Makefile"
	@echo ""
	@echo "Prerequisites:"
	@echo "  cargo-zigbuild must be installed: cargo install cargo-zigbuild"
	@echo ""
	@echo "Targets:"
	@echo "  all         - Build binaries for both architectures (default)"
	@echo "  build       - Build binaries for both ARM64 and AMD64 Linux"
	@echo "  client      - Build the client"
	@echo "  build-arm64 - Build the station binary for ARM64 Linux"
	@echo "  build-amd64 - Build the station binary for AMD64 Linux"
	@echo "  clean       - Clean build artifacts"
	@echo "  help        - Show this help message"
	@echo ""
	@echo "Usage:"
	@echo "  make                    # Build both architectures"
	@echo "  make build-arm64        # Build only ARM64"
	@echo "  make FEATURES=ov5647 build-arm64  # Build ARM64 with libcamera/ov5647 support"
	@echo "  make FEATURES=yahboom-dogzilla-lite build-arm64  # Build ARM64 with Yahboom Dogzilla Lite and ov5647 support"
	@echo "  make build-amd64        # Build only AMD64"
	@echo "  make clean              # Clean everything"

# Makefile for building station binary for ARM64 and AMD64 Linux using cargo-zigbuild

# Configuration
TARGET_ARM64 := aarch64-unknown-linux-gnu
TARGET_AMD64 := x86_64-unknown-linux-gnu
BINARY_NAME := station
OUTPUT_DIR_ARM64 := target/$(TARGET_ARM64)/release
OUTPUT_DIR_AMD64 := target/$(TARGET_AMD64)/release
PACKAGE := station

# Build flags
CARGO_FLAGS := --release --package=$(PACKAGE)

.PHONY: all build client build-arm64 build-amd64 clean help

all: build

build: client
	@echo "Building station..."
	cargo build $(CARGO_FLAGS)
	@echo "=========================================================================================================="
	@echo "Binary built at: "
	@realpath ../../../../target/release/$(BINARY_NAME)

# Build the station binary for ARM64 Linux
build-arm64: client
	@echo "Building station for ARM64 Linux using cargo-zigbuild..."
	cargo zigbuild $(CARGO_FLAGS) --target=$(TARGET_ARM64)
	@echo "Binary built at: $(OUTPUT_DIR_ARM64)/$(BINARY_NAME)"

# Build the station binary for AMD64 Linux
build-amd64: client
	@echo "Building station for AMD64 Linux using cargo-zigbuild..."
	cargo zigbuild $(CARGO_FLAGS) --target=$(TARGET_AMD64)
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
	@echo "  make build-amd64        # Build only AMD64"
	@echo "  make clean              # Clean everything"

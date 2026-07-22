#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${ROOT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LIBCAMERA_REPO="${LIBCAMERA_REPO:-https://github.com/raspberrypi/libcamera.git}"
LIBCAMERA_VERSION="${LIBCAMERA_VERSION:-0.7.0}"
LIBCAMERA_TAG="v${LIBCAMERA_VERSION}"

LIBCAMERA_SRC_DIR="${LIBCAMERA_SRC_DIR:-libcamera}"
LIBCAMERA_BUILD_DIR="${LIBCAMERA_BUILD_DIR:-build-shared}"
LIBCAMERA_INSTALL_DIR="${LIBCAMERA_INSTALL_DIR:-libcamera-install-shared}"
BUILD_IMAGE="${BUILD_IMAGE:-libcamera-build-deps}"

echo "=== Build libcamera (shared) ==="

if [ ! -d "$ROOT_DIR/$LIBCAMERA_SRC_DIR/.git" ]; then
    echo "=== Cloning libcamera sources ==="
    rm -rf "$ROOT_DIR/$LIBCAMERA_SRC_DIR"
    git clone "$LIBCAMERA_REPO" "$ROOT_DIR/$LIBCAMERA_SRC_DIR"
fi

git -C "$ROOT_DIR/$LIBCAMERA_SRC_DIR" fetch --all --tags --prune
git -C "$ROOT_DIR/$LIBCAMERA_SRC_DIR" checkout "$LIBCAMERA_TAG"
git -C "$ROOT_DIR/$LIBCAMERA_SRC_DIR" reset --hard "$LIBCAMERA_TAG"
git -C "$ROOT_DIR/$LIBCAMERA_SRC_DIR" clean -fdx

docker run --platform=linux/arm64 --rm \
    --user "$(id -u):$(id -g)" \
    -v "$ROOT_DIR:/mnt" \
    -w /mnt \
    "$BUILD_IMAGE" bash -c '
set -e

echo "=== Building shared libcamera ==="
cd /mnt/'"$LIBCAMERA_SRC_DIR"'

rm -rf /mnt/'"$LIBCAMERA_SRC_DIR"'/'"$LIBCAMERA_BUILD_DIR"' /mnt/'"$LIBCAMERA_INSTALL_DIR"'

meson setup '"$LIBCAMERA_BUILD_DIR"' \
    --default-library=shared \
    --prefix=/usr \
    --libdir=lib/aarch64-linux-gnu \
    -Dpipelines=rpi/vc4,rpi/pisp \
    -Dipas=rpi/vc4,rpi/pisp \
    -Dgstreamer=disabled \
    -Dv4l2=disabled \
    -Dcam=disabled \
    -Dqcam=disabled \
    -Ddocumentation=disabled \
    -Dtest=false \
    -Dtracing=disabled \
    -Dpycamera=disabled \
    -Dlc-compliance=disabled

echo "Building libcamera (this may take a while)..."
ninja -C '"$LIBCAMERA_BUILD_DIR"' -j2

DESTDIR=/mnt/'"$LIBCAMERA_INSTALL_DIR"' ninja -C '"$LIBCAMERA_BUILD_DIR"' install

sed -i "s|^prefix=/usr|prefix='"$ROOT_DIR/$LIBCAMERA_INSTALL_DIR"'/usr|" \
    /mnt/'"$LIBCAMERA_INSTALL_DIR"'/usr/lib/aarch64-linux-gnu/pkgconfig/*.pc

echo "=== Shared libcamera built successfully ==="
cd /mnt

echo "=== Building C++ wrapper static library ==="
WRAPPER_SRC="/mnt/shared/libcamera-sys-static"
WRAPPER_OUT="/mnt/'"$LIBCAMERA_INSTALL_DIR"'/usr/lib/aarch64-linux-gnu"
INCLUDE_DIR="/mnt/'"$LIBCAMERA_INSTALL_DIR"'/usr/include/libcamera"

# Build wrapper as a pre-linked static library using GCC.
# The wrapper is relocatable-linked with libstdc++ so all C++ standard
# library symbols are resolved internally. Only libcamera and glibc
# symbols remain unresolved for the final link with cargo-zigbuild.
# A compat stub provides __isoc23_strtoul for glibc < 2.38 targets.

cat > /tmp/glibc_compat.c << COMPAT_EOF
#include <stdlib.h>
__attribute__((weak))
unsigned long __isoc23_strtoul(const char *nptr, char **endptr, int base) {
    return strtoul(nptr, endptr, base);
}
COMPAT_EOF

gcc -c -fPIC -O2 /tmp/glibc_compat.c -o /tmp/glibc_compat.o

g++ -c -std=c++17 -fPIC -O2 -fno-exceptions -fno-rtti \
    -ffunction-sections -fdata-sections \
    -I"$INCLUDE_DIR" \
    "$WRAPPER_SRC/wrapper.cpp" \
    -o /tmp/wrapper.o

LIBSTDCPP_A=$(g++ -print-file-name=libstdc++.a)
ROOTS=$(nm -g /tmp/wrapper.o | sed -n "s/.* T \(lc_.*\)$/-u \1/p" | tr "\n" " ")

# No --gc-sections: on older binutils (bullseye, 2.35) it corrupts
# exception-table relocations at this intermediate relocatable-link stage
# ("relocation refers to a discarded section" in the final lld link). The
# final Rust link does its own gc-sections pass anyway.
ld -r $ROOTS -o /tmp/camera_wrapper.o \
    /tmp/wrapper.o /tmp/glibc_compat.o "$LIBSTDCPP_A"

ar rcs "$WRAPPER_OUT/libcamera_wrapper.a" /tmp/camera_wrapper.o
echo "Wrapper library built: $WRAPPER_OUT/libcamera_wrapper.a ($(du -h "$WRAPPER_OUT/libcamera_wrapper.a" | cut -f1))"

echo "Libraries available:"
ls -la "$WRAPPER_OUT"/libcamera*.{so*,a} 2>/dev/null || echo "No library files found"
'

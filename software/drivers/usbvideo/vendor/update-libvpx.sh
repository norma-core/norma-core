#!/usr/bin/env bash
# Re-vendors the VP8-only, plain-C subset of libvpx that build.rs compiles.
# The subset and its generated headers come from a pinned release tarball,
# configured for generic-gnu so the same files build for every target.
set -euo pipefail

LIBVPX_VERSION="${LIBVPX_VERSION:-1.15.2}"
LIBVPX_SHA256="${LIBVPX_SHA256:-26fcd3db88045dee380e581862a6ef106f49b74b6396ee95c2993a260b4636aa}"
LIBVPX_URL="https://github.com/webmproject/libvpx/archive/refs/tags/v${LIBVPX_VERSION}.tar.gz"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/libvpx"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "$LIBVPX_URL" -o "$WORK/libvpx.tar.gz"
echo "${LIBVPX_SHA256}  $WORK/libvpx.tar.gz" | shasum -a 256 -c -
tar xzf "$WORK/libvpx.tar.gz" -C "$WORK"
SRC="$WORK/libvpx-${LIBVPX_VERSION}"

mkdir "$WORK/build"
(cd "$WORK/build" && "$SRC/configure" --target=generic-gnu \
    --enable-vp8 --disable-vp9 --disable-multithread --enable-static --disable-shared \
    --enable-pic --disable-examples --disable-tools --disable-docs --disable-unit-tests \
    --disable-install-docs --disable-install-bins --disable-webm-io --disable-libyuv >/dev/null \
  && make -j"$(getconf _NPROCESSORS_ONLN)" libvpx.a >/dev/null)

# Exactly the sources libvpx.a was built from, and every header they include.
(cd "$WORK/build" && find . -name '*.c.o' | sed 's#^\./##; s#\.o$##' | grep -v '^vpx_config\.c$' | sort) > "$WORK/sources"
: > "$WORK/deps"
while read -r f; do
  cc -MM -I"$WORK/build" -I"$SRC" "$SRC/$f" >> "$WORK/deps"
done < "$WORK/sources"
tr ' \\' '\n\n' < "$WORK/deps" | grep -E '\.(c|h)$' | grep -v ':$' \
  | grep "^$SRC/" | sed "s#^$SRC/##" | sort -u > "$WORK/files"

rm -rf "$DEST"
mkdir -p "$DEST/config"
while read -r f; do
  mkdir -p "$DEST/$(dirname "$f")"
  cp "$SRC/$f" "$DEST/$f"
done < "$WORK/files"
cp "$SRC/LICENSE" "$SRC/PATENTS" "$SRC/AUTHORS" "$DEST/"
for f in vpx_config.h vpx_config.c vpx_version.h vp8_rtcd.h vpx_dsp_rtcd.h vpx_scale_rtcd.h; do
  cp "$WORK/build/$f" "$DEST/config/$f"
done
{ cat "$WORK/sources"; echo vpx_config.c; } > "$DEST/sources.txt"
echo "libvpx ${LIBVPX_VERSION} (sha256 ${LIBVPX_SHA256})" > "$DEST/VERSION"

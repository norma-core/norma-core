#!/usr/bin/env bash
# Re-vendors the VP8-only subset of libvpx that build.rs compiles, with the
# headers libvpx's configure generates for each kind of target build.rs
# knows: generic (plain C), arm64 (NEON intrinsics) and x86_64 (SSE2..AVX2
# intrinsics plus nasm sources). Everything comes from a pinned release
# tarball; configure and the dependency scan run in Debian containers so
# the result does not depend on the host.
set -euo pipefail

LIBVPX_VERSION="${LIBVPX_VERSION:-1.15.2}"
LIBVPX_SHA256="${LIBVPX_SHA256:-26fcd3db88045dee380e581862a6ef106f49b74b6396ee95c2993a260b4636aa}"
LIBVPX_URL="https://github.com/webmproject/libvpx/archive/refs/tags/v${LIBVPX_VERSION}.tar.gz"
IMAGE="${IMAGE:-debian:bookworm-slim}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/libvpx"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "$LIBVPX_URL" -o "$WORK/libvpx.tar.gz"
echo "${LIBVPX_SHA256}  $WORK/libvpx.tar.gz" | shasum -a 256 -c -
tar xzf "$WORK/libvpx.tar.gz" -C "$WORK"
mv "$WORK/libvpx-${LIBVPX_VERSION}" "$WORK/src"

COMMON="--enable-vp8 --disable-vp9 --disable-postproc --disable-multithread \
  --enable-static --disable-shared --enable-pic --disable-examples --disable-tools \
  --disable-docs --disable-unit-tests --disable-install-docs --disable-install-bins \
  --disable-webm-io --disable-libyuv"

# name platform configure-target extra-flags
configure() {
  local name="$1" platform="$2" target="$3" extra="$4"
  mkdir -p "$WORK/$name"
  docker run --rm --platform "$platform" -v "$WORK:/w" -w "/w/$name" "$IMAGE" sh -ec "
    apt-get update -qq >/dev/null
    apt-get install -y -qq gcc make nasm perl >/dev/null 2>&1
    ../src/configure --target=$target $COMMON $extra >/dev/null
    make -j\$(nproc) libvpx.a >/dev/null 2>&1
    # Exactly the sources libvpx.a was built from, and every header they include.
    find . -name '*.o' | sed 's#^\./##; s#\.o\$##' | grep -v '^vpx_config\.c\$' | sort > sources.txt
    : > deps
    grep '\.c\$' sources.txt | while read -r f; do gcc -MM -I. -I../src ../src/\$f >> deps; done
    grep '\.asm\$' sources.txt | while read -r f; do
      echo \$f >> deps
      grep -ho '%include \"[^\"]*\"' ../src/\$f | cut -d'\"' -f2 >> deps || true
    done
  "
}

configure generic linux/amd64 generic-gnu ""
configure arm64 linux/arm64 arm64-linux-gcc "--disable-neon_dotprod --disable-neon_i8mm --disable-sve --disable-sve2"
configure x86_64 linux/amd64 x86_64-linux-gcc "--as=nasm --disable-avx512"

rm -rf "$DEST"
mkdir -p "$DEST"
for name in generic arm64 x86_64; do
  b="$WORK/$name"
  tr ' \\' '\n\n' < "$b/deps" | grep -E '\.(c|h|asm)$' | grep -v ':$' \
    | sed 's#^\.\./src/##' | grep -vE '^(\./)?(vpx_config\.(h|asm)|[a-z0-9_]+_rtcd\.h|vpx_version\.h)$' \
    | grep -v '^/' >> "$WORK/files"
  mkdir -p "$DEST/config/$name"
  for f in vpx_config.h vpx_config.c vpx_config.asm vpx_version.h vp8_rtcd.h vpx_dsp_rtcd.h vpx_scale_rtcd.h; do
    if [ -f "$b/$f" ]; then cp "$b/$f" "$DEST/config/$name/$f"; fi
  done
  { cat "$b/sources.txt"; echo vpx_config.c; } > "$DEST/config/$name/sources.txt"
done
sort -u "$WORK/files" | while read -r f; do
  mkdir -p "$DEST/$(dirname "$f")"
  cp "$WORK/src/$f" "$DEST/$f"
done
cp "$WORK/src/LICENSE" "$WORK/src/PATENTS" "$WORK/src/AUTHORS" "$DEST/"
echo "libvpx ${LIBVPX_VERSION} (sha256 ${LIBVPX_SHA256})" > "$DEST/VERSION"

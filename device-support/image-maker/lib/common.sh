#!/usr/bin/env bash
# Shared helpers for the image-maker tool (build + customize subcommands).
#
# Sourced by build.sh and customize.sh. The caller is expected to have set
# `image_maker_dir` before sourcing (build_packer_image uses it), and to set
# `PACKER_IMAGE` before calling build_packer_image.

die() {
  printf '[image-maker] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[image-maker] %s\n' "$*" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

shell_quote() {
  printf '%q' "$1"
}

require_build_arg_value() {
  local option value
  option="$1"
  value="${2:-}"

  case "$value" in
    ""|-*) die "$option requires a value" ;;
  esac
}

sha256_file() {
  local file
  file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{ print $1 }'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{ print $1 }'
    return
  fi

  die "missing sha256sum or shasum"
}

verify_sha256() {
  local expected actual file
  expected="$1"
  file="$2"

  [ -n "$expected" ] || return 0
  actual="$(sha256_file "$file")"
  [ "$actual" = "$expected" ] || die "sha256 mismatch for $file: expected $expected, got $actual"
}

docker_image_exists() {
  docker image inspect "$1" >/dev/null 2>&1
}

host_is_wsl() {
  grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null
}

require_docker() {
  require_command docker

  if ! docker info >/dev/null 2>&1; then
    die "cannot reach the Docker daemon — start Docker Desktop (macOS/Windows) or dockerd (Linux) and retry"
  fi
}

# image_maker_dir and PACKER_IMAGE are provided by the sourcing entrypoint.
# shellcheck disable=SC2154
build_packer_image() {
  require_command docker

  log "building image-maker packer"
  if docker buildx version >/dev/null 2>&1; then
    docker buildx build \
      --load \
      -f "$image_maker_dir/packer/Dockerfile" \
      -t "$PACKER_IMAGE" \
      "$image_maker_dir/packer"
  else
    docker build \
      -f "$image_maker_dir/packer/Dockerfile" \
      -t "$PACKER_IMAGE" \
      "$image_maker_dir/packer"
  fi

  docker_image_exists "$PACKER_IMAGE" ||
    die "packer image was not loaded into the local Docker daemon: $PACKER_IMAGE"
}

#!/usr/bin/env bash
set -euo pipefail

program_name="$(basename "$0")"
image_maker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$image_maker_dir/../.." && pwd)"

# shellcheck source=lib/common.sh
. "$image_maker_dir/lib/common.sh"

usage() {
  cat >&2 <<EOF
Usage:
  $program_name build --image <name> [--base <raw-image>] [--output <image>]
  $program_name build --config <path> [--base <raw-image>] [--output <image>]

Builds a credential-free "golden" image with all software and drivers baked in.
End users add their Wi-Fi, SSH, and Tailscale credentials afterwards with
\`image-maker customize\` — this command does not prompt for them.

Supported SOURCE_TYPE values:
  disk-image       apply an overlay to an existing partitioned image
  rootfs-container export a container rootfs and pack it as an image
EOF
}

abs_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$repo_root/$1" ;;
  esac
}

preflight_checks() {
  require_docker

  # The packer and overlay run as $IMAGE_PLATFORM. If that differs from the host
  # architecture, Docker needs QEMU/binfmt emulation. Docker Desktop ships it;
  # native Linux hosts may not, so verify and point at the fix.
  if ! docker run --rm --platform "$IMAGE_PLATFORM" alpine:3.20 true >/dev/null 2>&1; then
    die "cannot run $IMAGE_PLATFORM containers on this host — install binfmt emulation with:
    docker run --privileged --rm tonistiigi/binfmt --install all"
  fi

  if host_is_wsl; then
    case "$repo_root" in
      /mnt/*) log "note: running from a Windows-mounted path ($repo_root); cloning into the WSL filesystem (e.g. ~/) is faster and avoids permission issues" ;;
    esac
  fi
}

load_config() {
  local config
  config="$(abs_path "$1")"

  [ -f "$config" ] || die "config not found: $config"

  IMAGE_DIR="$(cd "$(dirname "$config")" && pwd)"
  REPO_ROOT="$repo_root"
  IMAGE_MAKER_DIR="$image_maker_dir"
  export IMAGE_DIR REPO_ROOT IMAGE_MAKER_DIR

  # shellcheck disable=SC1090
  . "$config"

  [ -n "${IMAGE_NAME:-}" ] || die "IMAGE_NAME is required"
  [ -n "${SOURCE_TYPE:-}" ] || die "SOURCE_TYPE is required"

  IMAGE_PLATFORM="${IMAGE_PLATFORM:-linux/arm64}"
  PACKER_IMAGE="norma-image-maker-packer:local"
  WORK_DIR="$repo_root/target/image-maker/$IMAGE_NAME"
  OUTPUT_IMAGE="$repo_root/target/images/$IMAGE_NAME.img"
  PACK_SCRIPT="$IMAGE_DIR/pack.sh"
  IMAGE_DOCKERFILE="$IMAGE_DIR/image.dockerfile"
  STAGING_DIR="$WORK_DIR/staging"
  OVERLAY_DIR="$WORK_DIR/overlay"

  export IMAGE_NAME IMAGE_PLATFORM WORK_DIR OUTPUT_IMAGE PACK_SCRIPT IMAGE_DOCKERFILE
  export STAGING_DIR OVERLAY_DIR PACKER_IMAGE
}

stage_image() {
  log "staging image inputs"
  rm -rf "$STAGING_DIR" "$OVERLAY_DIR"
  mkdir -p "$STAGING_DIR" "$OVERLAY_DIR"

  if [ -f "$PACK_SCRIPT" ]; then
    # shellcheck disable=SC1090
    . "$PACK_SCRIPT"
  fi
}

build_image_overlay() {
  local kv
  local build_args=()

  [ -f "$IMAGE_DOCKERFILE" ] || return 0

  # Forward arch (and other) knobs from image.conf so the overlay isn't pinned
  # to a single architecture. Each entry is a "KEY=value" --build-arg pair.
  if declare -p OVERLAY_BUILD_ARGS >/dev/null 2>&1; then
    for kv in "${OVERLAY_BUILD_ARGS[@]}"; do
      [ -n "$kv" ] && build_args+=(--build-arg "$kv")
    done
  fi

  log "building image overlay"
  rm -rf "$OVERLAY_DIR"
  docker build \
    --platform "$IMAGE_PLATFORM" \
    "${build_args[@]+"${build_args[@]}"}" \
    -f "$IMAGE_DOCKERFILE" \
    --output "type=local,dest=$OVERLAY_DIR" \
    "$STAGING_DIR"
}

enable_systemd_units() {
  local source unit wants_dir

  declare -p ENABLE_SYSTEMD_UNITS >/dev/null 2>&1 || return 0

  wants_dir="$OVERLAY_DIR/root/etc/systemd/system/multi-user.target.wants"
  mkdir -p "$wants_dir"

  set +u
  for unit in "${ENABLE_SYSTEMD_UNITS[@]}"; do
    set -u
    [ -n "$unit" ] || continue
    if [ -f "$OVERLAY_DIR/root/etc/systemd/system/$unit" ]; then
      source="/etc/systemd/system/$unit"
    elif [ -f "$OVERLAY_DIR/root/lib/systemd/system/$unit" ]; then
      source="/lib/systemd/system/$unit"
    elif [ -f "$OVERLAY_DIR/root/usr/lib/systemd/system/$unit" ]; then
      source="/usr/lib/systemd/system/$unit"
    else
      source="/etc/systemd/system/$unit"
    fi
    ln -sf "$source" "$wants_dir/$unit"
    set +u
  done
  set -u
}

prepare_base_image() {
  [ -n "${BASE_IMAGE_URL:-}" ] || die "BASE_IMAGE_URL is required for disk-image source"
  [ -n "${BASE_IMAGE_ARCHIVE:-}" ] || die "BASE_IMAGE_ARCHIVE is required for disk-image source"
  [ -n "${BASE_IMAGE_RAW:-}" ] || die "BASE_IMAGE_RAW is required for disk-image source"

  BASE_IMAGE_ARCHIVE="$(abs_path "$BASE_IMAGE_ARCHIVE")"
  BASE_IMAGE_RAW="$(abs_path "$BASE_IMAGE_RAW")"
  mkdir -p "$(dirname "$BASE_IMAGE_ARCHIVE")" "$(dirname "$BASE_IMAGE_RAW")"

  if [ ! -f "$BASE_IMAGE_ARCHIVE" ]; then
    log "downloading base image"
    curl -fL --retry 3 -o "$BASE_IMAGE_ARCHIVE" "$BASE_IMAGE_URL"
  fi

  verify_sha256 "${BASE_IMAGE_SHA256:-}" "$BASE_IMAGE_ARCHIVE"

  if [ -f "$BASE_IMAGE_RAW" ] && [ ! "$BASE_IMAGE_ARCHIVE" -nt "$BASE_IMAGE_RAW" ]; then
    return
  fi

  log "extracting base image"
  case "${BASE_IMAGE_FORMAT:-raw}" in
    raw) cp "$BASE_IMAGE_ARCHIVE" "$BASE_IMAGE_RAW" ;;
    xz)
      # Prefer host xz; fall back to the packer image (ships xz-utils) so the
      # host needs only Docker. Streaming via stdin/stdout avoids bind mounts
      # and the path-translation quirks they bring on macOS/Windows.
      if command -v xz >/dev/null 2>&1; then
        xz -dc "$BASE_IMAGE_ARCHIVE" > "$BASE_IMAGE_RAW"
      else
        docker run --rm -i --entrypoint xz "$PACKER_IMAGE" -dc \
          < "$BASE_IMAGE_ARCHIVE" > "$BASE_IMAGE_RAW"
      fi
      ;;
    *) die "unsupported BASE_IMAGE_FORMAT: ${BASE_IMAGE_FORMAT}" ;;
  esac
}

base_image_path() {
  if [ -n "${BASE_OVERRIDE:-}" ]; then
    abs_path "$BASE_OVERRIDE"
    return
  fi

  prepare_base_image
  printf '%s\n' "$BASE_IMAGE_RAW"
}

build_from_disk_image() {
  local output_image source_image work_image
  output_image="$(abs_path "$OUTPUT_IMAGE")"
  source_image="$(base_image_path)"

  [ -f "$source_image" ] || die "base image not found: $source_image"
  mkdir -p "$(dirname "$output_image")" "$WORK_DIR"

  # Stage the working image inside $WORK_DIR and mount the directory rather than
  # the single .img file. Docker Desktop (macOS/Windows) mishandles single-file
  # bind mounts. OVERLAY_DIR is already $WORK_DIR/overlay, so one mount covers both.
  work_image="$WORK_DIR/image.img"
  log "creating output image"
  rm -f "$work_image"
  cp "$source_image" "$work_image"

  log "applying overlay"
  docker run --rm --privileged \
    -v "$WORK_DIR:/work" \
    "$PACKER_IMAGE" \
    apply-overlay \
    --image /work/image.img \
    --overlay /work/overlay \
    --boot-partition-number "${BOOT_PARTITION_NUMBER:-1}" \
    --root-partition-number "${ROOT_PARTITION_NUMBER:-2}"

  rm -f "$output_image"
  cp "$work_image" "$output_image"
  log "wrote $output_image"
}

build_from_rootfs_container() {
  local container_name output_image rootfs_context rootfs_tar
  output_image="$(abs_path "$OUTPUT_IMAGE")"
  rootfs_tar="$WORK_DIR/rootfs.tar"

  [ -n "${ROOTFS_IMAGE:-}" ] || die "ROOTFS_IMAGE is required for rootfs-container source"
  mkdir -p "$(dirname "$output_image")" "$WORK_DIR"

  if [ -n "${ROOTFS_DOCKERFILE:-}" ]; then
    rootfs_context="$(abs_path "${ROOTFS_CONTEXT:-$IMAGE_DIR}")"
    log "building rootfs container"
    docker build \
      --platform "$IMAGE_PLATFORM" \
      -f "$(abs_path "$ROOTFS_DOCKERFILE")" \
      -t "$ROOTFS_IMAGE" \
      "$rootfs_context"
  fi

  container_name="image-maker-${IMAGE_NAME}-rootfs-$$"
  log "exporting rootfs container"
  docker create --platform "$IMAGE_PLATFORM" --name "$container_name" "$ROOTFS_IMAGE" >/dev/null
  trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true' RETURN
  docker export --output "$rootfs_tar" "$container_name"
  docker rm "$container_name" >/dev/null
  trap - RETURN

  log "packing image"
  docker run --rm --privileged \
    -v "$WORK_DIR:/work" \
    -v "$OVERLAY_DIR:/work/overlay:ro" \
    "$PACKER_IMAGE" \
    pack-rootfs \
    --rootfs-tar /work/rootfs.tar \
    --output /work/output.img \
    --overlay /work/overlay \
    --image-size-mb "${IMAGE_SIZE_MB:-2048}" \
    --boot-size-mb "${BOOT_SIZE_MB:-256}"

  cp "$WORK_DIR/output.img" "$output_image"
  log "wrote $output_image"
}

run_build() {
  case "$SOURCE_TYPE" in
    disk-image)
      stage_image
      build_packer_image
      build_image_overlay
      enable_systemd_units
      build_from_disk_image
      ;;
    rootfs-container)
      stage_image
      build_packer_image
      build_image_overlay
      enable_systemd_units
      build_from_rootfs_container
      ;;
    *) die "unsupported SOURCE_TYPE: $SOURCE_TYPE" ;;
  esac
}

build_command() {
  local base_override config image output_override
  base_override=""
  config=""
  image=""
  output_override=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --base)
        require_build_arg_value "$1" "${2:-}"
        base_override="$2"
        shift 2
        ;;
      --config)
        require_build_arg_value "$1" "${2:-}"
        config="$2"
        shift 2
        ;;
      --image)
        require_build_arg_value "$1" "${2:-}"
        image="$2"
        shift 2
        ;;
      --output)
        require_build_arg_value "$1" "${2:-}"
        output_override="$2"
        shift 2
        ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown build argument: $1" ;;
    esac
  done

  if [ -n "$image" ]; then
    [ -z "$config" ] || die "use --image or --config, not both"
    config="$image_maker_dir/images/$image/image.conf"
  fi
  [ -n "$config" ] || die "build requires --image or --config"

  load_config "$config"
  preflight_checks
  [ -z "$base_override" ] || BASE_OVERRIDE="$base_override"
  [ -z "$output_override" ] || OUTPUT_IMAGE="$output_override"
  run_build
}

main() {
  case "${1:-}" in
    build) shift; build_command "$@" ;;
    -h|--help) usage ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"

#!/usr/bin/env bash
set -euo pipefail

program_name="$(basename "$0")"
image_maker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$image_maker_dir/../.." && pwd)"

die() {
  printf '[image-maker] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[image-maker] %s\n' "$*" >&2
}

usage() {
  cat >&2 <<EOF
Usage:
  $program_name build --image <name> [--base <raw-image>] [--output <image>]
  $program_name build --config <path> [--base <raw-image>] [--output <image>]

The build command prompts for Wi-Fi, Tailscale, and SSH user details.

Supported SOURCE_TYPE values:
  disk-image       apply an overlay to an existing partitioned image
  rootfs-container export a container rootfs and pack it as an image
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

shell_quote() {
  printf '%q' "$1"
}

require_interactive_cli() {
  [ -r /dev/tty ] && [ -w /dev/tty ] ||
    die "image builds require an interactive terminal for custom values"
}

prompt_line() {
  local default input prompt var_name
  var_name="$1"
  prompt="$2"
  default="${3:-}"

  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$prompt" "$default" >/dev/tty
  else
    printf '%s: ' "$prompt" >/dev/tty
  fi

  IFS= read -r input </dev/tty || die "failed to read $prompt"
  [ -n "$input" ] || input="$default"
  printf -v "$var_name" '%s' "$input"
}

prompt_secret() {
  local input prompt var_name
  var_name="$1"
  prompt="$2"

  printf '%s: ' "$prompt" >/dev/tty
  IFS= read -rs input </dev/tty || die "failed to read $prompt"
  printf '\n' >/dev/tty
  printf -v "$var_name" '%s' "$input"
}

prompt_required_line() {
  local prompt result var_name
  var_name="$1"
  prompt="$2"

  while true; do
    prompt_line result "$prompt"
    if [ -n "$result" ]; then
      printf -v "$var_name" '%s' "$result"
      return
    fi
    printf '%s is required.\n' "$prompt" >/dev/tty
  done
}

prompt_required_secret() {
  local prompt result var_name
  var_name="$1"
  prompt="$2"

  while true; do
    prompt_secret result "$prompt"
    if [ -n "$result" ]; then
      printf -v "$var_name" '%s' "$result"
      return
    fi
    printf '%s is required.\n' "$prompt" >/dev/tty
  done
}

normalize_country_code() {
  local country
  country="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"

  case "$country" in
    [A-Z][A-Z]) printf '%s' "$country" ;;
    *) return 1 ;;
  esac
}

country_from_locale() {
  local value
  value="${1%%.*}"
  value="${value%%@*}"

  case "$value" in
    *_??) normalize_country_code "${value##*_}" ;;
    *) return 1 ;;
  esac
}

detect_default_wifi_country() {
  local name value

  if command -v defaults >/dev/null 2>&1; then
    value="$(defaults read -g AppleLocale 2>/dev/null || true)"
    if [ -n "$value" ] && country_from_locale "$value"; then
      return
    fi
  fi

  for name in LC_ALL LC_CTYPE LANG; do
    value="${!name:-}"
    [ "$value" != "C" ] && [ "$value" != "POSIX" ] || continue
    if [ -n "$value" ] && country_from_locale "$value"; then
      return
    fi
  done

  printf 'US'
}

validate_custom_user_name() {
  [[ "$1" =~ ^[a-z_][a-z0-9_-]{0,30}$ ]]
}

is_reserved_custom_user_name() {
  case "$1" in
    root|station) return 0 ;;
    *) return 1 ;;
  esac
}

prompt_custom_user_name() {
  local user_name

  while true; do
    prompt_line user_name "SSH username" "norma"
    if validate_custom_user_name "$user_name" && ! is_reserved_custom_user_name "$user_name"; then
      IMAGE_CUSTOM_USER="$user_name"
      return
    fi
    printf 'SSH username must be a valid non-reserved Linux login name.\n' >/dev/tty
  done
}

prompt_custom_user_ssh_key() {
  local ssh_key

  while true; do
    prompt_required_line ssh_key "SSH public key"
    case "$ssh_key" in
      ssh-rsa\ *|ssh-ed25519\ *|ecdsa-sha2-nistp256\ *|ecdsa-sha2-nistp384\ *|ecdsa-sha2-nistp521\ *|sk-ssh-ed25519@openssh.com\ *|sk-ecdsa-sha2-nistp256@openssh.com\ *)
        IMAGE_CUSTOM_USER_SSH_KEY="$ssh_key"
        return
        ;;
      *)
        printf 'SSH public key must be a single OpenSSH public key line.\n' >/dev/tty
        ;;
    esac
  done
}

prompt_image_custom_values() {
  local country default_country

  require_interactive_cli
  printf 'Image custom values\n' >/dev/tty

  prompt_required_line IMAGE_WIFI_SSID "Wi-Fi SSID"
  prompt_required_secret IMAGE_WIFI_PASSWORD "Wi-Fi password"

  default_country="$(detect_default_wifi_country)"
  while true; do
    prompt_line country "Wi-Fi country" "$default_country"
    if IMAGE_WIFI_COUNTRY="$(normalize_country_code "$country")"; then
      break
    fi
    printf 'Wi-Fi country must be a two-letter country code.\n' >/dev/tty
  done

  prompt_secret IMAGE_TAILSCALE_AUTH_KEY "Tailscale auth key (empty to skip)"
  if [ -n "$IMAGE_TAILSCALE_AUTH_KEY" ]; then
    prompt_line IMAGE_TAILSCALE_AUTH_SERVER "Tailscale login server (empty for default)"
  else
    IMAGE_TAILSCALE_AUTH_SERVER=""
  fi

  prompt_custom_user_name
  prompt_custom_user_ssh_key
}

abs_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$repo_root/$1" ;;
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

preflight_checks() {
  require_command docker

  if ! docker info >/dev/null 2>&1; then
    die "cannot reach the Docker daemon — start Docker Desktop (macOS/Windows) or dockerd (Linux) and retry"
  fi

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

require_build_arg_value() {
  local option value
  option="$1"
  value="${2:-}"

  case "$value" in
    ""|-*) die "$option requires a value" ;;
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
  prompt_image_custom_values
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

#!/usr/bin/env bash
set -euo pipefail

program_name="image-maker customize"
image_maker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$image_maker_dir/../.." && pwd)"

# shellcheck source=lib/common.sh
. "$image_maker_dir/lib/common.sh"
# shellcheck source=lib/credentials.sh
. "$image_maker_dir/lib/credentials.sh"

PACKER_IMAGE="norma-image-maker-packer:local"

usage() {
  cat >&2 <<EOF
Usage:
  $program_name --image <name> [options]
  $program_name --input-image <golden.img> [--output-image <device.img>] [options]

Writes Wi-Fi, SSH user, and Tailscale credentials into a copy of a golden
NormaCore image (built with \`image-maker build\`) and writes the personalized
result to <device.img>, ready to flash. Docker is the only requirement — no
root, no --privileged, no base-image download.

Options:
  -n, --image <name>             shorthand that reads
                                 device-support/image-maker/images/<name>/golden-image.img
                                 and writes target/images/<name>.img
  -i, --input-image <img>        golden image to read (required unless --image)
  -o, --output-image <img>       personalized image to write
                                 (default: target/images/<input filename>)
      --root-partition-number N  ext4 root partition number (default: 2)
      --reset-firstboot          also clear /etc/.firstboot_done so a reused card re-provisions
      --non-interactive          require credentials via env vars; never prompt
      --force                    overwrite <device.img> if it already exists
  -h, --help                     show this help

Credentials may be supplied via environment variables. When all required ones
are set, prompts are skipped:
  IMAGE_WIFI_SSID, IMAGE_WIFI_PASSWORD, IMAGE_WIFI_COUNTRY   (required)
  IMAGE_CUSTOM_USER, IMAGE_CUSTOM_USER_SSH_KEY               (required)
  IMAGE_TAILSCALE_AUTH_KEY, IMAGE_TAILSCALE_AUTH_SERVER      (optional)
EOF
}

abs_path_cwd() {
  # Resolve a possibly-relative path to absolute, relative to the current dir.
  local base dir
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *)
      dir="$(dirname "$1")"
      base="$(basename "$1")"
      printf '%s/%s\n' "$(cd "$dir" && pwd)" "$base"
      ;;
  esac
}

credentials_in_env() {
  [ -n "${IMAGE_WIFI_SSID:-}" ] &&
    [ -n "${IMAGE_WIFI_PASSWORD:-}" ] &&
    [ -n "${IMAGE_WIFI_COUNTRY:-}" ] &&
    [ -n "${IMAGE_CUSTOM_USER:-}" ] &&
    [ -n "${IMAGE_CUSTOM_USER_SSH_KEY:-}" ]
}

validate_env_credentials() {
  local normalized
  normalized="$(normalize_country_code "$IMAGE_WIFI_COUNTRY")" ||
    die "IMAGE_WIFI_COUNTRY must be a two-letter country code"
  IMAGE_WIFI_COUNTRY="$normalized"

  if ! validate_custom_user_name "$IMAGE_CUSTOM_USER" ||
    is_reserved_custom_user_name "$IMAGE_CUSTOM_USER"; then
    die "IMAGE_CUSTOM_USER must be a valid non-reserved Linux login name"
  fi

  validate_custom_user_ssh_key "$IMAGE_CUSTOM_USER_SSH_KEY" ||
    die "IMAGE_CUSTOM_USER_SSH_KEY must be a single OpenSSH public key line"

  IMAGE_TAILSCALE_AUTH_KEY="${IMAGE_TAILSCALE_AUTH_KEY:-}"
  IMAGE_TAILSCALE_AUTH_SERVER="${IMAGE_TAILSCALE_AUTH_SERVER:-}"
}

gather_credentials() {
  local non_interactive
  non_interactive="$1"

  if credentials_in_env; then
    validate_env_credentials
    return
  fi

  if [ "$non_interactive" = 1 ]; then
    die "missing required credentials; set the IMAGE_* env vars (see --help) or drop --non-interactive"
  fi

  prompt_image_custom_values
}

customize_command() {
  local force image_name input non_interactive output reset_firstboot root_part work_dir
  local -a inject_args
  force=0
  image_name=""
  input=""
  non_interactive=0
  output=""
  reset_firstboot=0
  root_part=2

  while [ "$#" -gt 0 ]; do
    case "$1" in
      -n|--image)
        require_build_arg_value "$1" "${2:-}"; image_name="$2"; shift 2 ;;
      -i|--input-image)
        require_build_arg_value "$1" "${2:-}"; input="$2"; shift 2 ;;
      -o|--output-image)
        require_build_arg_value "$1" "${2:-}"; output="$2"; shift 2 ;;
      --root-partition-number)
        require_build_arg_value "$1" "${2:-}"; root_part="$2"; shift 2 ;;
      --reset-firstboot) reset_firstboot=1; shift ;;
      --non-interactive) non_interactive=1; shift ;;
      --force) force=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown customize argument: $1" ;;
    esac
  done

  if [ -n "$image_name" ]; then
    [ -n "$input" ] && die "--image cannot be combined with --input-image"
    input="$repo_root/device-support/image-maker/images/$image_name/golden-image.img"
    [ -n "$output" ] || output="$repo_root/target/images/$image_name.img"
  fi

  [ -n "$input" ] || die "customize requires --image or --input-image"

  input="$(abs_path_cwd "$input")"
  [ -f "$input" ] || die "input image not found: $input"

  [ -n "$output" ] || output="$repo_root/target/images/$(basename "$input")"

  mkdir -p "$(dirname "$output")"
  output="$(abs_path_cwd "$output")"
  if [ -e "$output" ] && [ "$force" != 1 ]; then
    die "output already exists: $output (pass --force to overwrite)"
  fi

  require_docker
  if host_is_wsl; then
    case "$input$output" in
      *"/mnt/"*) log "note: operating on a Windows-mounted path; the WSL filesystem (~/) is faster" ;;
    esac
  fi

  gather_credentials "$non_interactive"

  work_dir="$(mktemp -d "$(dirname "$output")/.image-maker-customize.XXXXXX")" ||
    die "failed to create work directory next to $output"
  # shellcheck disable=SC2064
  trap "rm -rf '$work_dir'" EXIT

  render_firstboot_config "$work_dir/firstboot.conf"

  build_packer_image

  log "copying golden image"
  cp "$input" "$work_dir/image.img"

  inject_args=(
    inject-firstboot
    --image /work/image.img
    --config /work/firstboot.conf
    --root-partition-number "$root_part"
  )
  [ "$reset_firstboot" = 1 ] && inject_args+=(--reset-firstboot)

  log "injecting credentials"
  docker run --rm \
    -v "$work_dir:/work" \
    "$PACKER_IMAGE" \
    "${inject_args[@]}"

  rm -f "$work_dir/firstboot.conf"
  mv "$work_dir/image.img" "$output"
  log "wrote $output"
}

customize_command "$@"

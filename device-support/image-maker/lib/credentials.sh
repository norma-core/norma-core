#!/usr/bin/env bash
# Credential prompting/validation and firstboot.conf rendering.
#
# Source lib/common.sh before this file (uses die/shell_quote). Functions read
# and write the IMAGE_* variables (IMAGE_WIFI_SSID, IMAGE_WIFI_PASSWORD,
# IMAGE_WIFI_COUNTRY, IMAGE_TAILSCALE_AUTH_KEY, IMAGE_TAILSCALE_AUTH_SERVER,
# IMAGE_CUSTOM_USER, IMAGE_CUSTOM_USER_SSH_KEY).

require_interactive_cli() {
  [ -r /dev/tty ] && [ -w /dev/tty ] ||
    die "credentials require an interactive terminal (or supply them via IMAGE_* env vars)"
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

validate_custom_user_ssh_key() {
  case "$1" in
    ssh-rsa\ *|ssh-ed25519\ *|ecdsa-sha2-nistp256\ *|ecdsa-sha2-nistp384\ *|ecdsa-sha2-nistp521\ *|sk-ssh-ed25519@openssh.com\ *|sk-ecdsa-sha2-nistp256@openssh.com\ *)
      return 0 ;;
    *)
      return 1 ;;
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
    if validate_custom_user_ssh_key "$ssh_key"; then
      IMAGE_CUSTOM_USER_SSH_KEY="$ssh_key"
      return
    fi
    printf 'SSH public key must be a single OpenSSH public key line.\n' >/dev/tty
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

write_firstboot_var() {
  printf '%s=%s\n' "$1" "$(shell_quote "$2")"
}

# render_firstboot_config <target-path>
# Writes the firstboot.conf consumed by firstboot.sh on the device, from the
# IMAGE_* variables, with mode 0600.
render_firstboot_config() {
  local config_file
  config_file="$1"
  [ -n "$config_file" ] || die "render_firstboot_config: target path required"
  mkdir -p "$(dirname "$config_file")"

  {
    write_firstboot_var WIFI_COUNTRY "${IMAGE_WIFI_COUNTRY:-}"
    write_firstboot_var WIFI_SSID "${IMAGE_WIFI_SSID:-}"
    write_firstboot_var WIFI_PASSWORD "${IMAGE_WIFI_PASSWORD:-}"
    write_firstboot_var TAILSCALE_AUTH_KEY "${IMAGE_TAILSCALE_AUTH_KEY:-}"
    write_firstboot_var TAILSCALE_AUTH_SERVER "${IMAGE_TAILSCALE_AUTH_SERVER:-}"
    write_firstboot_var CUSTOM_USER_NAME "${IMAGE_CUSTOM_USER:-}"
    write_firstboot_var CUSTOM_USER_SSH_KEY "${IMAGE_CUSTOM_USER_SSH_KEY:-}"
  } > "$config_file"
  chmod 0600 "$config_file"
}

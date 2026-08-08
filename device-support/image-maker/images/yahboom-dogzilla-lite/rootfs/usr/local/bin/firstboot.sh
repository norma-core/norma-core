#!/usr/bin/env bash
set -euo pipefail

config_file="${FIRSTBOOT_CONFIG_FILE:-/etc/firstboot.conf}"
lock_file="${FIRSTBOOT_LOCK_FILE:-/etc/.firstboot_done}"
config_loaded=0

log() {
  printf '[firstboot] %s\n' "$*" >&2
}

cleanup_config() {
  [ "$config_loaded" = 1 ] || return 0
  rm -f "$config_file"
}

load_config() {
  if [ ! -r "$config_file" ]; then
    log "missing config file: $config_file"
    exit 0
  fi

  config_loaded=1
  . "$config_file"

  wifi_country="${WIFI_COUNTRY:-}"
  wifi_ssid="${WIFI_SSID:-}"
  wifi_password="${WIFI_PASSWORD:-}"
  tailscale_auth_key="${TAILSCALE_AUTH_KEY:-}"
  tailscale_auth_server="${TAILSCALE_AUTH_SERVER:-}"
  custom_user_name="${CUSTOM_USER_NAME:-}"
  custom_user_ssh_key="${CUSTOM_USER_SSH_KEY:-}"
}

configure_custom_user_ssh_key() {
  local authorized_keys home_dir ssh_dir

  [ -n "$custom_user_ssh_key" ] || return 0

  home_dir="$(getent passwd "$custom_user_name" | cut -d: -f6)"
  [ -n "$home_dir" ] || home_dir="/home/$custom_user_name"
  ssh_dir="$home_dir/.ssh"
  authorized_keys="$ssh_dir/authorized_keys"

  mkdir -p "$ssh_dir"
  printf '%s\n' "$custom_user_ssh_key" > "$authorized_keys"
  chown -R "$custom_user_name:" "$ssh_dir"
  chmod 0700 "$ssh_dir"
  chmod 0600 "$authorized_keys"
}

configure_custom_user_sudo() {
  local sudoers_file

  if getent group sudo >/dev/null 2>&1; then
    usermod -aG sudo "$custom_user_name" || log "failed to add custom user to sudo"
  fi

  sudoers_file="/etc/sudoers.d/90-image-maker-$custom_user_name"
  mkdir -p /etc/sudoers.d
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$custom_user_name" > "$sudoers_file"
  chmod 0440 "$sudoers_file"
}

is_reserved_custom_user_name() {
  case "$1" in
    root|station) return 0 ;;
    *) return 1 ;;
  esac
}

configure_custom_user() {
  [ -n "$custom_user_name" ] || return 0

  if [[ ! "$custom_user_name" =~ ^[a-z_][a-z0-9_-]{0,30}$ ]] ||
    is_reserved_custom_user_name "$custom_user_name"; then
    log "invalid or reserved custom user name; skipping user creation"
    return 0
  fi

  if id "$custom_user_name" >/dev/null 2>&1; then
    log "custom user already exists; skipping user creation"
    return 0
  fi

  if ! useradd -m -s /bin/bash "$custom_user_name"; then
    log "failed to create custom user"
    return 0
  fi

  passwd -l "$custom_user_name" >/dev/null 2>&1 || true
  configure_custom_user_ssh_key
  configure_custom_user_sudo
}

configure_wifi_country() {
  [ -n "$wifi_country" ] || return 0

  if command -v raspi-config >/dev/null 2>&1; then
    raspi-config nonint do_wifi_country "$wifi_country" || true
  fi

  if command -v iw >/dev/null 2>&1; then
    iw reg set "$wifi_country" || true
  fi
}

configure_wifi() {
  local connection_name

  [ -n "$wifi_ssid" ] || return 0

  if ! command -v nmcli >/dev/null 2>&1; then
    log "nmcli is unavailable; skipping Wi-Fi configuration"
    return 0
  fi

  connection_name=firstboot-wlan0
  nmcli radio wifi on || true

  if nmcli -t -f NAME connection show | grep -Fxq "$connection_name"; then
    if ! nmcli connection modify "$connection_name" \
      connection.interface-name wlan0 \
      802-11-wireless.ssid "$wifi_ssid"; then
      log "failed to update Wi-Fi connection"
      return 0
    fi
  else
    if ! nmcli connection add type wifi ifname wlan0 con-name "$connection_name" ssid "$wifi_ssid"; then
      log "failed to create Wi-Fi connection"
      return 0
    fi
  fi

  if ! nmcli connection modify "$connection_name" \
    connection.autoconnect yes \
    ipv4.method auto \
    ipv6.method auto \
    802-11-wireless-security.key-mgmt wpa-psk \
    802-11-wireless-security.psk "$wifi_password"; then
    log "failed to configure Wi-Fi credentials"
    return 0
  fi

  nmcli device wifi rescan ifname wlan0 || true
  nmcli connection up "$connection_name" ifname wlan0 || true
}

join_tailscale() {
  local -a tailscale_args

  [ -n "$tailscale_auth_key" ] || return 0

  if ! systemctl enable --now tailscaled.service; then
    log "failed to start tailscaled"
    return 1
  fi

  if command -v nm-online >/dev/null 2>&1; then
    nm-online -q --timeout=90 || true
  fi

  tailscale_args=(up "--auth-key=${tailscale_auth_key}")
  if [ -n "$tailscale_auth_server" ]; then
    tailscale_args+=("--login-server=${tailscale_auth_server}")
  fi

  if ! tailscale "${tailscale_args[@]}"; then
    log "failed to join Tailscale"
    return 1
  fi
}

if [ -e "$lock_file" ]; then
  exit 0
fi

trap cleanup_config EXIT

load_config
configure_custom_user
configure_wifi_country
configure_wifi
if ! join_tailscale; then
  log "Tailscale setup did not complete; continuing firstboot"
fi

touch "$lock_file"
chmod 0644 "$lock_file"

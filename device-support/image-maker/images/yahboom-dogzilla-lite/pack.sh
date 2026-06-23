station_binary="${YAHBOOM_DOGZILLA_LITE_STATION_BINARY:-$REPO_ROOT/target/aarch64-unknown-linux-gnu/release/station}"
python_source="${YAHBOOM_DOGZILLA_LITE_MONITOR_PY_SOURCE:-$REPO_ROOT/software/station/examples/yahboom-dogzilla-lite-monitor}"

write_firstboot_var() {
  printf '%s=%s\n' "$1" "$(shell_quote "$2")"
}

render_firstboot_config() {
  local config_file
  config_file="$STAGING_DIR/rootfs/etc/firstboot.conf"
  mkdir -p "$(dirname "$config_file")"

  {
    write_firstboot_var WIFI_COUNTRY "$IMAGE_WIFI_COUNTRY"
    write_firstboot_var WIFI_SSID "$IMAGE_WIFI_SSID"
    write_firstboot_var WIFI_PASSWORD "$IMAGE_WIFI_PASSWORD"
    write_firstboot_var TAILSCALE_AUTH_KEY "$IMAGE_TAILSCALE_AUTH_KEY"
    write_firstboot_var TAILSCALE_AUTH_SERVER "$IMAGE_TAILSCALE_AUTH_SERVER"
    write_firstboot_var CUSTOM_USER_NAME "$IMAGE_CUSTOM_USER"
    write_firstboot_var CUSTOM_USER_SSH_KEY "$IMAGE_CUSTOM_USER_SSH_KEY"
  } > "$config_file"
  chmod 0600 "$config_file"
}

copy_static_rootfs() {
  mkdir -p "$STAGING_DIR/rootfs"
  cp -Rp "$IMAGE_DIR/rootfs/." "$STAGING_DIR/rootfs/"
}

copy_station_binary() {
  [ -f "$station_binary" ] || die "missing station binary: $station_binary"

  mkdir -p "$STAGING_DIR/rootfs/opt/station"
  cp "$station_binary" "$STAGING_DIR/rootfs/opt/station/station"
  chmod 0755 "$STAGING_DIR/rootfs/opt/station/station"
}

copy_python_app() {
  local app_dir
  app_dir="$STAGING_DIR/rootfs/opt/yahboom-dogzilla-lite-monitor"

  [ -f "$python_source/pyproject.toml" ] || die "missing Python app: $python_source"

  mkdir -p \
    "$app_dir/src" \
    "$app_dir/station_py" \
    "$app_dir/target/gen_python/protobuf/drivers/yahboom_dogzilla_lite" \
    "$app_dir/target/gen_python/protobuf/drivers/sysinfo" \
    "$app_dir/target/gen_python/protobuf/normfs" \
    "$app_dir/target/gen_python/protobuf/station" \
    "$app_dir/shared/gremlin_py/gremlin"

  cp "$python_source/pyproject.toml" "$app_dir/"
  cp "$python_source/uv.lock" "$app_dir/"
  cp "$python_source/.python-version" "$app_dir/"
  cp -Rp "$python_source/src/yahboom_dogzilla_lite_monitor" "$app_dir/src/"
  cp "$REPO_ROOT/software/station/shared/station_py/"*.py "$app_dir/station_py/"
  find "$app_dir" -name __pycache__ -prune -exec rm -rf {} +

  [ -f "$REPO_ROOT/target/gen_python/protobuf/drivers/yahboom_dogzilla_lite/yahboom_dogzilla_lite.py" ] ||
    die "missing generated Python protobufs; run make protobuf"
  [ -f "$REPO_ROOT/target/gen_python/protobuf/drivers/sysinfo/sysinfo.py" ] ||
    die "missing generated Python sysinfo protobufs; run make protobuf"
  [ -f "$REPO_ROOT/target/gen_python/protobuf/normfs/normfs.py" ] ||
    die "missing generated Python normfs protobufs; run make protobuf"

  cp "$REPO_ROOT/target/gen_python/protobuf/drivers/__init__.py" \
    "$app_dir/target/gen_python/protobuf/drivers/"
  cp "$REPO_ROOT/target/gen_python/protobuf/normfs/__init__.py" \
    "$app_dir/target/gen_python/protobuf/normfs/"
  cp "$REPO_ROOT/target/gen_python/protobuf/station/__init__.py" \
    "$app_dir/target/gen_python/protobuf/station/"
  cp "$REPO_ROOT/target/gen_python/protobuf/drivers/yahboom_dogzilla_lite/yahboom_dogzilla_lite.py" \
    "$app_dir/target/gen_python/protobuf/drivers/yahboom_dogzilla_lite/"
  cp "$REPO_ROOT/target/gen_python/protobuf/drivers/sysinfo/sysinfo.py" \
    "$app_dir/target/gen_python/protobuf/drivers/sysinfo/"
  cp "$REPO_ROOT/target/gen_python/protobuf/normfs/normfs.py" \
    "$app_dir/target/gen_python/protobuf/normfs/"
  if [ -f "$REPO_ROOT/target/gen_python/protobuf/station/commands.py" ]; then
    cp "$REPO_ROOT/target/gen_python/protobuf/station/commands.py" \
      "$app_dir/target/gen_python/protobuf/station/"
  fi
  cp "$REPO_ROOT/shared/gremlin_py/gremlin/"*.py "$app_dir/shared/gremlin_py/gremlin/"
}

[ -n "${IMAGE_WIFI_COUNTRY:-}" ] || die "IMAGE_WIFI_COUNTRY is required"
[ -n "${IMAGE_WIFI_SSID:-}" ] || die "IMAGE_WIFI_SSID is required"
[ -n "${IMAGE_WIFI_PASSWORD:-}" ] || die "IMAGE_WIFI_PASSWORD is required"
[ -n "${IMAGE_CUSTOM_USER:-}" ] || die "IMAGE_CUSTOM_USER is required"
[ -n "${IMAGE_CUSTOM_USER_SSH_KEY:-}" ] || die "IMAGE_CUSTOM_USER_SSH_KEY is required"

log "packing Yahboom Dogzilla Lite monitor rootfs"
copy_static_rootfs
copy_station_binary
copy_python_app
render_firstboot_config

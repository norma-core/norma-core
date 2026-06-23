#!/usr/bin/env bash
set -euo pipefail

tmp_dir=""
mounts=()

unmount_all() {
  local index mountpoint

  for ((index=${#mounts[@]} - 1; index >= 0; index--)); do
    mountpoint="${mounts[$index]}"
    if mountpoint -q "$mountpoint"; then
      umount "$mountpoint" || true
    fi
  done
  mounts=()
}

cleanup() {
  unmount_all
  [ -z "$tmp_dir" ] || rm -rf "$tmp_dir"
}

trap cleanup EXIT

die() {
  printf '[image-packer] ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[image-packer] %s\n' "$*" >&2
}

make_tmp_dir() {
  tmp_dir="$(mktemp -d)"
}

partition_range() {
  local image number
  image="$1"
  number="$2"

  parted -sm "$image" unit s print |
    awk -F: -v number="$number" '$1 == number {
      sub(/s$/, "", $2)
      sub(/s$/, "", $4)
      print $2, $4
    }'
}

file_size_bytes() {
  stat -c '%s' "$1"
}

extract_partition() {
  local image number output start size
  image="$1"
  number="$2"
  output="$3"

  read -r start size < <(partition_range "$image" "$number")
  [ -n "${start:-}" ] && [ -n "${size:-}" ] || die "could not find partition $number"
  dd if="$image" of="$output" bs=512 skip="$start" count="$size" status=none
}

write_partition() {
  local image input input_size max_size number start size
  image="$1"
  number="$2"
  input="$3"

  read -r start size < <(partition_range "$image" "$number")
  [ -n "${start:-}" ] && [ -n "${size:-}" ] || die "could not find partition $number"

  input_size="$(file_size_bytes "$input")"
  max_size="$((size * 512))"
  [ "$input_size" -le "$max_size" ] ||
    die "partition $number is too small for $input: $input_size > $max_size bytes"

  dd if="$input" of="$image" bs=512 seek="$start" conv=notrunc status=none
}

copy_vfat_tree() {
  local source image rel
  source="$1"
  image="$2"

  [ -d "$source" ] || return 0

  (cd "$source" && find . -type d | sort) | while IFS= read -r rel; do
    [ "$rel" = "." ] || mmd -i "$image" "::/${rel#./}" 2>/dev/null || true
  done

  (cd "$source" && find . -type f | sort) | while IFS= read -r rel; do
    rel="${rel#./}"
    mcopy -o -i "$image" "$source/$rel" "::/$rel"
  done
}

mount_ext_image() {
  local image mountpoint
  image="$1"
  mountpoint="$2"

  mkdir -p "$mountpoint"
  mount -o loop "$image" "$mountpoint"
  mounts+=("$mountpoint")
}

copy_ext_tree() {
  local mountpoint source
  source="$1"
  mountpoint="$2"

  [ -d "$source" ] || return 0
  rsync -aH --keep-dirlinks --numeric-ids --chown=0:0 "$source"/ "$mountpoint"/
  delete_ext_paths "$source" "$mountpoint"
}

delete_ext_paths() {
  local manifest mountpoint rel source target
  source="$1"
  mountpoint="$2"
  manifest="$source/.image-maker-delete"

  [ -f "$manifest" ] || return 0

  while IFS= read -r rel || [ -n "$rel" ]; do
    rel="${rel%$'\r'}"
    case "$rel" in
      ""|\#*) continue ;;
      /*) ;;
      *) die "delete path must be absolute: $rel" ;;
    esac
    case "$rel" in
      /|/../*|*/../*|*/..) die "unsafe delete path: $rel" ;;
    esac

    target="$mountpoint/${rel#/}"
    rm -rf -- "$target"
  done < "$manifest"

  rm -f -- "$mountpoint/.image-maker-delete"
}

extract_rootfs_tar() {
  local mountpoint rootfs_tar
  rootfs_tar="$1"
  mountpoint="$2"

  tar --numeric-owner --acls --xattrs -xf "$rootfs_tar" -C "$mountpoint"
}

verify_init() {
  local mountpoint
  mountpoint="$1"

  [ -e "$mountpoint/sbin/init" ] ||
    die "root filesystem is missing /sbin/init"
  [ -x "$mountpoint/sbin/init" ] ||
    die "root filesystem has non-executable /sbin/init"
}

apply_overlay() {
  local boot_image boot_part image overlay root_image root_mount root_part
  boot_part=1
  image=""
  overlay=""
  root_part=2

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --boot-partition-number) boot_part="${2:-}"; shift 2 ;;
      --image) image="${2:-}"; shift 2 ;;
      --overlay) overlay="${2:-}"; shift 2 ;;
      --root-partition-number) root_part="${2:-}"; shift 2 ;;
      *) die "unknown apply-overlay argument: $1" ;;
    esac
  done

  [ -f "$image" ] || die "image not found: $image"
  [ -d "$overlay" ] || die "overlay not found: $overlay"

  make_tmp_dir
  boot_image="$tmp_dir/boot.img"
  root_image="$tmp_dir/root.img"
  root_mount="$tmp_dir/root"

  extract_partition "$image" "$boot_part" "$boot_image"
  extract_partition "$image" "$root_part" "$root_image"
  mount_ext_image "$root_image" "$root_mount"

  log "copying boot overlay"
  copy_vfat_tree "$overlay/boot" "$boot_image"
  log "copying root overlay"
  copy_ext_tree "$overlay/root" "$root_mount"
  verify_init "$root_mount"

  unmount_all
  write_partition "$image" "$boot_part" "$boot_image"
  write_partition "$image" "$root_part" "$root_image"
  sync
}

pack_rootfs() {
  local boot_image boot_size boot_size_mb image_size_mb output overlay root_image root_mount root_size rootfs_tar
  boot_size_mb=256
  image_size_mb=2048
  output=""
  overlay=""
  rootfs_tar=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --boot-size-mb) boot_size_mb="${2:-}"; shift 2 ;;
      --image-size-mb) image_size_mb="${2:-}"; shift 2 ;;
      --output) output="${2:-}"; shift 2 ;;
      --overlay) overlay="${2:-}"; shift 2 ;;
      --rootfs-tar) rootfs_tar="${2:-}"; shift 2 ;;
      *) die "unknown pack-rootfs argument: $1" ;;
    esac
  done

  [ -f "$rootfs_tar" ] || die "rootfs tar not found: $rootfs_tar"
  [ -n "$output" ] || die "--output is required"
  [ -d "$overlay" ] || die "overlay not found: $overlay"

  make_tmp_dir
  boot_image="$tmp_dir/boot.img"
  root_image="$tmp_dir/root.img"
  root_mount="$tmp_dir/root"

  rm -f "$output"
  truncate -s "${image_size_mb}M" "$output"
  parted --script "$output" mklabel msdos
  parted --script "$output" mkpart primary fat32 1MiB "${boot_size_mb}MiB"
  parted --script "$output" mkpart primary ext4 "${boot_size_mb}MiB" 100%

  read -r _ boot_size < <(partition_range "$output" 1)
  read -r _ root_size < <(partition_range "$output" 2)
  [ -n "${boot_size:-}" ] && [ -n "${root_size:-}" ] || die "could not create image partitions"

  truncate -s "$((boot_size * 512))" "$boot_image"
  truncate -s "$((root_size * 512))" "$root_image"
  mkfs.vfat -F 32 "$boot_image" >/dev/null
  mkfs.ext4 -F "$root_image" >/dev/null
  mount_ext_image "$root_image" "$root_mount"

  log "extracting rootfs"
  extract_rootfs_tar "$rootfs_tar" "$root_mount"
  log "copying overlays"
  copy_vfat_tree "$overlay/boot" "$boot_image"
  copy_ext_tree "$overlay/root" "$root_mount"
  verify_init "$root_mount"

  unmount_all
  write_partition "$output" 1 "$boot_image"
  write_partition "$output" 2 "$root_image"
  sync
}

case "${1:-}" in
  apply-overlay) shift; apply_overlay "$@" ;;
  pack-rootfs) shift; pack_rootfs "$@" ;;
  *) die "usage: pack apply-overlay|pack-rootfs ..." ;;
esac

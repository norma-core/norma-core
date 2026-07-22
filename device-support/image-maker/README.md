# image-maker

Builds and personalizes SD-card images for NormaCore devices. Two commands:

- **`image-maker build`** — produce a credential-free **golden image** with all
  software and drivers baked in. Run by maintainers; needs this repo + Docker.
- **`image-maker customize`** — write an end user's Wi-Fi, SSH, and Tailscale
  credentials into a copy of a golden image, producing a ready-to-flash image.
  Lightweight: **Docker is the only requirement** (no root, no `--privileged`,
  no base-image download), cross-platform (macOS, Linux, Windows via WSL2).

Both run entirely in Docker — all partition work happens inside the packer
container, so the host needs only Docker (with `buildx`).

## Golden images vs. customized images

`build` bakes everything that is identical for every device — the station
binary, the driver/monitor app, drivers, and systemd units (including the
first-boot service) — but **no credentials**. The result is a generic, shareable
image.

A golden image boots "inert": `firstboot-setup.service` is enabled but only runs
when `/etc/firstboot.conf` exists (and `/etc/.firstboot_done` does not). It is a
template, not meant to be booted directly — without customization it has no login
user and no Wi-Fi.

`customize` writes that one file — `/etc/firstboot.conf` (mode `0600`,
`root:root`, on the ext4 root partition) — into a copy of the image. On first
boot, `firstboot.sh` reads it to create the SSH user, configure Wi-Fi (and
country), and optionally join Tailscale, then deletes it. That file (its path,
the shell-sourced `KEY=value` format, and its `0600`/`root:root` ownership) is
the entire contract between the two commands.

## Quick start

**Build a golden image** (maintainers):

```bash
device-support/image-maker/image-maker build --image yahboom-dogzilla-lite
```

Writes `target/images/yahboom-dogzilla-lite.img` — a credential-free golden
image. Prerequisites for the bundled image:

- The station binary at `target/aarch64-unknown-linux-gnu/release/station`
  (override with `YAHBOOM_DOGZILLA_LITE_STATION_BINARY`).
- Generated Python protobufs under `target/gen_python/...` — run `make protobuf`
  first if `pack.sh` reports them missing.

**Personalize it for a device** (end users — only needs Docker + the golden image):

```bash
device-support/image-maker/image-maker customize \
  --input yahboom-dogzilla-lite.img \
  --output my-robot.img
```

`customize` prompts for the per-device credentials:

- Wi-Fi SSID, password, and country code (country defaults from your host locale)
- Tailscale auth key and login server (both optional — leave empty to skip)
- SSH username and public key (a passwordless, sudo-enabled login user)

Flash the resulting `my-robot.img` with Raspberry Pi Imager, balenaEtcher, or
`dd`.

### `customize` options

| Flag | Description |
| --- | --- |
| `-i, --input <img>` | Golden image to read (required). |
| `-o, --output <img>` | Personalized image to write (required). |
| `--root-partition-number <n>` | ext4 root partition number (default `2`). |
| `--reset-firstboot` | Also clear `/etc/.firstboot_done` so a reused card re-provisions. |
| `--non-interactive` | Require credentials via env vars; never prompt. |
| `--force` | Overwrite the output if it already exists. |

For automation, supply credentials via environment variables. When all required
ones are set, prompts are skipped:

```
IMAGE_WIFI_SSID, IMAGE_WIFI_PASSWORD, IMAGE_WIFI_COUNTRY   (required)
IMAGE_CUSTOM_USER, IMAGE_CUSTOM_USER_SSH_KEY               (required)
IMAGE_TAILSCALE_AUTH_KEY, IMAGE_TAILSCALE_AUTH_SERVER      (optional)
```

The input golden image is never modified; `customize` works on a copy. The
rendered credentials live only in the output image (consumed and deleted by
`firstboot.sh` on first boot) and, transiently, in a `0700` temp dir that is
removed when the command exits.

### `build` options

| Flag | Description |
| --- | --- |
| `--image <name>` | Build the image defined in `images/<name>/image.conf`. |
| `--config <path>` | Build from an explicit `image.conf` path (alternative to `--image`). |
| `--base <raw-image>` | Use a local raw base image instead of downloading `BASE_IMAGE_URL`. |
| `--output <image>` | Write the result to a custom path instead of `target/images/<name>.img`. |

## Host platforms

Docker is the only hard requirement; the tools check at startup that the Docker
daemon is reachable and fail fast with guidance if not.

- **macOS** — install Docker Desktop and start it. Nothing else is needed (`xz`
  decompression for `build` falls back to the packer container when absent).
- **Linux** — install Docker with `buildx`. For `build`, if the target
  architecture differs from the host (e.g. arm64 on an x86 box), install
  QEMU/binfmt emulation once:
  `docker run --privileged --rm tonistiigi/binfmt --install all`. `customize`
  needs no emulation — it runs the packer at host architecture.
- **Windows** — install Docker Desktop with the **WSL2 backend** and run from
  inside a WSL2 distro. Clone/keep images on the WSL filesystem (`~/...`), not
  `/mnt/c`, for speed and correct permissions.

## How `build` works

`build` supports two source types, selected per image via `SOURCE_TYPE`:

- **`disk-image`** — start from an existing partitioned base image (e.g.
  Raspberry Pi OS) and apply an overlay on top. Used by the bundled image.
- **`rootfs-container`** — export a container's root filesystem and pack it into
  a fresh partitioned image from scratch.

Stages:

1. **Stage inputs** (`images/<name>/pack.sh`) — assemble the image's `rootfs/`:
   static files, the station binary, the Python app and its generated protobufs.
   No credentials are rendered here.
2. **Build the packer** — build `packer/Dockerfile` (Debian + `parted`,
   `e2fsprogs`, `dosfstools`, `mtools`, `rsync`, …) into a local image used for
   partition surgery.
3. **Build the overlay** (`image.dockerfile`) — produce the boot/root overlay
   trees; fetch third-party binaries with pinned SHA-256 checksums (`uv`,
   `tailscale`).
4. **Enable systemd units** — symlink each unit in `ENABLE_SYSTEMD_UNITS` into
   `multi-user.target.wants` (including `firstboot-setup.service`).
5. **Apply / pack** — run the privileged packer container to apply the overlay
   onto a copy of the base image (`apply-overlay`) or build a new image
   (`pack-rootfs`), then write the result to `target/images/`.

## How `customize` works

`customize` copies the golden image, then runs the packer container's
`inject-firstboot` step, which writes `/etc/firstboot.conf` into the ext4 root
partition **unprivileged** — using `debugfs` (no mount, no loop device), so it
needs no `--privileged`:

1. Extract the root partition slice from the image copy.
2. Verify it is a NormaCore golden rootfs (`/usr/local/bin/firstboot.sh` present).
3. Write `firstboot.conf` via `debugfs` and set mode `0600`, owner `root:root`.
4. Verify the result and run `e2fsck -fy` for consistency.
5. Write the partition back; move the copy to the output path.

I/O matches `apply-overlay` (extract the partition, modify, write it back).

### First-boot provisioning

`firstboot-setup.service` runs `firstboot.sh` once on first boot (guarded by
`/etc/.firstboot_done`). It reads `/etc/firstboot.conf`, then:

- creates the SSH user (passwordless login, sudo via NOPASSWD) and installs the
  provided public key,
- sets the Wi-Fi country and configures the `wlan0` connection via `nmcli`,
- optionally brings up Tailscale with the supplied auth key / login server.

The config file is deleted after a successful run so credentials don't linger on
the device.

## Layout

```
image-maker/
  image-maker              # entry point: `build` and `customize` subcommands
  build.sh                 # build implementation (also runnable directly)
  customize.sh             # customize implementation
  lib/
    common.sh              # shared helpers (die/log/docker/sha256/packer build)
    credentials.sh         # credential prompts/validation + firstboot.conf render
  packer/
    Dockerfile             # partition-surgery toolbox (parted, e2fsprogs, …)
    pack.sh                # apply-overlay / pack-rootfs / inject-firstboot
  images/
    <image-name>/
      image.conf           # IMAGE_NAME, SOURCE_TYPE, base image, units to enable
      image.dockerfile     # builds the boot/root overlay (fetches uv, tailscale…)
      pack.sh              # stages this image's rootfs into the build
      rootfs/              # static files (systemd units, station config,
                           # firstboot.sh — the first-boot contract)
```

## Adding a new image

1. Create `images/<name>/` with an `image.conf` (set at least `IMAGE_NAME` and
   `SOURCE_TYPE`).
2. Add a `rootfs/` tree with the static files the device needs (systemd units,
   configs, scripts), including the first-boot service and `firstboot.sh`.
3. Add a `pack.sh` if the image needs files staged from outside `rootfs/`
   (binaries, generated code) — it is sourced with `$REPO_ROOT`, `$IMAGE_DIR`,
   and `$STAGING_DIR` in scope. Do not render credentials here.
4. Add an `image.dockerfile` if you need to fetch or build overlay artifacts.
5. List the units to enable in `ENABLE_SYSTEMD_UNITS` (include
   `firstboot-setup.service`).
6. Build with `image-maker build --image <name>`.

## Adding a non-arm64 image

The builder itself is architecture-agnostic — the packer container only does
file/partition work. Architecture lives entirely in each image's `image.conf`.
To target, say, `linux/amd64` instead of the default arm64:

1. Set `IMAGE_PLATFORM=linux/amd64` in `image.conf`.
2. Point `BASE_IMAGE_URL`/`BASE_IMAGE_SHA256` at an x86 base image (for
   `disk-image`), or build an x86 rootfs container (for `rootfs-container`).
3. Set the overlay's architecture via `OVERLAY_BUILD_ARGS` — forwarded to
   `image.dockerfile` as `--build-arg`s. For x86:

   ```sh
   OVERLAY_BUILD_ARGS=(
     "UV_TARGET=x86_64-unknown-linux-gnu"
     "UV_SHA256=<x86 uv checksum>"
     "TAILSCALE_ARCH=amd64"
     "TAILSCALE_SHA256=<x86 tailscale checksum>"
   )
   ```

4. In the image's `pack.sh`, stage the station binary built for the matching
   target triple (e.g. `x86_64-unknown-linux-gnu`).
5. Provide a device-appropriate `rootfs/` — the bundled image's Raspberry Pi
   bits (`boot/firmware/config.txt` device-tree overlays, `raspi-config` use in
   `firstboot.sh`) are device-specific, not shared framework.
```


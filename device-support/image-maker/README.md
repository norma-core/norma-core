# image-maker

Builds ready-to-flash SD-card images for NormaCore devices. An image bundles the
station binary, a driver/monitor application, and a first-boot provisioning step
that configures Wi-Fi, SSH, and Tailscale from values you enter at build time.

The builder runs entirely in Docker, so the only host requirement is Docker (with
`buildx`). No `losetup`, `parted`, `xz`, or root privileges are needed on the host —
all partition work happens inside a privileged packer container. It runs on macOS,
Linux, and Windows (via WSL2); see [Host platforms](#host-platforms).

## Quick start

From anywhere in the repo:

```bash
device-support/image-maker/build.sh build --image yahboom-dogzilla-lite
```

The build prompts (on the terminal) for the values baked into the image:

- Wi-Fi SSID, password, and country code (country defaults from your host locale)
- Tailscale auth key and login server (both optional — leave empty to skip)
- SSH username and public key (a passwordless, sudo-enabled login user)

The finished image is written to `target/images/<image-name>.img`, ready to flash
with `dd`, Raspberry Pi Imager, or similar.

### Useful flags

| Flag | Description |
| --- | --- |
| `--image <name>` | Build the image defined in `images/<name>/image.conf`. |
| `--config <path>` | Build from an explicit `image.conf` path (alternative to `--image`). |
| `--base <raw-image>` | Use a local raw base image instead of downloading `BASE_IMAGE_URL`. |
| `--output <image>` | Write the result to a custom path instead of `target/images/<name>.img`. |

Prerequisites for the bundled `yahboom-dogzilla-lite` image:

- The station binary at `target/aarch64-unknown-linux-gnu/release/station`
  (override with `YAHBOOM_DOGZILLA_LITE_STATION_BINARY`).
- Generated Python protobufs under `target/gen_python/...` — run `make protobuf`
  first if `pack.sh` reports them missing.

## Host platforms

The build runs on macOS, Linux, and Windows. Docker is the only hard requirement;
the build checks at startup that the Docker daemon is reachable and that it can run
the target architecture, and fails fast with guidance if not.

- **macOS** — install Docker Desktop and start it. Nothing else is needed (`xz`
  decompression falls back to the packer container when it's absent on the host).
- **Linux** — install Docker with `buildx`. To build an image whose architecture
  differs from the host (e.g. arm64 on an x86 box), install QEMU/binfmt emulation
  once: `docker run --privileged --rm tonistiigi/binfmt --install all`. Docker
  Desktop already includes this.
- **Windows** — install Docker Desktop with the **WSL2 backend**, then run
  `build.sh` from **inside** a WSL2 distro (e.g. Ubuntu). Clone the repo into the
  WSL filesystem (`~/...`), not `/mnt/c`, for speed and correct file permissions.
  `build.sh` does not run in native PowerShell/cmd.

## How it works

`build.sh` supports two source types, selected per image via `SOURCE_TYPE`:

- **`disk-image`** — start from an existing partitioned base image (e.g. Raspberry
  Pi OS) and apply an overlay on top of it. Used by the bundled image.
- **`rootfs-container`** — export a container's root filesystem and pack it into a
  fresh partitioned image from scratch.

For both, a build runs these stages:

1. **Stage inputs** (`pack.sh`) — assemble the image's `rootfs/` into a staging
   tree: copy static files, drop in the station binary, the Python app and its
   generated protobufs, and render `/etc/firstboot.conf` from your prompted values.
2. **Build the packer** — build the `packer/Dockerfile` (Debian + `parted`,
   `e2fsprogs`, `dosfstools`, `mtools`, `rsync`, …) into a local image used to do
   the partition surgery.
3. **Build the overlay** (`image.dockerfile`) — produce the boot/root overlay
   trees. This is also where third-party binaries are fetched with pinned SHA-256
   checksums (e.g. `uv`, `tailscale`).
4. **Enable systemd units** — symlink each unit listed in `ENABLE_SYSTEMD_UNITS`
   into `multi-user.target.wants`.
5. **Apply / pack** — run the privileged packer container to either apply the
   overlay onto a copy of the base image (`apply-overlay`) or build a new image
   (`pack-rootfs`), then write the result to `target/images/`.

### First-boot provisioning

`firstboot-setup.service` runs `firstboot.sh` once on the first boot (guarded by
`/etc/.firstboot_done`). It reads `/etc/firstboot.conf`, then:

- creates the SSH user (passwordless login, sudo via NOPASSWD), installing the
  provided public key,
- sets the Wi-Fi country and configures the `wlan0` connection via `nmcli`,
- optionally brings up Tailscale with the supplied auth key / login server.

The config file is deleted after a successful run so credentials don't linger on
the device.

## Layout

```
image-maker/
  build.sh                 # entry point: prompts, orchestrates, writes the image
  packer/
    Dockerfile             # privileged partition-surgery toolbox
    pack.sh                # apply-overlay / pack-rootfs implementation
  images/
    <image-name>/
      image.conf           # IMAGE_NAME, SOURCE_TYPE, base image, units to enable
      image.dockerfile     # builds the boot/root overlay (fetches uv, tailscale…)
      pack.sh              # stages this image's rootfs into the build
      rootfs/              # static files copied into the image (systemd units,
                           # station config, firstboot.sh, etc.)
```

## Adding a new image

1. Create `images/<name>/` with an `image.conf` (set at least `IMAGE_NAME` and
   `SOURCE_TYPE`).
2. Add a `rootfs/` tree with the static files the device needs (systemd units,
   configs, scripts).
3. Add a `pack.sh` if the image needs files staged from outside `rootfs/`
   (binaries, generated code) — it is sourced with `$REPO_ROOT`, `$IMAGE_DIR`,
   `$STAGING_DIR`, and the prompted `IMAGE_*` values in scope.
4. Add an `image.dockerfile` if you need to fetch or build overlay artifacts.
5. List the units to enable in `ENABLE_SYSTEMD_UNITS`.
6. Build with `build.sh build --image <name>`.

## Adding a non-arm64 image

The builder itself is architecture-agnostic — the packer container only does
file/partition work. Architecture lives entirely in each image's `image.conf`.
To target, say, `linux/amd64` instead of the default arm64:

1. Set `IMAGE_PLATFORM=linux/amd64` in `image.conf`.
2. Point `BASE_IMAGE_URL`/`BASE_IMAGE_SHA256` at an x86 base image (for
   `disk-image`), or build an x86 rootfs container (for `rootfs-container`).
3. Set the overlay's architecture via `OVERLAY_BUILD_ARGS` — these are forwarded
   to `image.dockerfile` as `--build-arg`s. For x86:

   ```sh
   OVERLAY_BUILD_ARGS=(
     "UV_TARGET=x86_64-unknown-linux-gnu"
     "UV_SHA256=<x86 uv checksum>"
     "TAILSCALE_ARCH=amd64"
     "TAILSCALE_SHA256=<x86 tailscale checksum>"
   )
   ```

4. In the image's `pack.sh`, stage the station binary built for the matching
   target triple (e.g. `x86_64-unknown-linux-gnu` instead of `aarch64-...`).
5. Provide a device-appropriate `rootfs/` — the bundled image's Raspberry Pi
   bits (`boot/firmware/config.txt` device-tree overlays, `raspi-config` use in
   `firstboot.sh`) are device-specific, not shared framework.

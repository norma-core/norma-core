# NormaCore Arduino Portenta X8 Yocto Image 🚀

This folder contains the NormaCore Yocto layer and build template for the
Arduino Portenta X8.

The build flow intentionally uses the upstream NXP i.MX `repo` manifest first,
then adds the Arduino, Tailscale, and NormaCore layers on top.

## Contents 📚

- [Image Profile](#image-profile-)
- [Max Carrier Setup](#max-carrier-setup-)
- [Start Here](#start-here-)
- [1. Fetch The NXP Base BSP](#1-fetch-the-nxp-base-bsp-)
- [2. Add Arduino, Tailscale, And NormaCore](#2-add-arduino-tailscale-and-normacore-)
- [3. Create The Build Directory](#3-create-the-build-directory-)
- [4. Add Local Access Credentials](#4-add-local-access-credentials-)
- [5. Build The Image](#5-build-the-image-)
- [6. Prepare Files For UUU Flashing](#6-prepare-files-for-uuu-flashing-)
- [7. Flash Explicitly](#7-flash-explicitly-)
- [Debugging Serial Console](#debugging-serial-console-)

## Image Profile 🧭

`x8-normacore` is a production-oriented, small headless Linux image for Arduino
Portenta X8 on the Max Carrier. It is designed as a clean deployment base:
minimal runtime surface, explicit remote access, no desktop stack, and no build
toolchain in the flashed system.

The target image includes:

- SysVinit as PID 1 and `eudev` for device management.
- Tailscale and a SysV init script for `tailscaled`.
- OpenSSH with key-only root login; SSH password login is disabled.
- A required local root password hash for serial-console access.
- Max Carrier boot overlay selection and Portenta X8/H7 support packages.
- Wi-Fi, Bluetooth, ALSA audio, V4L2, CAN, I2C, GPIO, USB, PCI, PPP, and
  serial-console tools.
- Chrony, Vim, tmux, CA certificates, iproute2, ethtool, and basic filesystem
  utilities.

The target image intentionally does not include:

- systemd as init.
- X11, Wayland, desktop, GPU UI, PulseAudio, PAM, Polkit, or Zeroconf stacks.
- Docker, containerd, Podman, Kubernetes, aktualizr, or OSTree runtime pieces.
- Python, compiler toolchains, CMake, Ninja, or build-essential packages.

The Docker container in this README is only the build environment. It is not
installed into the Portenta X8 image.

## Max Carrier Setup 🔌

This image targets Portenta X8 on the Portenta Max Carrier. Before relying on
Ethernet, set the Max Carrier Ethernet DIP switches to the Portenta X8 mode:

- Ethernet DIP switches `1` and `2`: `OFF`

Arduino documents this as Ethernet enabled for Portenta X8. See the
[Portenta Max Carrier user manual](https://docs.arduino.cc/tutorials/portenta-max-carrier/user-manual/)
for the carrier DIP switch table.

## Start Here 📍

Yocto is not installed as a single package here. The workspace is fetched with
`repo`, then built inside the same NXP/Arduino-compatible container used by the
Portenta X8 BSP.

Start from this README directory:

**Host:**

```bash
NORMACORE_ROOT="$(cd ../../.. && pwd)"
YOCTO_WORKSPACE="$NORMACORE_ROOT/target/yocto-portenta-x8"
```

Create the Yocto workspace under `target/`:

**Host:**

```bash
mkdir -p "$YOCTO_WORKSPACE/.home"
```

Start the build container:

**Host:**

```bash
docker run --rm -it \
  --name yocto-x8 \
  --userns=keep-id \
  -e HOME=/workdir/.home \
  -e USER=builder \
  -v "$YOCTO_WORKSPACE:/workdir:Z" \
  -v "$NORMACORE_ROOT:/norma-core:ro,Z" \
  -w /workdir \
  hub.foundries.io/lmp-sdk:95 \
  bash
```

Inside the container:

**Inside Docker:**

```text
/workdir    # Yocto workspace root
/norma-core # read-only NormaCore checkout
```

## 1. Fetch The NXP Base BSP 📦

Inside the container, from `/workdir`, use the official NXP i.MX manifest:

**Inside Docker:**

```bash
cd /workdir

git config --global user.email "you@example.com"
git config --global user.name "Your Name"

repo init \
  -u https://github.com/nxp-imx/imx-manifest.git \
  -b imx-linux-scarthgap \
  -m imx-6.6.52-2.2.0.xml

repo sync -j1 --fail-fast
```

This creates the base `sources/` tree with Poky, NXP, Freescale, and
OpenEmbedded layers.

## 2. Add Arduino, Tailscale, And NormaCore 🧩

Still inside the container, clone the extra layers into `sources/`:

**Inside Docker:**

```bash
cd sources

git clone https://github.com/arduino/meta-arduino.git
git -C meta-arduino checkout scarthgap

git clone https://github.com/ChristophHandschuh/meta-tailscale.git

cd ..
```

From the Yocto workspace root, symlink this NormaCore checkout into
`sources/norma-core`:

**Inside Docker:**

```bash
ln -s /norma-core sources/norma-core
```

## 3. Create The Build Directory 🛠️

Start from the workspace root:

**Inside Docker:**

```bash
cd /workdir
```

Use the NormaCore Yocto template:

**Inside Docker:**

```bash
TEMPLATECONF=/workdir/sources/norma-core/device-support/arduino-portenta-x8/yocto/meta-normacore-x8/conf/templates/normacore-x8 \
  source /workdir/sources/poky/oe-init-build-env bld-x8
```

This creates:

**Inside Docker:**

```text
bld-x8/conf/local.conf
bld-x8/conf/bblayers.conf
```

The template enables the `x8-normacore` image and the required layers.

## 4. Add Local Access Credentials 🔐

The image build intentionally fails unless both root serial password and root
SSH keys are configured locally.

Generate the SHA-512 root password hash:

**Inside Docker:**

```bash
ROOT_HASH="$(openssl passwd -6)"
```

Write the root password hash config:

**Inside Docker:**

```bash
cat > conf/local-rootpw.inc <<EOF
X8_ROOT_HASH = "$ROOT_HASH"
EOF
```

Write the SSH key config:

**Inside Docker:**

```bash
cat > conf/local-secrets.inc <<'EOF'
X8_ROOT_AUTHORIZED_KEYS_FILE = "${TOPDIR}/conf/root-authorized_keys"
EOF
```

Create the authorized keys file:

**Inside Docker:**

```bash
cat > conf/root-authorized_keys <<'EOF'
ssh-ed25519 replace-with-your-public-key user@example
EOF
```

The files above live in the build directory and must not be committed.

## 5. Build The Image 🧱

From inside `bld-x8`:

**Inside Docker:**

```bash
bitbake x8-normacore
```

The main output is:

**Inside Docker:**

```text
tmp/deploy/images/portenta-x8/x8-normacore-portenta-x8.rootfs.wic.zst
```

Useful checks:

**Inside Docker:**

```bash
ls -lh tmp/deploy/images/portenta-x8/x8-normacore-portenta-x8.rootfs.wic.zst
ls -lh tmp/deploy/images/portenta-x8/imx-boot-portenta-x8-sd.bin-flash_evk
wc -l tmp/deploy/images/portenta-x8/x8-normacore-portenta-x8.rootfs.manifest
```

## 6. Prepare Files For UUU Flashing ⚡

From the workspace root:

**Inside Docker:**

```bash
cd /workdir
mkdir -p flash-x8
cd flash-x8

cp -Lf ../bld-x8/tmp/deploy/images/portenta-x8/x8-normacore-portenta-x8.rootfs.wic.zst \
  ./x8-clean-hw-image-portenta-x8.wic.zst

zstd -d -f ./x8-clean-hw-image-portenta-x8.wic.zst \
  -o ./x8-clean-hw-image-portenta-x8.wic

cp -f ../bld-x8/tmp/deploy/images/portenta-x8/imx-boot-portenta-x8-sd.bin-flash_evk \
  ./imx-boot-x8-clean.bin

ls -lh imx-boot-x8-clean.bin x8-clean-hw-image-portenta-x8.wic
```

## 7. Flash Explicitly 🔥

Flashing is intentionally manual. Use Arduino's Portenta X8 image bundle only
for the bundled UUU tool and manufacturing files; keep flashing the NormaCore
`.wic` and matching Yocto/NXP bootloader prepared above.

Before running UUU, put the Portenta X8 into flashing mode:

- Power off the board and disconnect external power, LAN, and peripherals.
- On the Portenta Max Carrier, set `BOOT SEL` to `ON`.
- On the Portenta Max Carrier, set `BOOT` to `ON`.
- Connect only a USB-C cable from the host computer to the Portenta X8.

Arduino documents this sequence in the
[Portenta X8 image flashing guide](https://docs.arduino.cc/tutorials/portenta-x8/image-flashing/).

**Host, after exiting Docker:**

```bash
cd "$YOCTO_WORKSPACE/flash-x8"

curl -L --fail -o image-latest.tar.gz \
  https://downloads.arduino.cc/portentax8image/image-latest.tar.gz

mkdir -p arduino-bundle
tar -xzf image-latest.tar.gz -C arduino-bundle
tar -xzf arduino-bundle/*/mfgtool-files-portenta-x8.tar.gz

sudo ./mfgtool-files-portenta-x8/uuu \
  -b emmc_all \
  imx-boot-x8-clean.bin \
  x8-clean-hw-image-portenta-x8.wic
```

If `uuu` fails with `libbz2.so.1.0: cannot open shared object file`, the host
may provide the same library as `libbz2.so.1`. On Fedora-like hosts, run the
flash command with a temporary compatibility link:

**Host, from `flash-x8`:**

```bash
d="$(mktemp -d)" && ln -s /lib64/libbz2.so.1 "$d/libbz2.so.1.0" && sudo env LD_LIBRARY_PATH="$d" ./mfgtool-files-portenta-x8/uuu -b emmc_all imx-boot-x8-clean.bin x8-clean-hw-image-portenta-x8.wic
```

Do not run Arduino's `full_image.uuu` script for this image. That script expects
Arduino/LMP image filenames; the command above uses the bundled UUU binary with
the NormaCore image artifacts.

After UUU finishes:

- Disconnect the USB-C cable to power off the board.
- Set `BOOT SEL` back to `OFF`.
- Set `BOOT` back to `OFF`.
- Leave the Ethernet DIP switches `1` and `2` as `OFF` for Portenta X8 mode.
- Reconnect normal power, LAN, and peripherals.

## Debugging Serial Console 🧪

Use the Max Carrier debug serial console to watch boot logs and get a local
console.

- Connect power to the Portenta Max Carrier.
- Connect a Mini USB cable from the host computer to the Max Carrier debug USB
  port.

Find the serial device:

**Host:**

```bash
ls -l /dev/serial/by-id/
```

If several devices are present, resolve them to the underlying `tty` devices:

**Host:**

```bash
readlink -f /dev/serial/by-id/*
```

Start the serial console:

**Host:**

```bash
sudo picocom -b 115200 /dev/serial/by-id/usb-SEGGER_J-Link_001079296581-if00
```

The exact `/dev/serial/by-id/...` path can differ between boards and hosts.
Exit `picocom` with `Ctrl-A`, then `Ctrl-X`.

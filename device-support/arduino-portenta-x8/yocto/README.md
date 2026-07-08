# NormaCore Arduino Portenta X8 Yocto Image 🚀

This folder contains the NormaCore Yocto layer and build template for the
Arduino Portenta X8.

The build flow intentionally uses the upstream NXP i.MX `repo` manifest first,
then adds the Arduino, Tailscale, and NormaCore layers on top.

## Contents 📚

- [Image Profile](#image-profile-)
- [Max Carrier Setup](#max-carrier-setup-)
- [Cellular Modem Support](#cellular-modem-support-)
- [Hardware Network Watchdog](#hardware-network-watchdog-)
- [SD Card Automount](#sd-card-automount-)
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
- D-Bus, ModemManager, and SysV init scripts for `ModemManager` and
  `x8-cellulard`.
- `x8-watchdogd`, an installed hardware watchdog owner that can be enabled
  manually on devices that should reset after sustained loss of Tailscale DNS
  reachability.
- OpenSSH with key-only root login; SSH password login is disabled.
- A required local root password hash for serial-console access.
- Default hostname `rover-alpha`; override with `X8_HOSTNAME` in
  `conf/local.conf`.
- Max Carrier boot overlay selection and Portenta X8/H7 support packages.
- Wi-Fi, Bluetooth, ALSA audio, V4L2, CAN, I2C, GPIO, USB, PCI, PPP, QMI,
  MBIM, and serial-console tools.
- Removable SD-card automounting at `/media/sdcard`.
- Chrony, Vim, tmux, CA certificates, iproute2, ethtool, and basic filesystem
  utilities.

The target image intentionally does not include:

- systemd as init.
- NetworkManager or `nmcli`.
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

## Cellular Modem Support 📡

The image includes basic cellular support for both the Max Carrier onboard
SARA-R4 modem and an external LTE modem on the carrier expansion path.

`x8-cellulard` owns cellular GPIO power, ModemManager connect/reconnect, PPP,
routes, and internet health checks. It is installed as a SysV init service.
The recipe renders `/etc/default/x8-cellulard` from BitBake variables, and the
service does not start unless at least one APN is configured.

The template defaults the external APN to `movistar.es`:

```bitbake
X8_CELLULARD_EXTERNAL_APN ??= "movistar.es"
X8_CELLULARD_SARA_APN ??= ""
X8_CELLULARD_INTERVAL_SEC ??= "30"
```

Override these per build in `bld-x8/conf/local-cellular.inc`, similar to the
local root password and SSH key includes:

```sh
X8_CELLULARD_EXTERNAL_APN = "movistar.es"
X8_CELLULARD_SARA_APN = ""
X8_CELLULARD_INTERVAL_SEC = "30"
```

Leaving both APNs empty keeps the service installed but inactive at boot.

The image includes ModemManager plus QMI/MBIM tools, but it does not include
NetworkManager. Modem detection and inspection are available through
ModemManager, while connection policy is handled by `x8-cellulard`.

## Hardware Network Watchdog ⏱️

The image installs `x8-watchdogd` but does not start it automatically. This is
intentional because opening `/dev/watchdog0` arms the hardware watchdog on the
target board.

When enabled manually, it owns `/dev/watchdog0`, feeds the i.MX hardware
watchdog, and checks only `100.100.100.100` with `ping`.

The watchdog policy is embedded in the daemon source, not exposed as Yocto image
parameters:

- feed interval: 10 seconds
- network check interval: 60 seconds
- ping timeout: 10 seconds
- hard ping process timeout: 30 seconds
- continuous offline window before reset: 10800 seconds

If the target is unreachable continuously for 3 hours, the daemon stops feeding
the hardware watchdog and lets the board reset.

Enable and start it on the device only when ready:

```sh
update-rc.d x8-watchdogd defaults 80 20
/etc/init.d/x8-watchdogd start
```

Disable autostart while leaving the binary installed:

```sh
update-rc.d -f x8-watchdogd remove
```

## SD Card Automount 💾

The image expects at most one removable SD card. When eudev sees a filesystem
on the card, it mounts it at:

```text
/media/sdcard
```

The automount helper only accepts removable/SD `mmcblk*` devices, so the
Portenta X8 internal eMMC is ignored. If the card has one partition, that
partition is mounted; if the card is formatted without a partition table, the
whole card device is mounted.

## eMMC Root Filesystem Size 💽

Portenta X8 has a 16 GB onboard eMMC. The image uses a fixed 14336 MiB rootfs
partition in the generated `.wic` so the flashed system has a large rootfs
available immediately, without first-boot partition resizing.

Arduino's stock `lmp-factory-image-portenta-x8.wic.gz` reference image uses a
smaller root partition of about 2.9 GiB. NormaCore intentionally uses the larger
fixed partition because this image is flashed directly to the X8 eMMC, while
keeping enough margin for the capacity exposed by Arduino's mfgtool fastboot
target.

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
  -v "$NORMACORE_ROOT:$NORMACORE_ROOT:ro,Z" \
  -w /workdir \
  hub.foundries.io/lmp-sdk:95 \
  bash
```

The second NormaCore mount keeps existing build directories working if
`sources/norma-core` is an absolute symlink to the host checkout path.

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

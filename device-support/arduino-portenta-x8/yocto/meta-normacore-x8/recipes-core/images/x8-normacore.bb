SUMMARY = "NormaCore image for Portenta X8 + Max Carrier"
DESCRIPTION = "NormaCore minimal Portenta X8 image: SysVinit, eudev, hardened SSH, Tailscale, Chrony, tmux, Max Carrier support."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

inherit core-image

IMAGE_FEATURES = ""
EXTRA_IMAGE_FEATURES = ""
IMAGE_LINGUAS = "en-us"

IMAGE_INSTALL = "\
    packagegroup-core-boot \
    init-ifupdown \
    \
    openssh-sshd \
    \
    u-boot-script-arduino \
    arduino-device-tree \
    \
    kmod \
    kernel-modules \
    \
    m-x8h7 \
    linux-firmware-arduino-portenta-x8-stm32h7 \
    x8h7-init \
    \
    m-bq24195 \
    m-cs42l52 \
    \
    iproute2 \
    ethtool \
    \
    ppp \
    picocom \
    \
    can-utils \
    i2c-tools \
    libgpiod-tools \
    usbutils \
    pciutils \
    util-linux \
    e2fsprogs \
    dosfstools \
    \
    v4l-utils \
    alsa-utils \
    \
    wpa-supplicant \
    iw \
    wireless-regdb \
    bluez5 \
    \
    tailscale \
    tailscaled-init \
    ca-certificates \
    iptables \
    \
    chrony \
    chronyc \
    \
    vim \
    tmux \
"

IMAGE_FSTYPES += "wic.zst"

ROOTFS_POSTPROCESS_COMMAND += "x8_patch_uenv_for_max_carrier;"

x8_patch_uenv_for_max_carrier() {
    if [ -f ${IMAGE_ROOTFS}/boot/uEnv.txt ]; then
        sed -i "s/^ovlist=.*/ovlist='ov_som_lbee5kl1dx ov_som_x8h7 ov_som_gpu_vpus ov_som_anx7625_video ov_carrier_enuc_bq24195 ov_carrier_max_usbfs ov_carrier_max_sdc ov_carrier_max_cs42l52 ov_carrier_enuc_lora'/" ${IMAGE_ROOTFS}/boot/uEnv.txt
    fi
}

# X8 ROOT PASSWORD AND SERIAL BANNER
X8_ROOT_HASH ??= ""
X8_ROOT_AUTHORIZED_KEYS_FILE ??= ""

ROOTFS_POSTPROCESS_COMMAND += "x8_validate_root_access; x8_set_root_password; x8_install_root_authorized_keys; x8_allow_root_serial_login; x8_fix_missing_groups; x8_install_serial_banner;"

x8_validate_root_access() {
    if [ -z "${X8_ROOT_HASH}" ]; then
        echo "Missing X8_ROOT_HASH. Set it in conf/local-rootpw.inc." >&2
        exit 1
    fi

    if [ -z "${X8_ROOT_AUTHORIZED_KEYS_FILE}" ]; then
        echo "Missing X8_ROOT_AUTHORIZED_KEYS_FILE. Set it in conf/local-secrets.inc." >&2
        exit 1
    fi

    if [ ! -s "${X8_ROOT_AUTHORIZED_KEYS_FILE}" ]; then
        echo "Missing or empty X8_ROOT_AUTHORIZED_KEYS_FILE: ${X8_ROOT_AUTHORIZED_KEYS_FILE}" >&2
        exit 1
    fi
}

x8_set_root_password() {
    if [ -n "${X8_ROOT_HASH}" ] && [ -f "${IMAGE_ROOTFS}/etc/shadow" ]; then
        sed -i "s|^root:[^:]*:|root:${X8_ROOT_HASH}:|" "${IMAGE_ROOTFS}/etc/shadow"
    fi
}

x8_install_root_authorized_keys() {
    if [ -n "${X8_ROOT_AUTHORIZED_KEYS_FILE}" ]; then
        if [ ! -s "${X8_ROOT_AUTHORIZED_KEYS_FILE}" ]; then
            echo "Missing or empty X8_ROOT_AUTHORIZED_KEYS_FILE: ${X8_ROOT_AUTHORIZED_KEYS_FILE}" >&2
            exit 1
        fi

        install -d -m 0700 "${IMAGE_ROOTFS}/home/root/.ssh"
        install -m 0600 "${X8_ROOT_AUTHORIZED_KEYS_FILE}" \
            "${IMAGE_ROOTFS}/home/root/.ssh/authorized_keys"
    fi
}

x8_allow_root_serial_login() {
    touch ${IMAGE_ROOTFS}/etc/securetty

    for tty in ttymxc2 ttymxc0 ttyX0 ttyS0 tty1; do
        grep -qx "$tty" ${IMAGE_ROOTFS}/etc/securetty || echo "$tty" >> ${IMAGE_ROOTFS}/etc/securetty
    done
}

x8_fix_missing_groups() {
    if [ -f "${IMAGE_ROOTFS}/etc/group" ]; then
        grep -q '^tee:' "${IMAGE_ROOTFS}/etc/group" || echo 'tee:x:400:' >> "${IMAGE_ROOTFS}/etc/group"
        grep -q '^teepriv:' "${IMAGE_ROOTFS}/etc/group" || echo 'teepriv:x:401:' >> "${IMAGE_ROOTFS}/etc/group"
    fi
}

x8_install_serial_banner() {
    BUILD_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

    echo "${BUILD_TS}" > "${IMAGE_ROOTFS}/etc/x8-build-info"

    cat > "${IMAGE_ROOTFS}/etc/issue" <<EOF2
Portenta X8 clean Linux
Build: ${BUILD_TS}
Console: \l
SSH: key-only. Serial root password enabled.

EOF2
}

# X8 ROOT PASSWORD AND SERIAL BANNER END

# X8 HOSTNAME AND SERIAL IDENTITY
X8_HOSTNAME ??= "rover-alpha"

ROOTFS_POSTPROCESS_COMMAND += "x8_set_hostname_and_banner;"

x8_set_hostname_and_banner() {
    hostname="${X8_HOSTNAME}"

    echo "$hostname" > "${IMAGE_ROOTFS}/etc/hostname"

    cat > "${IMAGE_ROOTFS}/etc/hosts" <<EOF2
127.0.0.1       localhost
127.0.1.1       $hostname

::1             localhost ip6-localhost ip6-loopback
EOF2

    build="$(cat "${IMAGE_ROOTFS}/etc/x8-build-info" 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ')"

    cat > "${IMAGE_ROOTFS}/etc/issue" <<EOF2
Portenta X8 clean Linux
Hostname: $hostname
Build: $build
Console: \l
SSH: key-only. Serial root password enabled.

EOF2
}

# X8 HOSTNAME AND SERIAL IDENTITY END

# X8 STATIC RESOLVCONF
# Own DNS ourselves:
#   - remove Yocto volatile /etc/resolv.conf -> /var/run/resolv.conf rule
#   - keep /etc/resolv.conf as a real persistent file
#   - DHCP configures IP/routes only, never DNS
ROOTFS_POSTPROCESS_COMMAND += "x8_fix_resolvconf_ownership; x8_install_udhcpc_no_dns;"

x8_fix_resolvconf_ownership() {
    if [ -f ${IMAGE_ROOTFS}/etc/default/volatiles/00_core ]; then
        sed -i '\|/etc/resolv.conf|d; \|/var/run/resolv.conf|d' \
            ${IMAGE_ROOTFS}/etc/default/volatiles/00_core
    fi

    rm -f ${IMAGE_ROOTFS}/etc/resolv.conf
    cat > ${IMAGE_ROOTFS}/etc/resolv.conf <<'EOF2'
# Managed by x8-clean image
nameserver 100.100.100.100
nameserver 1.1.1.1
nameserver 8.8.8.8
options timeout:1 attempts:1
EOF2
}

x8_install_udhcpc_no_dns() {
    install -d ${IMAGE_ROOTFS}/usr/share/udhcpc
    install -d ${IMAGE_ROOTFS}/etc/udhcpc

    cat > ${IMAGE_ROOTFS}/usr/share/udhcpc/default.script <<'EOF2'
#!/bin/sh
# Configure DHCP IP/routes, but never modify /etc/resolv.conf.

case "$1" in
    deconfig)
        ip -4 addr flush dev "$interface" 2>/dev/null || true
        ip link set dev "$interface" up 2>/dev/null || true
        ;;

    bound|renew)
        ip -4 addr flush dev "$interface" 2>/dev/null || true
        ip link set dev "$interface" up 2>/dev/null || true

        if [ -n "$broadcast" ]; then
            ifconfig "$interface" "$ip" netmask "$subnet" broadcast "$broadcast"
        else
            ifconfig "$interface" "$ip" netmask "$subnet"
        fi

        while ip route del default dev "$interface" 2>/dev/null; do :; done

        metric=10
        for r in $router; do
            ip route add default via "$r" dev "$interface" metric "$metric" 2>/dev/null || true
            metric=$((metric + 1))
        done
        ;;
esac

exit 0
EOF2

    chmod 0755 ${IMAGE_ROOTFS}/usr/share/udhcpc/default.script
    cp ${IMAGE_ROOTFS}/usr/share/udhcpc/default.script ${IMAGE_ROOTFS}/etc/udhcpc/default.script
}

# X8 STATIC RESOLVCONF END

# X8 UTF8 LOCALE FOR TMUX
ROOTFS_POSTPROCESS_COMMAND += "x8_install_utf8_locale;"

x8_install_utf8_locale() {
    install -d ${IMAGE_ROOTFS}/etc/profile.d

    cat > ${IMAGE_ROOTFS}/etc/profile.d/locale.sh <<'EOF2'
export LANG=en_US.UTF-8
export LC_CTYPE=en_US.UTF-8
EOF2

    chmod 0644 ${IMAGE_ROOTFS}/etc/profile.d/locale.sh
}

# X8 UTF8 LOCALE FOR TMUX END

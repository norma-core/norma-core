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
    x8-m4-pwm-output-firmware \
    x8h7-init \
    \
    m-bq24195 \
    m-cs42l52 \
    firmware-imx-sdma-imx7d \
    linux-firmware-cyw-fmac-fw \
    linux-firmware-cyw-fmac-nvram \
    linux-firmware-cyw-bt-patch \
    \
    iproute2 \
    ethtool \
    \
    dbus \
    modemmanager \
    modemmanager-init \
    x8-cellulard \
    x8-watchdogd \
    mobile-broadband-provider-info \
    libqmi \
    libmbim \
    glib-2.0 \
    libgpiod \
    libnl \
    libnl-route \
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
    x8-grow-rootfs \
    x8-sdcard-automount \
    \
    v4l-utils \
    alsa-utils \
    \
    wpa-supplicant \
    iw \
    wireless-regdb-static \
    bluez5 \
    \
    tailscale \
    tailscaled-init \
    x8-tailscale-autologin \
    ca-certificates \
    iptables \
    \
    chrony \
    chronyc \
    x8-timesync \
    \
    station \
    \
    vim \
    tmux \
"

IMAGE_FSTYPES += "wic.zst"
WKS_FILE = "x8-normacore-emmc.wks.in"
WKS_FILE:mx8mm-nxp-bsp = "x8-normacore-emmc.wks.in"
X8_ROOTFS_FLASH_SIZE_MB ??= "3072"

# A fresh RTC must not start at Yocto's generic 2018 reproducibility epoch.
# Pin this value in local.conf when reproducing a particular release image.
X8_INITIAL_TIMESTAMP ??= "${DATETIME}"
ROOTFS_POSTPROCESS_COMMAND:append = " x8_set_initial_timestamp;"

python x8_set_initial_timestamp() {
    import datetime
    import os
    import re

    timestamp = d.getVar('X8_INITIAL_TIMESTAMP') or ''
    if not re.fullmatch(r'[0-9]{14}', timestamp):
        bb.fatal('X8_INITIAL_TIMESTAMP must be a UTC timestamp in YYYYMMDDHHMMSS format')
    try:
        datetime.datetime.strptime(timestamp, '%Y%m%d%H%M%S')
    except ValueError:
        bb.fatal('X8_INITIAL_TIMESTAMP is not a valid UTC timestamp')
    with open(os.path.join(d.getVar('IMAGE_ROOTFS'), 'etc', 'timestamp'), 'w') as f:
        f.write(timestamp + '\n')
}

# Optional WPA/WPA2-Personal networks, supplied by local config or the build env.
X8_WIFI_NETWORKS ??= ""
X8_WIFI_COUNTRY ??= ""
X8_WIFI_INTERFACE ??= "wlan0"

ROOTFS_POSTPROCESS_COMMAND += "x8_configure_wifi;"

python x8_configure_wifi() {
    import hashlib
    import json
    import os
    import re

    # Treat credentials literally, including any variable references in passwords.
    raw_networks = d.getVar('X8_WIFI_NETWORKS', False) or ''
    if not raw_networks.strip():
        return
    try:
        networks = json.loads(raw_networks)
    except ValueError:
        bb.fatal('X8_WIFI_NETWORKS must be a JSON array of network objects')
    if not isinstance(networks, list):
        bb.fatal('X8_WIFI_NETWORKS must be a JSON array of network objects')
    if not networks:
        return

    country = d.getVar('X8_WIFI_COUNTRY') or ''
    interface = d.getVar('X8_WIFI_INTERFACE') or ''
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,15}', interface):
        bb.fatal('X8_WIFI_INTERFACE must be a simple interface name (1 to 15 characters)')
    if interface in ('lo', 'eth0'):
        bb.fatal('X8_WIFI_INTERFACE conflicts with an existing interface')
    if country and not re.fullmatch(r'[A-Z]{2}', country):
        bb.fatal('X8_WIFI_COUNTRY must be an uppercase two-letter country code')
    config = 'ctrl_interface=/var/run/wpa_supplicant\nupdate_config=0\n'
    if country:
        config += 'country=%s\n' % country
    for index, network in enumerate(networks):
        # Never include credentials in validation errors.
        label = 'X8_WIFI_NETWORKS entry %d' % (index + 1)
        if not isinstance(network, dict) or set(network) - {'ssid', 'password', 'hidden', 'priority'}:
            bb.fatal(label + ' must be an object with ssid, password, and optional hidden/priority')
        ssid = network.get('ssid')
        password = network.get('password')
        hidden = network.get('hidden', False)
        priority = network.get('priority', 0)
        try:
            ssid_bytes = ssid.encode('utf-8') if isinstance(ssid, str) else b''
        except UnicodeEncodeError:
            bb.fatal(label + ': ssid must be valid UTF-8')
        if not 1 <= len(ssid_bytes) <= 32 or '\x00' in ssid:
            bb.fatal(label + ': ssid must contain 1 to 32 UTF-8 bytes without NUL')
        if not isinstance(password, str):
            bb.fatal(label + ': password is required and must be a string')
        if not isinstance(hidden, bool):
            bb.fatal(label + ': hidden must be a JSON boolean')
        if type(priority) is not int or not 0 <= priority <= 2147483647:
            bb.fatal(label + ': priority must be an integer from 0 to 2147483647')
        if re.fullmatch(r'[0-9a-fA-F]{64}', password):
            psk = password.lower()
        else:
            if not 8 <= len(password) <= 63 or any(ord(c) < 32 or ord(c) > 126 for c in password):
                bb.fatal(label + ': password must be 8 to 63 printable ASCII characters or a 64-digit hex PSK')
            psk = hashlib.pbkdf2_hmac('sha1', password.encode('ascii'), ssid_bytes, 4096, 32).hex()

        # Hex SSIDs and derived PSKs avoid config injection and storing passphrases.
        config += ('\nnetwork={\n    ssid=%s\n    psk=%s\n'
                   '    key_mgmt=WPA-PSK\n    scan_ssid=%d\n    priority=%d\n}\n') % (
                       ssid_bytes.hex(), psk, hidden, priority)

    rootfs = d.getVar('IMAGE_ROOTFS')
    sysconfdir = d.getVar('sysconfdir')
    config_path = sysconfdir + '/wpa_supplicant/x8.conf'
    target = rootfs + config_path
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(config)

    with open(rootfs + sysconfdir + '/network/interfaces', 'a') as stream:
        stream.write(('\n# Build-provisioned Wi-Fi\nauto %s\niface %s inet dhcp\n'
                      '    wpa-driver nl80211\n    wpa-conf %s\n') %
                     (interface, interface, config_path))
}

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
        root_hash='${X8_ROOT_HASH}'
        root_hash="$(printf '%s' "$root_hash" | sed 's/\\\$/\$/g')"

        case "$root_hash" in
            \$[156y]\$*|\$2[aby]\$*) ;;
            *)
                echo 'Unsupported X8_ROOT_HASH format. Expected a crypt hash like $6$...' >&2
                exit 1
                ;;
        esac

        sed -i "s|^root:[^:]*:|root:${root_hash}:|" "${IMAGE_ROOTFS}/etc/shadow"
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

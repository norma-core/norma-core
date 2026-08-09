SUMMARY = "First-boot Tailscale authentication for Portenta X8"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://x8-tailscale-autologin"

inherit update-rc.d

INITSCRIPT_NAME = "x8-tailscale-autologin"
INITSCRIPT_PARAMS = "defaults 46 74"

X8_TAILSCALE_AUTHKEY ??= ""
X8_TAILSCALE_LOGIN_SERVER ??= ""
X8_TAILSCALE_HOSTNAME ??= ""
X8_TAILSCALE_EXTRA_ARGS ??= ""

RDEPENDS:${PN} += "busybox tailscale tailscaled-init"

CONFFILES:${PN} += "${sysconfdir}/default/x8-tailscale-autologin"

do_install() {
    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/x8-tailscale-autologin ${D}${sysconfdir}/init.d/x8-tailscale-autologin

    install -d ${D}${sysconfdir}/default
    cat > ${D}${sysconfdir}/default/x8-tailscale-autologin <<EOF
# x8-tailscale-autologin first-boot authentication.
# X8_TAILSCALE_AUTHKEY is intentionally rendered from local build config.

X8_TAILSCALE_AUTHKEY="${X8_TAILSCALE_AUTHKEY}"
X8_TAILSCALE_LOGIN_SERVER="${X8_TAILSCALE_LOGIN_SERVER}"
X8_TAILSCALE_HOSTNAME="${X8_TAILSCALE_HOSTNAME}"
X8_TAILSCALE_EXTRA_ARGS="${X8_TAILSCALE_EXTRA_ARGS}"
EOF
}

FILES:${PN} += " \
    ${sysconfdir}/init.d/x8-tailscale-autologin \
    ${sysconfdir}/default/x8-tailscale-autologin \
"

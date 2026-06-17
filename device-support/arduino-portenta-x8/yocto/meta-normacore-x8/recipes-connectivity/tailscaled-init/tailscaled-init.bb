SUMMARY = "SysV init script for tailscaled"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://tailscaled"

inherit update-rc.d

INITSCRIPT_NAME = "tailscaled"
INITSCRIPT_PARAMS = "defaults 35 65"

RDEPENDS:${PN} += "tailscale ca-certificates kmod"

do_install() {
    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/tailscaled ${D}${sysconfdir}/init.d/tailscaled
}

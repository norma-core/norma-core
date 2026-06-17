SUMMARY = "Portenta X8 DNS controller for DHCP + Tailscale"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://x8-dns-control file://x8-dns-control.init"

inherit update-rc.d

INITSCRIPT_NAME = "x8-dns-control"
INITSCRIPT_PARAMS = "defaults 45 75"

RDEPENDS:${PN} += "busybox iproute2 tailscale"

do_install() {
    install -d ${D}${sbindir}
    install -m 0755 ${WORKDIR}/x8-dns-control ${D}${sbindir}/x8-dns-control

    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/x8-dns-control.init ${D}${sysconfdir}/init.d/x8-dns-control
}

FILES:${PN} += "${sbindir}/x8-dns-control ${sysconfdir}/init.d/x8-dns-control"

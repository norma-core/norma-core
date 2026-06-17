SUMMARY = "Portenta X8 lightweight network time sync"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://x8-timesync file://x8-timesync.init"

inherit update-rc.d

INITSCRIPT_NAME = "x8-timesync"
INITSCRIPT_PARAMS = "defaults 30 70"

RDEPENDS:${PN} += "busybox iproute2"

do_install() {
    install -d ${D}${sbindir}
    install -m 0755 ${WORKDIR}/x8-timesync ${D}${sbindir}/x8-timesync

    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/x8-timesync.init ${D}${sysconfdir}/init.d/x8-timesync
}

FILES:${PN} += "${sbindir}/x8-timesync ${sysconfdir}/init.d/x8-timesync"

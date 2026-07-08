SUMMARY = "Portenta X8 removable SD-card automount helper"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://80-x8-sdcard-automount.rules \
    file://x8-sdcard-automount \
"

RDEPENDS:${PN} += "busybox util-linux-mount util-linux-mountpoint util-linux-umount"

do_install() {
    install -d ${D}${sbindir}
    install -m 0755 ${WORKDIR}/x8-sdcard-automount ${D}${sbindir}/x8-sdcard-automount

    install -d ${D}${nonarch_base_libdir}/udev/rules.d
    install -m 0644 ${WORKDIR}/80-x8-sdcard-automount.rules \
        ${D}${nonarch_base_libdir}/udev/rules.d/80-x8-sdcard-automount.rules
}

FILES:${PN} += " \
    ${sbindir}/x8-sdcard-automount \
    ${nonarch_base_libdir}/udev/rules.d/80-x8-sdcard-automount.rules \
"

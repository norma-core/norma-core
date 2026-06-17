SUMMARY = "SysV init for Portenta X8 STM32H7 firmware and x8h7 modules"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://x8h7-init"

inherit update-rc.d

INITSCRIPT_NAME = "x8h7-init"
INITSCRIPT_PARAMS = "start 20 S . stop 80 0 1 6 ."

RDEPENDS:${PN} += "\
    kmod \
    openocd \
    m-x8h7 \
    linux-firmware-arduino-portenta-x8-stm32h7 \
"

do_install() {
    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/x8h7-init ${D}${sysconfdir}/init.d/x8h7-init
}

SUMMARY = "SysV init script for ModemManager"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://modemmanager"

inherit update-rc.d

INITSCRIPT_NAME = "modemmanager"
INITSCRIPT_PARAMS = "defaults 30 70"

RDEPENDS:${PN} += "dbus modemmanager"

do_install() {
    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/modemmanager ${D}${sysconfdir}/init.d/modemmanager
}

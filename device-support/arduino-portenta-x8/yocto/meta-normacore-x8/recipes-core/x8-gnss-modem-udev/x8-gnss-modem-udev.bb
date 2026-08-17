SUMMARY = "Reserve the EG25-G secondary AT port for the station GNSS driver"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://77-mm-quectel-gnss-port.rules \
"

do_install() {
    install -d ${D}${nonarch_base_libdir}/udev/rules.d
    install -m 0644 ${WORKDIR}/77-mm-quectel-gnss-port.rules \
        ${D}${nonarch_base_libdir}/udev/rules.d/77-mm-quectel-gnss-port.rules
}

FILES:${PN} += " \
    ${nonarch_base_libdir}/udev/rules.d/77-mm-quectel-gnss-port.rules \
"

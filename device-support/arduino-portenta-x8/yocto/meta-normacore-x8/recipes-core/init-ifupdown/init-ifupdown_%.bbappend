FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://interfaces"

do_install:append() {
    install -d ${D}${sysconfdir}/network
    install -m 0644 ${WORKDIR}/interfaces ${D}${sysconfdir}/network/interfaces
}

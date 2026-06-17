FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://chrony.conf"

do_install:append() {
    install -d ${D}${sysconfdir}
    install -m 0644 ${WORKDIR}/chrony.conf ${D}${sysconfdir}/chrony.conf
}

SUMMARY = "Portenta X8 hardware network watchdog daemon"
DESCRIPTION = "Single-process Portenta X8 hardware watchdog owner with Tailscale DNS reachability policy."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

FILESEXTRAPATHS:prepend := "${THISDIR}/../../../../../../software/arduino-portenta/x8-watchdogd:"

SRC_URI = " \
    file://CMakeLists.txt \
    file://x8-watchdogd.init \
    file://src/main.c \
"

S = "${WORKDIR}"

inherit cmake deploy

RDEPENDS:${PN} += "iputils-ping"

FILES:${PN} += " \
    ${sbindir}/x8-watchdogd \
    ${sysconfdir}/init.d/x8-watchdogd \
"

do_install:append() {
    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/x8-watchdogd.init ${D}${sysconfdir}/init.d/x8-watchdogd
}

do_deploy() {
    install -d ${DEPLOYDIR}
    install -m 0755 ${B}/x8-watchdogd ${DEPLOYDIR}/x8-watchdogd
}

addtask deploy after do_compile before do_build

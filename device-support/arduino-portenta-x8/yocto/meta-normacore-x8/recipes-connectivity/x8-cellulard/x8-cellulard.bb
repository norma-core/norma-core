SUMMARY = "Portenta X8 cellular supervisor daemon"
DESCRIPTION = "Single-process Portenta X8 cellular supervisor built from the NormaCore source tree."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

FILESEXTRAPATHS:prepend := "${THISDIR}/../../../../../../software/arduino-portenta/x8-cellulard:"

SRC_URI = " \
    file://CMakeLists.txt \
    file://x8-cellulard.init \
    file://src/config.c \
    file://src/config.h \
    file://src/gpio_power.c \
    file://src/gpio_power.h \
    file://src/health.c \
    file://src/health.h \
    file://src/main.c \
    file://src/mm.c \
    file://src/mm.h \
    file://src/ppp.c \
    file://src/ppp.h \
    file://src/route.c \
    file://src/route.h \
"

S = "${WORKDIR}"

inherit cmake deploy pkgconfig update-rc.d

INITSCRIPT_NAME = "x8-cellulard"
INITSCRIPT_PARAMS = "defaults 34 66"

X8_CELLULARD_EXTERNAL_APN ??= ""
X8_CELLULARD_SARA_APN ??= ""
X8_CELLULARD_INTERVAL_SEC ??= "30"

DEPENDS = "glib-2.0 modemmanager libgpiod libnl"

RDEPENDS:${PN} += "dbus modemmanager ppp iputils-ping"

CONFFILES:${PN} += "${sysconfdir}/default/x8-cellulard"

FILES:${PN} += " \
    ${sbindir}/x8-cellulard \
    ${sysconfdir}/init.d/x8-cellulard \
    ${sysconfdir}/default/x8-cellulard \
"

do_install:append() {
    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/x8-cellulard.init ${D}${sysconfdir}/init.d/x8-cellulard

    install -d ${D}${sysconfdir}/default
    cat > ${D}${sysconfdir}/default/x8-cellulard <<EOF
# x8-cellulard APN configuration.
# Empty APNs mean the init script will not start the daemon.

X8_CELLULARD_EXTERNAL_APN="${X8_CELLULARD_EXTERNAL_APN}"
X8_CELLULARD_SARA_APN="${X8_CELLULARD_SARA_APN}"
X8_CELLULARD_INTERVAL_SEC="${X8_CELLULARD_INTERVAL_SEC}"
EOF
}

do_deploy() {
    install -d ${DEPLOYDIR}
    install -m 0755 ${B}/x8-cellulard ${DEPLOYDIR}/x8-cellulard
}

addtask deploy after do_compile before do_build

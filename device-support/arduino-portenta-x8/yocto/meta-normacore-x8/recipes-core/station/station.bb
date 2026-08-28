SUMMARY = "NormaCore Station for Portenta X8"
DESCRIPTION = "Installs a prebuilt NormaCore Station binary and SysV supervisor for Portenta X8."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://station.init \
    file://station-supervisor \
    file://station.yaml \
"

inherit update-rc.d

INITSCRIPT_NAME = "station"
INITSCRIPT_PARAMS = "defaults 85 15"

PACKAGE_ARCH = "${MACHINE_ARCH}"
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INHIBIT_SYSROOT_STRIP = "1"
INSANE_SKIP:${PN} += "already-stripped"

NORMACORE_REPO_ROOT ?= "${THISDIR}/../../../../../.."
X8_STATION_BINARY ??= "${NORMACORE_REPO_ROOT}/target/aarch64-unknown-linux-gnu/release/station"

do_configure[noexec] = "1"
do_compile[noexec] = "1"
do_install[nostamp] = "1"

CONFFILES:${PN} += " \
    /etc/default/station \
    /opt/station/station.yaml \
"

FILES:${PN} += " \
    /opt/station \
    /etc/init.d/station \
    /etc/default/station \
"

do_install() {
    if [ ! -f "${X8_STATION_BINARY}" ]; then
        bbfatal "X8_STATION_BINARY does not exist: ${X8_STATION_BINARY}. Build it with: cd ${NORMACORE_REPO_ROOT}/software/station/bin/station && make build-arm64"
    fi

    install -d ${D}/opt/station/station_data
    install -m 0755 "${X8_STATION_BINARY}" ${D}/opt/station/station
    install -m 0755 ${WORKDIR}/station-supervisor ${D}/opt/station/station-supervisor
    install -m 0644 ${WORKDIR}/station.yaml ${D}/opt/station/station.yaml

    if [ -f "${TOPDIR}/conf/station.crypto_seed" ]; then
        install -m 0600 "${TOPDIR}/conf/station.crypto_seed" ${D}/opt/station/station_data/.crypto_seed
    fi

    install -d ${D}${sysconfdir}/init.d ${D}${sysconfdir}/default
    install -m 0755 ${WORKDIR}/station.init ${D}${sysconfdir}/init.d/station

    cat > ${D}${sysconfdir}/default/station <<EOF
# NormaCore Station service configuration.
STATION_ENABLED="1"
STATION_BINARY="/opt/station/station"
STATION_WORKDIR="/opt/station"
STATION_CONFIG="/opt/station/station.yaml"
STATION_DATA_DIR="/opt/station/station_data"
STATION_TCP_ADDR="0.0.0.0:8888"
STATION_WEB_ADDR="0.0.0.0:8889"
STATION_MAX_MEMORY_USAGE="128M"
STATION_NORMFS_PERSISTENCE_MODE="memory-only"
STATION_RESTART_DELAY_SEC="5"
STATION_LOG="/var/log/station.log"
STATION_EXTRA_ARGS=""
EOF
}

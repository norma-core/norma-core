SUMMARY = "NormaCore Portenta X8 M4 PWM output firmware"
DESCRIPTION = "Installs a prebuilt NormaCore PWM output M4 firmware ELF for first-boot flashing."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

PACKAGE_ARCH = "${MACHINE_ARCH}"
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INHIBIT_SYSROOT_STRIP = "1"
INSANE_SKIP:${PN} += "arch"

NORMACORE_REPO_ROOT ?= "${THISDIR}/../../../../../.."
X8_M4_USER_SKETCH_ELF ??= "${NORMACORE_REPO_ROOT}/target/arduino-portenta-x8/pwm-output-m4/pwm_output_m4.ino.elf"

do_configure[noexec] = "1"
do_compile[noexec] = "1"
do_install[nostamp] = "1"

do_install() {
    if [ -z "${X8_M4_USER_SKETCH_ELF}" ]; then
        bbfatal "Missing X8_M4_USER_SKETCH_ELF. Build the M4 firmware separately and set X8_M4_USER_SKETCH_ELF to the resulting pwm_output_m4.ino.elf path."
    fi

    if [ ! -f "${X8_M4_USER_SKETCH_ELF}" ]; then
        bbfatal "X8_M4_USER_SKETCH_ELF does not exist: ${X8_M4_USER_SKETCH_ELF}. Build it with: arduino-cli compile --fqbn arduino:mbed_portenta:portenta_x8 --output-dir ${NORMACORE_REPO_ROOT}/target/arduino-portenta-x8/pwm-output-m4 ${NORMACORE_REPO_ROOT}/software/drivers/pwm-output/firmware/pwm_output_m4"
    fi

    install -d ${D}/opt/x8-firmware
    install -m 0644 "${X8_M4_USER_SKETCH_ELF}" ${D}/opt/x8-firmware/m4-user-sketch.elf
}

FILES:${PN} += "/opt/x8-firmware/m4-user-sketch.elf"

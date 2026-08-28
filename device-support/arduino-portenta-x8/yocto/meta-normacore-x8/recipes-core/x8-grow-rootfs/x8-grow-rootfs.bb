SUMMARY = "First-boot root filesystem expansion for Portenta X8"
DESCRIPTION = "Expands the compact flashed root partition and ext4 filesystem to the full eMMC on first boot."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://x8-grow-rootfs"

inherit update-rc.d

INITSCRIPT_NAME = "x8-grow-rootfs"
INITSCRIPT_PARAMS = "defaults 08 92"

RDEPENDS:${PN} += "\
    busybox \
    e2fsprogs-resize2fs \
    util-linux-blockdev \
    util-linux-partx \
    util-linux-sfdisk \
"

do_install() {
    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/x8-grow-rootfs ${D}${sysconfdir}/init.d/x8-grow-rootfs
}

FILES:${PN} += "${sysconfdir}/init.d/x8-grow-rootfs"

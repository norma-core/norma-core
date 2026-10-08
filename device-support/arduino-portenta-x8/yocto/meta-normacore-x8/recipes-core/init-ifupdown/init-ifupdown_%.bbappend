FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://interfaces file://x8-wifi-dhcp file://x8-wifi-dhcp-action"

RDEPENDS:${PN}:append = " wpa-supplicant-cli iproute2"

do_install:append() {
    install -d ${D}${sysconfdir}/network
    install -m 0644 ${WORKDIR}/interfaces ${D}${sysconfdir}/network/interfaces
    install -d ${D}${sysconfdir}/network/if-up.d ${D}${sysconfdir}/network/if-down.d
    install -m 0755 ${WORKDIR}/x8-wifi-dhcp ${D}${sysconfdir}/network/if-up.d/x8-wifi-dhcp
    ln -sf ../if-up.d/x8-wifi-dhcp ${D}${sysconfdir}/network/if-down.d/x8-wifi-dhcp
    install -d ${D}${sbindir}
    install -m 0755 ${WORKDIR}/x8-wifi-dhcp-action ${D}${sbindir}/x8-wifi-dhcp-action
}

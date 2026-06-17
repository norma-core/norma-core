FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://sshd_config"

PACKAGECONFIG:remove = "systemd-sshd-socket-mode systemd-sshd-service-mode"

do_install:append() {
    install -d ${D}${sysconfdir}/ssh

    install -m 0600 ${WORKDIR}/sshd_config ${D}${sysconfdir}/ssh/sshd_config
    install -m 0600 ${WORKDIR}/sshd_config ${D}${sysconfdir}/ssh/sshd_config_readonly

    # Never bake host private keys into the image.
    rm -f ${D}${sysconfdir}/ssh/ssh_host_*_key
    rm -f ${D}${sysconfdir}/ssh/ssh_host_*_key.pub

    # Remove systemd unit files if present.
    rm -rf ${D}${systemd_system_unitdir}
}

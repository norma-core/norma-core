FILESEXTRAPATHS:prepend := "${THISDIR}/${PN}:"

SRC_URI:append:portenta-x8 = " \
    file://normacore-x8-cellular.cfg \
"

RDEPENDS:${PN}:append = " openocd"

do_install:append() {
    helper="${D}/usr/arduino/extra/program-m4.sh"
    if [ -f "$helper" ]; then
        sed -i \
            -e '2i set -e' \
            -e 's#/bin/openocd#/usr/bin/openocd#g' \
            -e 's#/tmp/arduino/m4-user-sketch.elf#/opt/x8-firmware/m4-user-sketch.elf#g' \
            "$helper"
    fi
}

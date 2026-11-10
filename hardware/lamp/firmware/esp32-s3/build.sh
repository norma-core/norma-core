#!/usr/bin/env bash
# Runs idf.py for this project with ESP-IDF 5.5 on macOS or Linux (the PowerShell twin is build.ps1).
# Examples:  ./build.sh build                 ./build.sh -p /dev/cu.usbmodem1101 flash monitor
#            ./build.sh app-flash monitor     ./build.sh menuconfig
# Finds ESP-IDF in $IDF_PATH, else ~/esp/esp-idf (where Espressif's guide puts it), sources its export.sh and runs
# idf.py from the project directory. Without -p idf.py tries every serial port it can find.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${IDF_PATH:-}" ]; then
    for d in "$HOME/esp/esp-idf" "$HOME/esp/esp-idf-v5.5" "$HOME/esp-idf" /opt/esp/idf /opt/esp-idf; do
        if [ -f "$d/export.sh" ]; then export IDF_PATH="$d"; break; fi
    done
fi
if [ -z "${IDF_PATH:-}" ] || [ ! -f "$IDF_PATH/export.sh" ]; then
    echo "ESP-IDF not found. Install v5.5 (https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/get-started/):" >&2
    echo "  mkdir -p ~/esp && cd ~/esp && git clone -b v5.5.1 --recursive https://github.com/espressif/esp-idf.git" >&2
    echo "  ~/esp/esp-idf/install.sh esp32s3" >&2
    echo "or set IDF_PATH to an existing copy." >&2
    exit 1
fi
for tool in cmake ninja; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool is not installed. ESP-IDF needs it: macOS 'brew install cmake ninja', Debian/Ubuntu 'sudo apt install cmake ninja-build'." >&2
        exit 1
    fi
done

# export.sh is chatty and only partly follows "set -e"; keep its output for the error case only.
log="$(mktemp "${TMPDIR:-/tmp}/idf-export.XXXXXX")"
# shellcheck disable=SC1091
if ! . "$IDF_PATH/export.sh" >"$log" 2>&1; then
    cat "$log" >&2
    rm -f "$log"
    echo "export.sh failed. Did you run '$IDF_PATH/install.sh esp32s3' after cloning?" >&2
    exit 1
fi
rm -f "$log"

cd "$here" || exit 1
if [ $# -eq 0 ]; then set -- build; fi
exec idf.py "$@"

#!/usr/bin/env bash
# Sends the built app to the lamp over Wi-Fi (macOS / Linux; the PowerShell twin is ota.ps1):
#   ./ota.sh                  nc-lamp.local
#   ./ota.sh 192.168.1.50     the lamp's IP, when .local does not resolve (Linux without avahi, some routers)
# Build first (./build.sh build). Only the app goes over; the model partition stays as it is.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lamp="${1:-nc-lamp.local}"
bin="$here/build/nc_lamp.bin"

if [ ! -f "$bin" ]; then echo "no $bin - run ./build.sh build first" >&2; exit 1; fi
if ! command -v curl >/dev/null 2>&1; then echo "curl is not installed" >&2; exit 1; fi

size=$(wc -c <"$bin" | tr -d ' ')
echo "sending $size bytes to http://$lamp/update ..."
body="$(mktemp "${TMPDIR:-/tmp}/ota-reply.XXXXXX")"
# -H 'Expect:' : curl would otherwise wait a second for a "100 Continue" the lamp's server never sends.
code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/octet-stream' -H 'Expect:' --data-binary "@$bin" "http://$lamp/update")
rc=$?
cat "$body"; echo
rm -f "$body"
if [ $rc -ne 0 ]; then echo "upload failed (curl exit $rc)" >&2; exit 1; fi
if [ "$code" != "200" ]; then echo "the lamp answered HTTP $code: the old firmware stays" >&2; exit 1; fi
echo "the lamp reboots now; give it about 10 s"

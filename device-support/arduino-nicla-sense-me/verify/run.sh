#!/bin/sh
# Verifies the firmware's C modules (../src/*.c) with Frama-C, for any
# behaviour of the hub, the flash store and the host. Needs Docker.
#
# 1. WP proves the contracts written next to the code and the absence of
#    runtime errors: bounds, overflow, invalid shifts, division by zero. No
#    lemma is assumed. Extra arguments go to this step
#    (e.g. -wp-fct bhy2calib_service).
# 2. Eva covers what WP cannot express: that no misaligned pointer is ever
#    created, that no call goes through an invalid function pointer, and the
#    memory safety of nicla_f32_bits (it reinterprets a float as bytes, which
#    WP's typed memory model rejects). The step fails unless Eva reaches every
#    statement of every function and raises none of those alarms. Eva's alarms
#    of the kinds step 1 proves are expected and ignored: Eva starts each
#    function from arbitrary arguments, without the preconditions WP uses.
set -e
cd "$(dirname "$0")/.."
docker image inspect frama-c-solvers:33.0 >/dev/null 2>&1 || docker build -q -t frama-c-solvers:33.0 verify
SOURCES="src/nicla_hub.c src/bhy2_calibration.c src/nicla_protocol.c"

echo "== 1/2 WP: contracts and runtime errors"
log=$(mktemp)
trap 'rm -f "$log"' EXIT
docker run --rm -v "$PWD":/work -w /work frama-c-solvers:33.0 \
  frama-c -machdep gcc_x86_32 -cpp-extra-args="-Iverify/stubs -Isrc -include verify/stubs/string.h -D__FC_STRING_H" \
          -wp -wp-rte -wp-prover alt-ergo,z3,cvc5,qed -wp-timeout 60 \
          -wp-skip-fct nicla_f32_bits "$@" $SOURCES 2>&1 | tee "$log"
# frama-c exits 0 even with unproved goals: require "Proved goals: N / N".
awk '/Proved goals:/ { seen = 1; if ($4 != $6) bad = 1 } END { exit !(seen && !bad) }' "$log" \
  || { echo "WP: not every goal is proved" >&2; exit 1; }

echo "== 2/2 Eva: pointer alignment, function pointers, nicla_f32_bits"
FUNCTIONS="bhy2calib_restore_profiles bhy2calib_service bhy2calib_get_status
  nicla_hub_read_parameter nicla_hub_read_bsx_state nicla_hub_write_bsx_state
  nicla_hub_read_sensor_range nicla_hub_kernel_version
  nicla_put_u16 nicla_put_i16 nicla_put_u32 nicla_put_f32 nicla_f32_bits
  nicla_publish_accel_range nicla_publish_gyro_range nicla_crc8 nicla_build_frame
  nicla_stream_command nicla_stream_active nicla_stream_poll"
docker run --rm -v "$PWD":/work -w /work -e FUNCTIONS="$FUNCTIONS" -e SOURCES="$SOURCES" frama-c-solvers:33.0 sh -c '
  status=0
  for f in $FUNCTIONS; do
    frama-c -machdep gcc_x86_32 -cpp-extra-args="-Iverify/stubs -Isrc" \
            -eva -eva-context-width 600 -warn-unaligned-pointer -warn-special-float none \
            -main $f -lib-entry verify/eva_harness.c $SOURCES > /tmp/eva.log 2>&1 || { echo "  $f: Eva failed"; grep -iE "error" -A2 /tmp/eva.log | head -6; status=1; continue; }
    unaligned=$(grep -c "unaligned pointer" /tmp/eva.log)
    fnptr=$(grep -c "valid_function" /tmp/eva.log)
    coverage=$(grep -E "statements reached" /tmp/eva.log | head -1 | sed "s/.*, //")
    echo "  $f: $coverage alignment alarms $unaligned, function-pointer alarms $fnptr"
    case "$coverage" in *": 100% coverage."*) ;; *) status=1 ;; esac
    [ "$unaligned" = 0 ] && [ "$fnptr" = 0 ] || status=1
    if [ "$f" = nicla_f32_bits ] && ! grep -q "^ *0 alarms generated" /tmp/eva.log; then echo "  nicla_f32_bits: alarms raised"; status=1; fi
  done
  exit $status' || { echo "Eva: check failed" >&2; exit 1; }
echo "== verified"

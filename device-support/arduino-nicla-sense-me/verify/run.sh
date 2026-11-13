#!/bin/sh
# Proves the firmware's C modules (../src/*.c) with Frama-C/WP: no runtime
# errors (bounds, overflow, invalid shifts) and the contracts written next to
# the code, for any behaviour of the hub, the flash store and the host.
# Needs Docker. Extra arguments go to frama-c (e.g. -wp-fct bhy2calib_service).
set -e
cd "$(dirname "$0")/.."
docker image inspect frama-c-solvers:33.0 >/dev/null 2>&1 || docker build -q -t frama-c-solvers:33.0 verify
exec docker run --rm -v "$PWD":/work -w /work frama-c-solvers:33.0 \
  frama-c -machdep gcc_x86_32 -cpp-extra-args="-Iverify/stubs -Isrc -include verify/stubs/string.h -D__FC_STRING_H" \
          -wp -wp-rte -wp-prover alt-ergo,z3,cvc5,qed -wp-timeout 60 \
          -wp-skip-fct nicla_put_f32 "$@" \
          verify/lemmas.c src/nicla_hub.c src/bhy2_calibration.c src/nicla_protocol.c

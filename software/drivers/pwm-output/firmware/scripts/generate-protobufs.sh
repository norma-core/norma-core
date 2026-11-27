#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

GREMLINC_GEN="${GREMLINC_GEN:-gremlinc-gen}"
PROTO_ROOT="../../../../protobufs/drivers/pwm-output"

"${GREMLINC_GEN}" \
  -R "${PROTO_ROOT}" \
  -o pwm_output_m4/src \
  pwm_output.proto

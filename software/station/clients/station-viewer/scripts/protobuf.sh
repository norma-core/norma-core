#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

SRC=$(realpath ../../../../protobufs)

echo "build proto"

npm exec -- pbjs --wrap es6 --force-long -t static-module --es6 -l eslint-disable \
  ${SRC}/station/commands.proto \
  ${SRC}/station/inference.proto \
  ${SRC}/station/startups.proto \
  ${SRC}/station/inference_tags.proto \
  ${SRC}/drivers/st3215/st3215.proto \
  ${SRC}/drivers/vesc-trampa/vesc_trampa.proto \
  ${SRC}/drivers/usbvideo/usbvideo.proto \
  ${SRC}/drivers/motors-mirroring/mirroring.proto \
  ${SRC}/drivers/yahboom-dogzilla-lite/yahboom_dogzilla_lite.proto \
  ${SRC}/drivers/sysinfo/sysinfo.proto \
  ${SRC}/drivers/arduino-nicla-sense-env/arduino_nicla_sense_env.proto \
  ${SRC}/drivers/ina226/ina226.proto \
  ${SRC}/drivers/airgradient-open-air-o-1pst/airgradient_open_air_o_1pst.proto \
  ${SRC}/drivers/victron-smartsolar-mppt/victron_smartsolar_mppt.proto \
  ${SRC}/drivers/pwm-output/pwm_output.proto \
  ${SRC}/drivers/dmesg/dmesg.proto \
  ${SRC}/drivers/inferences/normvla.proto \
  ${SRC}/drivers/hikmicro/hikmicro.proto \
  ${SRC}/normfs/normfs.proto \
  -o src/api/proto.js

{
  echo 'import * as $protobuf from "protobufjs";'
  echo 'import Long = require("long");'
  node node_modules/jsdoc/jsdoc.js \
    -c node_modules/protobufjs-cli/lib/tsd-jsdoc.json \
    -q 'module=null&comments=true' \
    src/api/proto.js
} > src/api/proto.d.ts

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
  ${SRC}/drivers/inferences/normvla.proto \
  ${SRC}/normfs/normfs.proto \
  -o src/api/proto.js
npm exec -- pbts src/api/proto.js -o src/api/proto.d.ts

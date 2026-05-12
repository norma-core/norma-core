#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

SRC=$(realpath ../../../../../protobufs)

echo "build proto"

yarn run pbjs --wrap es6 --force-long -t static-module --es6 -l eslint-disable \
  -p ${SRC}/drivers \
  ${SRC}/station/commands.proto \
  ${SRC}/station/inference.proto \
  ${SRC}/station/startups.proto \
  ${SRC}/station/inference_tags.proto \
  ${SRC}/drivers/st3215/st3215.proto \
  ${SRC}/drivers/usbvideo/usbvideo.proto \
  ${SRC}/drivers/motors-mirroring/mirroring.proto \
  ${SRC}/drivers/yahboom-dogzilla-lite/yahboom_dogzilla_lite.proto \
  ${SRC}/drivers/sysinfo/sysinfo.proto \
  ${SRC}/drivers/inferences/normvla.proto \
  ${SRC}/normfs/normfs.proto \
  -o src/api/proto.js
yarn run pbts src/api/proto.js -o src/api/proto.d.ts

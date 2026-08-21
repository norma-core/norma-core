# PWM Output M4 Firmware

This firmware side consumes the same `pwm_output.TxEnvelope` protobuf that the Station driver records to NormFS. Linux sends it inside a small binary frame:

```text
NCWV | version u8=1 | payload_len le32 | protobuf payload | crc32 le32
```

The frame CRC is calculated over the header and protobuf payload. The protobuf runtime is vendored from `gremlin.c` so the generated reader code can be compiled without fetching external dependencies.

The host-testable C core lives in `pwm_output_m4/src/` so the Arduino builder can compile the sketch without parent-directory includes:

- `protocol.*` decodes the `NCWV` frame.
- `wave_engine.*` parses `TxEnvelope` and executes last-write-wins high/low wave commands.

`pwm_output_m4/pwm_output_m4.ino` is the Portenta X8 M4 sketch. It uses the board details verified in `/home/ab/Downloads/x8_servo_m4.ino`: PWM7/PWM8/PWM9 map to `PC_6`/`PC_9`/`PC_8`, and those pins need push-pull output mode because they may boot as weak/open-drain alternate pads.

Build the host tests:

```sh
cmake -S software/drivers/pwm-output/firmware -B software/drivers/pwm-output/firmware/build
cmake --build software/drivers/pwm-output/firmware/build
ctest --test-dir software/drivers/pwm-output/firmware/build --output-on-failure
```

Build the M4 sketch:

```sh
arduino-cli compile --fqbn arduino:mbed_portenta:portenta_x8 software/drivers/pwm-output/firmware/pwm_output_m4
```

The sketch accepts raw framed commands from `NC_PWM_STREAM` and exposes `RPC.bind("pwmFrame", ...)` for `/dev/x8h7_ui`. The RPC argument is msgpack `bin` containing the exact `NCWV` frame bytes.

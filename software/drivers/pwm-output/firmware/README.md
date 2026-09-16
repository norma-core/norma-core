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

## Pulse timing and web rover controls

The web rover control session refreshes steering every 50 ms while controls are
active. Each finite command requests 125 cycles at a 20 ms period. An unchanged
wave refreshes the remaining cycle count without restarting its high pulse or
low gap. The count includes the cycle already in progress, so pulses stop within
2.5 seconds of the last refresh. Once expired, the channel stays low until another
command arrives.

The sketch advances PWM in the main loop. Protobuf decoding happens before a
short critical section that serializes RPC updates with that loop. RPC reads its
own frame storage rather than sharing the serial receive buffer. Host tests
cover pulse timing across repeated web-style refreshes and expiry; actual pin
jitter and servo noise still need measurement on the board.

## Finite pulses and continuous servo hold

Camera servo calibration on `rover-alpha-u7a8vw5y.server`: output ID `cameras`,
channel PWM9 (`PC_8`), 20 ms period. The tested command range is -71° through
270° (606–2500 µs after rounding), using `pulse_us = round(1000 + degrees *
1000 / 180)`. The current 0° reference is 1000 µs. Keep camera commands within
this calibrated range; use `FOREVER` for continuous hold.

`WaveCommand.repeat_mode` selects how the M4 repeats the segments:

| Mode | `repeat` | Behavior |
| --- | --- | --- |
| `WAVE_REPEAT_MODE_FINITE` (0, default) | Positive cycle count | Generate that many cycles, then drive the channel low. |
| `WAVE_REPEAT_MODE_FOREVER` (1) | 0 | Keep generating the pulse train until replaced or disabled. |

Unknown modes and inconsistent mode/count pairs are rejected without replacing
the active wave. The existing finite command format retains its meaning.

For example, a 1500 µs high pulse followed by 18500 µs low repeats at 50 Hz:

```json
{
  "target_output_id": "steering",
  "wave": {
    "channel": 7,
    "repeat_mode": "WAVE_REPEAT_MODE_FOREVER",
    "repeat": 0,
    "segments": [
      { "level": "WAVE_LEVEL_HIGH", "duration_us": 1500 },
      { "level": "WAVE_LEVEL_LOW", "duration_us": 18500 }
    ]
  }
}
```

These are protobuf JSON field names for `pwm_output.Command`; the transport
still sends binary protobuf inside the existing `TxEnvelope` and `NCWV` frame.
The firmware holds the commanded pulse width, without measuring servo position.
No repeated messages from Linux are needed. Host disconnect does not cancel the
wave. Different segments on that channel replace it immediately; identical
segments preserve the pulse phase and update the repeat mode/count, including
when switching between finite and forever. `disable` drives that channel low.
Other channels continue independently. MCU restart clears all waves.

Station Viewer helpers also accept `'forever'` in their repeat argument:

```ts
await setPwmOutputServoPulse('steering', 7, 1500, 20000, 'forever');
await disablePwmOutput('steering', 7);
```

Deploy the updated station driver and M4 firmware together to use the new mode.
Older versions reject the zero-repeat hold command rather than executing it as a
finite wave. Existing steering controls continue to send finite commands unless
the caller explicitly requests a hold.

Regenerate the C bindings from the schema using Gremlin:

```sh
GREMLINC_GEN=/path/to/gremlinc-gen \
  sh software/drivers/pwm-output/firmware/scripts/generate-protobufs.sh
```

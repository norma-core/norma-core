// NormaCore PWM output firmware for the Portenta X8 M4 core.
//
// The Station driver sends framed pwm_output.TxEnvelope protobuf messages.
// This sketch parses those frames and emits high/low waves on carrier PWM
// pins 7, 8, and 9. It intentionally does not expose servo degrees or
// normalized commands; the client owns pulse timings.

#include <Arduino.h>
#include "RPC.h"
#include "rpc/msgpack/adaptor/raw.hpp"
#include <string.h>

extern "C" {
#include "src/norma_pwm_output_core.h"
}

static const size_t RX_BUF_LEN = 1024;

static uint8_t rx_buf[RX_BUF_LEN];
static size_t rx_len = 0;
static pwm_output_wave_engine wave_engine;
static uint32_t last_tick_us = 0;

static mbed::DigitalOut out7(PC_6, 0);
static mbed::DigitalOut out8(PC_9, 0);
static mbed::DigitalOut out9(PC_8, 0);

#ifndef NC_PWM_STREAM
#define NC_PWM_STREAM Serial
#endif

static mbed::DigitalOut *channel_output(uint32_t channel) {
  switch (channel) {
    case 7: return &out7;
    case 8: return &out8;
    case 9: return &out9;
    default: return nullptr;
  }
}

extern "C" void pwm_output_wave_write_level(uint32_t channel, enum pwm_output_wave_level level) {
  mbed::DigitalOut *out = channel_output(channel);
  if (out == nullptr) {
    return;
  }
  *out = (level == PWM_OUTPUT_WAVE_LEVEL_HIGH) ? 1 : 0;
}

static void force_pwm_pins_push_pull() {
  for (uint32_t pin = 0; pin < 16; pin++) {
    if (pin == 6 || pin == 8 || pin == 9) {
      GPIOC->OTYPER &= ~(1u << pin);
      GPIOC->PUPDR &= ~(3u << (2 * pin));
      GPIOC->OSPEEDR = (GPIOC->OSPEEDR & ~(3u << (2 * pin))) | (1u << (2 * pin));
    }
  }
}

static int apply_payload(const uint8_t *payload, size_t payload_len) {
  enum pwm_output_wave_status status =
      pwm_output_wave_engine_apply_tx_payload(&wave_engine, payload, payload_len);
  return (status == PWM_OUTPUT_WAVE_OK) ? 0 : -(int)status;
}

static int apply_frame_bytes(const uint8_t *frame, size_t frame_len) {
  const uint8_t *payload = nullptr;
  size_t payload_len = 0;
  size_t consumed = 0;
  enum pwm_output_protocol_status status =
      pwm_output_protocol_decode_frame(frame, frame_len, &payload, &payload_len, &consumed);
  if (status != PWM_OUTPUT_PROTOCOL_OK || consumed != frame_len) {
    return -100 - (int)status;
  }
  return apply_payload(payload, payload_len);
}

int pwmFrame(clmdep_msgpack::type::raw_ref frame) {
  size_t frame_len = frame.size;
  if (frame_len > RX_BUF_LEN) {
    return -1;
  }

  for (size_t i = 0; i < frame_len; i++) {
    rx_buf[i] = (uint8_t)frame.ptr[i];
  }
  return apply_frame_bytes(rx_buf, frame_len);
}

static void drop_rx_prefix(size_t count) {
  if (count >= rx_len) {
    rx_len = 0;
    return;
  }
  memmove(rx_buf, rx_buf + count, rx_len - count);
  rx_len -= count;
}

static void process_rx_frames() {
  for (;;) {
    const uint8_t *payload = nullptr;
    size_t payload_len = 0;
    size_t frame_len = 0;
    enum pwm_output_protocol_status status =
        pwm_output_protocol_decode_frame(rx_buf, rx_len, &payload, &payload_len, &frame_len);

    if (status == PWM_OUTPUT_PROTOCOL_OK) {
      apply_payload(payload, payload_len);
      drop_rx_prefix(frame_len);
      continue;
    }
    if (status == PWM_OUTPUT_PROTOCOL_NEED_MORE) {
      return;
    }

    drop_rx_prefix(1);
  }
}

static void read_stream() {
  while (NC_PWM_STREAM.available() > 0) {
    int byte_value = NC_PWM_STREAM.read();
    if (byte_value < 0) {
      break;
    }
    if (rx_len == RX_BUF_LEN) {
      drop_rx_prefix(1);
    }
    rx_buf[rx_len++] = (uint8_t)byte_value;
    process_rx_frames();
  }
}

void setup() {
  force_pwm_pins_push_pull();
  pwm_output_wave_engine_init(&wave_engine);
  last_tick_us = micros();

  NC_PWM_STREAM.begin(115200);

  RPC.begin();
  RPC.bind("pwmFrame", pwmFrame);
}

void loop() {
  uint32_t now = micros();
  uint32_t elapsed = now - last_tick_us;
  last_tick_us = now;
  pwm_output_wave_engine_tick(&wave_engine, elapsed);
  read_stream();
}

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWebSocket {
  static readonly OPEN = 1;

  readyState = 0;
  binaryType: BinaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  close() {}
  send() {}
}

describe('PWM output steering helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps steering degrees to RC servo pulse widths with 90 degrees centered', async () => {
    const {
      PWM_OUTPUT_STEERING_MAX_DEG,
      PWM_OUTPUT_STEERING_MIN_DEG,
      pwmOutputPulseWidthForSteeringDeg,
    } = await import('./commands');

    expect(PWM_OUTPUT_STEERING_MIN_DEG).toBe(50);
    expect(PWM_OUTPUT_STEERING_MAX_DEG).toBe(130);
    expect(pwmOutputPulseWidthForSteeringDeg(0)).toBe(1278);
    expect(pwmOutputPulseWidthForSteeringDeg(50)).toBe(1278);
    expect(pwmOutputPulseWidthForSteeringDeg(90)).toBe(1500);
    expect(pwmOutputPulseWidthForSteeringDeg(130)).toBe(1722);
    expect(pwmOutputPulseWidthForSteeringDeg(180)).toBe(1722);
  });

  it('supports reversed pulse calibration for inverted steering', async () => {
    const { pwmOutputPulseWidthForSteeringDeg } = await import('./commands');

    expect(pwmOutputPulseWidthForSteeringDeg(0, 2000, 1000)).toBe(1722);
    expect(pwmOutputPulseWidthForSteeringDeg(50, 2000, 1000)).toBe(1722);
    expect(pwmOutputPulseWidthForSteeringDeg(90, 2000, 1000)).toBe(1500);
    expect(pwmOutputPulseWidthForSteeringDeg(130, 2000, 1000)).toBe(1278);
    expect(pwmOutputPulseWidthForSteeringDeg(180, 2000, 1000)).toBe(1278);
  });
});

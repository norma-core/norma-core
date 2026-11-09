import { describe, expect, it } from 'vitest';
import type { st3215 } from '@/api/proto.js';
import { motorsToArmState } from './arm-state';

const ADDR_PRESENT_POSITION = 0x38;

const motor = (
  id: number | null,
  position: number,
  extra: Partial<st3215.InferenceState.IMotorState> = {},
): st3215.InferenceState.IMotorState => {
  const state = new Uint8Array(0x47);
  state[ADDR_PRESENT_POSITION] = position & 0xff;
  state[ADDR_PRESENT_POSITION + 1] = position >> 8;
  return { id, state, ...extra };
};

describe('motorsToArmState', () => {
  it('normalises each position into its calibrated range, indexed by motor id', () => {
    const { positions, statuses } = motorsToArmState([
      motor(2, 3000, { rangeMin: 1000, rangeMax: 3000 }),
      motor(1, 1500, { rangeMin: 1000, rangeMax: 3000 }),
    ]);
    expect(positions).toEqual([0.25, 1]);
    expect(statuses).toEqual(['ok', 'ok']);
  });

  it('handles a range that wraps past the encoder end', () => {
    // rangeMin 4000 → 0 → rangeMax 95: total travel 190 steps.
    const { positions } = motorsToArmState([
      motor(1, 4095, { rangeMin: 4000, rangeMax: 95 }),
      motor(2, 0, { rangeMin: 4000, rangeMax: 95 }),
    ]);
    expect(positions[0]).toBeCloseTo(95 / 190);
    expect(positions[1]).toBeCloseTo(95 / 190);
  });

  it('handles a wrapped range whose upper stop is the encoder zero', () => {
    // rangeMin 4000 → 0 (= rangeMax): total travel 95 steps, ending exactly at 0.
    const { positions } = motorsToArmState([
      motor(1, 4000, { rangeMin: 4000, rangeMax: 0 }),
      motor(2, 0, { rangeMin: 4000, rangeMax: 0 }),
    ]);
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBe(1);
  });

  it('defaults an uncalibrated motor to the full encoder range and flags errors', () => {
    const { positions, statuses } = motorsToArmState([motor(1, 4095, { error: {} })]);
    expect(positions).toEqual([1]);
    expect(statuses).toEqual(['error']);
  });

  it('skips motors without an id and reads 0 for a motor without state', () => {
    const { positions, statuses } = motorsToArmState([motor(null, 500), { id: 1 }]);
    expect(positions).toEqual([0]);
    expect(statuses).toEqual(['ok']);
  });
});

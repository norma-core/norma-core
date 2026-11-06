import { describe, expect, it } from 'vitest';
import type { st3215 } from '@/api/proto.js';
import { getBusVoltage, isLeaderBus, LEADER_MAX_VOLTAGE_DECIVOLTS } from './bus-role';

const ADDR_PRESENT_VOLTAGE = 0x3e;

const motor = (decivolts: number): st3215.InferenceState.IMotorState => {
  const state = new Uint8Array(0x47);
  state[ADDR_PRESENT_VOLTAGE] = decivolts;
  return { id: 1, state };
};

describe('getBusVoltage', () => {
  it('returns the highest voltage any motor reports', () => {
    expect(getBusVoltage([motor(118), motor(121), motor(119)])).toBe(121);
  });

  it('ignores motors without a state or with a zero reading', () => {
    expect(getBusVoltage([{ id: 1 }, motor(0), motor(51)])).toBe(51);
    expect(getBusVoltage([{ id: 1 }, motor(0)])).toBeNull();
    expect(getBusVoltage([])).toBeNull();
    expect(getBusVoltage(undefined)).toBeNull();
  });

  it('ignores a truncated state buffer', () => {
    expect(getBusVoltage([{ id: 1, state: new Uint8Array(4) }])).toBeNull();
  });
});

describe('isLeaderBus', () => {
  it('is true for a 5 V or 7.4 V supply and false for 12 V', () => {
    expect(isLeaderBus([motor(50), motor(49)])).toBe(true);
    expect(isLeaderBus([motor(74)])).toBe(true);
    expect(isLeaderBus([motor(120), motor(118)])).toBe(false);
  });

  it('treats one loaded motor dipping low as still a follower', () => {
    expect(isLeaderBus([motor(85), motor(119)])).toBe(false);
  });

  it('is exclusive at the threshold', () => {
    expect(isLeaderBus([motor(LEADER_MAX_VOLTAGE_DECIVOLTS - 1)])).toBe(true);
    expect(isLeaderBus([motor(LEADER_MAX_VOLTAGE_DECIVOLTS)])).toBe(false);
  });

  it('is false when no motor has reported a voltage', () => {
    expect(isLeaderBus([{ id: 1 }])).toBe(false);
    expect(isLeaderBus([])).toBe(false);
    expect(isLeaderBus(null)).toBe(false);
  });
});

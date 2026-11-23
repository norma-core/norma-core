import { describe, expect, it } from 'vitest';
import type { st3215 } from '@/api/proto.js';
import { getBusVoltage, resolveBusRole, LEADER_MAX_VOLTAGE_DECIVOLTS } from './bus-role';

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

describe('resolveBusRole', () => {
  it('is leader for a 5 V or 7.4 V supply and follower for 12 V', () => {
    expect(resolveBusRole([motor(50), motor(49)])).toBe('leader');
    expect(resolveBusRole([motor(74)])).toBe('leader');
    expect(resolveBusRole([motor(120), motor(118)])).toBe('follower');
  });

  it('treats one loaded motor dipping low as still a follower', () => {
    expect(resolveBusRole([motor(85), motor(119)])).toBe('follower');
  });

  it('is exclusive at the threshold', () => {
    expect(resolveBusRole([motor(LEADER_MAX_VOLTAGE_DECIVOLTS - 1)])).toBe('leader');
    expect(resolveBusRole([motor(LEADER_MAX_VOLTAGE_DECIVOLTS)])).toBe('follower');
  });

  it('is unresolved until a motor reports a voltage', () => {
    expect(resolveBusRole([{ id: 1 }])).toBeNull();
    expect(resolveBusRole([motor(0)])).toBeNull();
    expect(resolveBusRole([])).toBeNull();
    expect(resolveBusRole(null)).toBeNull();
    expect(resolveBusRole(undefined)).toBeNull();
  });

  it('keeps the previous role when no motor reports a voltage', () => {
    expect(resolveBusRole([{ id: 1 }], 'leader')).toBe('leader');
    expect(resolveBusRole([motor(0)], 'leader')).toBe('leader');
    expect(resolveBusRole([], 'follower')).toBe('follower');
  });

  it('lets a reported voltage override the previous role', () => {
    expect(resolveBusRole([motor(120)], 'leader')).toBe('follower');
    expect(resolveBusRole([motor(50)], 'follower')).toBe('leader');
  });
});

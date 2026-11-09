import { st3215 } from '@/api/proto.js';
import { getMotorVoltage } from './motor-parser';

/**
 * In 0.1 V units. Followers run 12 V servos from 12 V; leaders run 7.4 V servos
 * from 5 V (lerobot and the ElRobot BOM), so anything under 9 V is a leader.
 */
export const LEADER_MAX_VOLTAGE_DECIVOLTS = 90;

/** Highest voltage on the bus (a loaded 12 V servo may dip), or null without a reading. */
export function getBusVoltage(
  motors: st3215.InferenceState.IMotorState[] | null | undefined,
): number | null {
  let max: number | null = null;
  for (const motor of motors ?? []) {
    if (!motor.state) continue;
    const voltage = getMotorVoltage(motor.state);
    if (voltage > 0 && (max === null || voltage > max)) {
      max = voltage;
    }
  }
  return max;
}

export type BusRole = 'leader' | 'follower';

/**
 * Voltage-based, so it works before any mirroring is configured. A frame
 * without a reading says nothing about the role, so `previous` is kept; with
 * no previous role the bus stays unresolved (null) until a motor reports one.
 */
export function resolveBusRole(
  motors: st3215.InferenceState.IMotorState[] | null | undefined,
  previous: BusRole | null = null,
): BusRole | null {
  const voltage = getBusVoltage(motors);
  if (voltage === null) return previous;
  return voltage < LEADER_MAX_VOLTAGE_DECIVOLTS ? 'leader' : 'follower';
}

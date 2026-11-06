import { st3215 } from '@/api/proto.js';
import { getMotorVoltage } from './motor-parser';

/**
 * Supply voltage, in the servo's 0.1 V units, that separates a leader bus from
 * a follower bus. Follower arms (SO101, SO102, ElRobot) run their 12 V servos
 * from a 12 V supply; leader arms run 7.4 V servos from a 5 V supply (lerobot
 * and the ElRobot BOM), so anything under 9 V is a leader.
 */
export const LEADER_MAX_VOLTAGE_DECIVOLTS = 90;

/**
 * Highest present voltage reported by any motor on the bus, in 0.1 V units,
 * or null when no motor has reported one. The maximum is used because a
 * loaded 12 V servo may dip, while a 5 V leader never reads above the limit.
 */
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

/**
 * Whether the bus is powered as a leader arm. Decided by the supply voltage
 * the servos report, so it works before any mirroring has been configured and
 * regardless of which bus the mirroring driver last used as a source.
 *
 * A frame in which no motor reports a voltage (state not yet received, or a
 * failed read cycle) says nothing about the role, so `previous` is kept
 * rather than flipping the bus to a follower and back.
 */
export function isLeaderBus(
  motors: st3215.InferenceState.IMotorState[] | null | undefined,
  previous = false,
): boolean {
  const voltage = getBusVoltage(motors);
  if (voltage === null) return previous;
  return voltage < LEADER_MAX_VOLTAGE_DECIVOLTS;
}

import type { st3215 } from '@/api/proto.js';
import { getMotorPosition } from '../motor-parser';

export type MotorStatus = 'ok' | 'error';

export interface ArmState {
  /** Normalised 0..1 position per motor, indexed by motor id - 1. */
  positions: number[];
  statuses: MotorStatus[];
}

const MAX_ANGLE_STEP = 4095;

/** Where `position` sits in the calibrated range, which may wrap past the encoder end. */
function normalisePosition(position: number, rangeMin: number, rangeMax: number): number {
  if (rangeMin > rangeMax) {
    const totalRange = MAX_ANGLE_STEP - rangeMin + rangeMax;
    if (totalRange === 0) return 0;
    return position >= rangeMin
      ? (position - rangeMin) / totalRange
      : (MAX_ANGLE_STEP - rangeMin + position) / totalRange;
  }
  if (rangeMax === rangeMin) return 0;
  return (position - rangeMin) / (rangeMax - rangeMin);
}

/** The per-motor state the rendered arm consumes, read from a bus frame. */
export function motorsToArmState(
  motors: st3215.InferenceState.IMotorState[] | null | undefined,
): ArmState {
  const positions: number[] = [];
  const statuses: MotorStatus[] = [];
  for (const motor of motors ?? []) {
    if (motor.id == null) continue;
    const position = motor.state ? getMotorPosition(motor.state) : 0;
    positions[motor.id - 1] = normalisePosition(position, motor.rangeMin || 0, motor.rangeMax || MAX_ANGLE_STEP);
    statuses[motor.id - 1] = motor.error ? 'error' : 'ok';
  }
  return { positions, statuses };
}

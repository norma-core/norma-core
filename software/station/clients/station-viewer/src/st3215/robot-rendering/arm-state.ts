import type { st3215 } from '@/api/proto.js';
import { getEffectiveMotorRange, getMotorPosition, MAX_ANGLE_STEP } from '../motor-parser';

export type MotorStatus = 'ok' | 'error';

export interface ArmState {
  /** Normalised 0..1 position per motor, indexed by motor id - 1. */
  positions: number[];
  statuses: MotorStatus[];
}

/** Where `position` sits in a range with `rangeMin !== rangeMax`, which may wrap past the encoder end. */
function normalisePosition(position: number, rangeMin: number, rangeMax: number): number {
  if (rangeMin > rangeMax) {
    const totalRange = MAX_ANGLE_STEP - rangeMin + rangeMax;
    return position >= rangeMin
      ? (position - rangeMin) / totalRange
      : (MAX_ANGLE_STEP - rangeMin + position) / totalRange;
  }
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
    // Collapsed or missing ranges fall back to the full encoder, as the motor table does.
    const { min, max } = getEffectiveMotorRange(motor);
    positions[motor.id - 1] = normalisePosition(position, min, max);
    statuses[motor.id - 1] = motor.error ? 'error' : 'ok';
  }
  return { positions, statuses };
}

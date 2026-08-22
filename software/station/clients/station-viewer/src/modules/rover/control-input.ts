import {
  PWM_OUTPUT_STEERING_CENTER_DEG,
  PWM_OUTPUT_STEERING_RANGE_DEG,
} from '@/modules/pwm-output/commands';

export const KEYBOARD_MAX_DRIVE_CURRENT_A = 10;
export const ROVER_MIN_DRIVE_CURRENT_LIMIT_A = 5;
export const ROVER_DEFAULT_DRIVE_CURRENT_LIMIT_A = 10;
// Stay below the battery protection cutoff observed at 20A.
export const ROVER_MAX_DRIVE_CURRENT_A = 19;

export interface RoverControlTarget {
  currentA: number;
  steeringDeg: number;
}

function applyAxisDeadZone(value: number, deadZone: number): number {
  const clampedValue = Math.max(-1, Math.min(1, value));
  const magnitude = Math.abs(clampedValue);
  if (magnitude <= deadZone) return 0;
  return Math.sign(clampedValue) * ((magnitude - deadZone) / (1 - deadZone));
}

export function normalizeSquareJoystickInput(
  x: number,
  y: number,
  deadZone: number,
): { x: number; y: number } {
  const clampedDeadZone = Math.max(0, Math.min(0.99, deadZone));
  return {
    x: applyAxisDeadZone(x, clampedDeadZone),
    y: applyAxisDeadZone(y, clampedDeadZone),
  };
}

export function mapRoverControlInput(
  x: number,
  y: number,
  maxDriveCurrentA: number,
): RoverControlTarget {
  const normalizedX = Math.max(-1, Math.min(1, x));
  const normalizedY = Math.max(-1, Math.min(1, y));
  const safeMaxDriveCurrentA = Math.max(
    0,
    Math.min(ROVER_MAX_DRIVE_CURRENT_A, maxDriveCurrentA),
  );
  return {
    currentA: normalizedY * safeMaxDriveCurrentA,
    steeringDeg: PWM_OUTPUT_STEERING_CENTER_DEG
      + normalizedX * PWM_OUTPUT_STEERING_RANGE_DEG,
  };
}

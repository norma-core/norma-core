import {
  PWM_OUTPUT_STEERING_CENTER_DEG,
  PWM_OUTPUT_STEERING_RANGE_DEG,
} from '@/devices/pwm-output/commands';

// Requested electrical RPM, matching station-pi (not wheel RPM / ground speed).
// rover-alpha VESC motor configuration: s_pid_min_erpm = 900.
export const ROVER_MIN_DRIVE_RPM = 900;
export const ROVER_DEFAULT_RPM_LIMIT = 4500;
export const ROVER_MAX_RPM_LIMIT = 10_000;

export interface RoverControlTarget {
  rpm: number;
  steeringDeg: number;
}

function applyAxisDeadZone(value: number, deadZone: number): number {
  const clampedValue = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
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
  maxRpm: number,
): RoverControlTarget {
  const normalizedX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
  const normalizedY = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0;
  const safeMaxRpm = Math.max(
    0,
    Math.min(ROVER_MAX_RPM_LIMIT, Number.isFinite(maxRpm) ? maxRpm : 0),
  );
  return {
    rpm: normalizedY === 0 || safeMaxRpm < ROVER_MIN_DRIVE_RPM ? 0
      : Math.sign(normalizedY) * Math.round(ROVER_MIN_DRIVE_RPM
        + Math.abs(normalizedY) * (safeMaxRpm - ROVER_MIN_DRIVE_RPM)),
    steeringDeg: PWM_OUTPUT_STEERING_CENTER_DEG
      + normalizedX * PWM_OUTPUT_STEERING_RANGE_DEG,
  };
}

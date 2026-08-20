import {
  PWM_OUTPUT_STEERING_CENTER_DEG,
  PWM_OUTPUT_STEERING_RANGE_DEG,
} from '@/devices/pwm-output/commands';
import { VESC_TRAMPA_CURRENT_MAX_A } from '@/devices/vesc-trampa/commands';

export const JOYSTICK_MAX_DRIVE_CURRENT_A = VESC_TRAMPA_CURRENT_MAX_A;
export const KEYBOARD_MAX_DRIVE_CURRENT_A = 10;

export interface RoverControlTarget {
  currentA: number;
  steeringDeg: number;
}

export function mapRoverControlInput(
  x: number,
  y: number,
  maxDriveCurrentA: number,
): RoverControlTarget {
  const normalizedX = Math.max(-1, Math.min(1, x));
  const normalizedY = Math.max(-1, Math.min(1, y));
  return {
    currentA: normalizedY * maxDriveCurrentA,
    steeringDeg: PWM_OUTPUT_STEERING_CENTER_DEG
      + normalizedX * PWM_OUTPUT_STEERING_RANGE_DEG,
  };
}

import { setPwmOutputServoPulse } from '@/devices/pwm-output/commands';

export const CAMERA_OUTPUT_ID = 'cameras';
export const CAMERA_MIN_DEG = -71;
export const CAMERA_MAX_DEG = 270;

export function clampCameraAngle(angle: number): number {
  if (!Number.isFinite(angle)) throw new Error('Camera angle must be finite');
  return Math.round(Math.max(CAMERA_MIN_DEG, Math.min(CAMERA_MAX_DEG, angle)));
}

export async function setCameraAngle(angle: number): Promise<void> {
  // Calibrated on the rover: zero is 1000 µs; negative looks forward.
  const pulseUs = Math.round(1000 + clampCameraAngle(angle) * 1000 / 180);
  await setPwmOutputServoPulse(CAMERA_OUTPUT_ID, 9, pulseUs, 20_000, 'forever');
}

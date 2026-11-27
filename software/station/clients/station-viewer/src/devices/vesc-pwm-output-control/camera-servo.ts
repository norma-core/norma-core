import { setPwmOutputServoPulse } from '@/devices/pwm-output/commands';

export const CAMERA_OUTPUT_ID = 'cameras';
export const CAMERA_MIN_DEG = -71;
export const CAMERA_STEP_DEG = 5;
// The calibrated rear endpoint is 270°; 269° is the last complete 5° step.
export const CAMERA_MAX_DEG = 269;
export const CAMERA_STEP_DELAY_MS = 250;

// Last acknowledged request, retained across cockpit unmounts. PWM has no
// position feedback; a fresh viewer session starts at Under wheels.
let lastCameraAngle = CAMERA_MIN_DEG;
let lastCameraCommandAt = -Infinity;
let cameraCommand: Promise<void> | null = null;
export function getLastCameraAngle(): number { return lastCameraAngle; }
export function getLastCameraCommandAt(): number { return lastCameraCommandAt; }
export function getPendingCameraCommand(): Promise<void> | null { return cameraCommand; }

export function clampCameraAngle(angle: number): number {
  if (!Number.isFinite(angle)) throw new Error('Camera angle must be finite');
  const bounded = Math.max(CAMERA_MIN_DEG, Math.min(CAMERA_MAX_DEG, angle));
  return CAMERA_MIN_DEG + Math.round((bounded - CAMERA_MIN_DEG) / CAMERA_STEP_DEG) * CAMERA_STEP_DEG;
}

export function setCameraAngle(angle: number): Promise<void> {
  // Calibrated on the rover: zero is 1000 µs; negative looks forward.
  const pulseUs = Math.round(1000 + clampCameraAngle(angle) * 1000 / 180);
  const request = setPwmOutputServoPulse(CAMERA_OUTPUT_ID, 9, pulseUs, 20_000, 'forever')
    .then(() => {
      lastCameraAngle = clampCameraAngle(angle);
      lastCameraCommandAt = Date.now();
    }).finally(() => { if (cameraCommand === request) cameraCommand = null; });
  cameraCommand = request;
  return request;
}

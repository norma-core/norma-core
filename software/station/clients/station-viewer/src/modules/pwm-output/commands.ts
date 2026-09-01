import { commandManager } from '@/api/commands';
import { pwm_output } from '@/api/proto.js';

export const PWM_OUTPUT_DEFAULT_CHANNEL = 7;
export const PWM_OUTPUT_DEFAULT_PERIOD_US = 20_000;
export const PWM_OUTPUT_DEFAULT_REPEAT = 3;
export const PWM_OUTPUT_DEFAULT_LEFT_PULSE_US = 1100;
export const PWM_OUTPUT_DEFAULT_RIGHT_PULSE_US = 1900;
export const PWM_OUTPUT_STEERING_FULL_MIN_DEG = 0;
export const PWM_OUTPUT_STEERING_CENTER_DEG = 90;
export const PWM_OUTPUT_STEERING_FULL_MAX_DEG = 180;
export const PWM_OUTPUT_STEERING_RANGE_DEG = 40;
export const PWM_OUTPUT_STEERING_MIN_DEG =
  PWM_OUTPUT_STEERING_CENTER_DEG - PWM_OUTPUT_STEERING_RANGE_DEG;
export const PWM_OUTPUT_STEERING_MAX_DEG =
  PWM_OUTPUT_STEERING_CENTER_DEG + PWM_OUTPUT_STEERING_RANGE_DEG;
export const PWM_OUTPUT_DEFAULT_LEFT_STEERING_DEG = PWM_OUTPUT_STEERING_MIN_DEG;
export const PWM_OUTPUT_DEFAULT_RIGHT_STEERING_DEG = PWM_OUTPUT_STEERING_MAX_DEG;
export const PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US = 1000;
export const PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US = 2000;
export const PWM_OUTPUT_MIN_PULSE_US = 500;
export const PWM_OUTPUT_MAX_PULSE_US = 2500;

function positiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.round(value));
}

function uint32(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
}

export function clampPwmOutputPulseWidthUs(
  pulseWidthUs: number,
  periodUs = PWM_OUTPUT_DEFAULT_PERIOD_US,
): number {
  const period = positiveInt(periodUs, PWM_OUTPUT_DEFAULT_PERIOD_US);
  const maxPulse = Math.max(1, Math.min(PWM_OUTPUT_MAX_PULSE_US, period - 1));
  if (!Number.isFinite(pulseWidthUs)) {
    return Math.min(PWM_OUTPUT_MIN_PULSE_US, maxPulse);
  }
  return Math.round(Math.max(1, Math.min(maxPulse, pulseWidthUs)));
}

export function clampPwmOutputSteeringDeg(steeringDeg: number): number {
  if (!Number.isFinite(steeringDeg)) {
    return PWM_OUTPUT_STEERING_CENTER_DEG;
  }
  return Math.round(Math.max(
    PWM_OUTPUT_STEERING_MIN_DEG,
    Math.min(PWM_OUTPUT_STEERING_MAX_DEG, steeringDeg),
  ));
}

export function pwmOutputPulseWidthForSteeringDeg(
  steeringDeg: number,
  minPulseUs = PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
  maxPulseUs = PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
  periodUs = PWM_OUTPUT_DEFAULT_PERIOD_US,
): number {
  const angle = clampPwmOutputSteeringDeg(steeringDeg);
  const minPulse = clampPwmOutputPulseWidthUs(minPulseUs, periodUs);
  const maxPulse = clampPwmOutputPulseWidthUs(maxPulseUs, periodUs);
  const ratio = angle / PWM_OUTPUT_STEERING_FULL_MAX_DEG;
  const pulse = minPulse + (maxPulse - minPulse) * ratio;
  return clampPwmOutputPulseWidthUs(pulse, periodUs);
}

export function pwmOutputSteeringDegForPulseWidth(
  pulseWidthUs: number,
  minPulseUs = PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
  maxPulseUs = PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
): number | null {
  if (!Number.isFinite(pulseWidthUs) || minPulseUs === maxPulseUs) {
    return null;
  }

  const ratio = (pulseWidthUs - minPulseUs) / (maxPulseUs - minPulseUs);
  return clampPwmOutputSteeringDeg(ratio * PWM_OUTPUT_STEERING_FULL_MAX_DEG);
}

export function buildPwmOutputServoWave(
  channel: number,
  pulseWidthUs: number,
  periodUs = PWM_OUTPUT_DEFAULT_PERIOD_US,
  repeat = PWM_OUTPUT_DEFAULT_REPEAT,
): pwm_output.IWaveCommand {
  const period = positiveInt(periodUs, PWM_OUTPUT_DEFAULT_PERIOD_US);
  const pulse = clampPwmOutputPulseWidthUs(pulseWidthUs, period);
  const lowDurationUs = Math.max(1, period - pulse);

  return {
    channel: uint32(channel, PWM_OUTPUT_DEFAULT_CHANNEL),
    repeat: positiveInt(repeat, PWM_OUTPUT_DEFAULT_REPEAT),
    segments: [
      {
        level: pwm_output.WaveLevel.WAVE_LEVEL_HIGH,
        durationUs: pulse,
      },
      {
        level: pwm_output.WaveLevel.WAVE_LEVEL_LOW,
        durationUs: lowDurationUs,
      },
    ],
  };
}

export async function setPwmOutputWave(
  targetOutputId: string,
  wave: pwm_output.IWaveCommand,
): Promise<void> {
  await commandManager.sendPwmOutputCommand({
    targetOutputId,
    wave,
  });
}

export async function setPwmOutputServoPulse(
  targetOutputId: string,
  channel: number,
  pulseWidthUs: number,
  periodUs = PWM_OUTPUT_DEFAULT_PERIOD_US,
  repeat = PWM_OUTPUT_DEFAULT_REPEAT,
): Promise<void> {
  await setPwmOutputWave(
    targetOutputId,
    buildPwmOutputServoWave(channel, pulseWidthUs, periodUs, repeat),
  );
}

export async function setPwmOutputSteeringAngle(
  targetOutputId: string,
  channel: number,
  steeringDeg: number,
  periodUs = PWM_OUTPUT_DEFAULT_PERIOD_US,
  repeat = PWM_OUTPUT_DEFAULT_REPEAT,
  minPulseUs = PWM_OUTPUT_DEFAULT_STEERING_MIN_PULSE_US,
  maxPulseUs = PWM_OUTPUT_DEFAULT_STEERING_MAX_PULSE_US,
): Promise<void> {
  const pulseWidthUs = pwmOutputPulseWidthForSteeringDeg(
    steeringDeg,
    minPulseUs,
    maxPulseUs,
    periodUs,
  );
  await setPwmOutputServoPulse(targetOutputId, channel, pulseWidthUs, periodUs, repeat);
}

export async function disablePwmOutput(targetOutputId: string, channel: number): Promise<void> {
  await commandManager.sendPwmOutputCommand({
    targetOutputId,
    disable: {
      channel: uint32(channel, PWM_OUTPUT_DEFAULT_CHANNEL),
    },
  });
}

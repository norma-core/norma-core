import { commandManager } from '@/api/commands';
import { vesc_trampa } from '@/api/proto.js';

export const VESC_TRAMPA_CURRENT_MIN_A = -15;
export const VESC_TRAMPA_CURRENT_MAX_A = 15;
export const VESC_TRAMPA_CURRENT_HARD_LIMIT_A = 40;
export const VESC_TRAMPA_CURRENT_STEP_A = 0.1;

const COMMAND_SET_CURRENT = 6;

export interface SetVescTrampaCurrentOptions {
  maxAbsCurrentA?: number;
  durationMs?: number;
  finalCurrentA?: number;
}

function int32Payload(commandId: number, value: number): Uint8Array {
  const payload = new Uint8Array(5);
  payload[0] = commandId;
  new DataView(payload.buffer).setInt32(1, value, false);
  return payload;
}

export function clampVescTrampaCurrent(
  currentA: number,
  maxAbsCurrentA = VESC_TRAMPA_CURRENT_MAX_A,
): number {
  if (!Number.isFinite(currentA)) {
    return 0;
  }
  const requestedLimitA = Number.isFinite(maxAbsCurrentA)
    ? Math.abs(maxAbsCurrentA)
    : VESC_TRAMPA_CURRENT_MAX_A;
  const limitA = Math.min(VESC_TRAMPA_CURRENT_HARD_LIMIT_A, requestedLimitA);
  return Math.max(-limitA, Math.min(limitA, currentA));
}

export async function setVescTrampaCurrent(
  boardUuid: Uint8Array,
  currentA: number,
  optionsOrMaxAbsCurrentA: number | SetVescTrampaCurrentOptions = VESC_TRAMPA_CURRENT_MAX_A,
): Promise<void> {
  const options = typeof optionsOrMaxAbsCurrentA === 'number'
    ? { maxAbsCurrentA: optionsOrMaxAbsCurrentA }
    : optionsOrMaxAbsCurrentA;
  const maxAbsCurrentA = options.maxAbsCurrentA ?? VESC_TRAMPA_CURRENT_MAX_A;
  const clampedCurrentA = clampVescTrampaCurrent(currentA, maxAbsCurrentA);
  const clampedFinalCurrentA = clampVescTrampaCurrent(options.finalCurrentA ?? 0, maxAbsCurrentA);
  const durationMs = Number.isFinite(options.durationMs)
    ? Math.max(0, Math.floor(options.durationMs ?? 0))
    : 0;

  await commandManager.sendVescTrampaCommand({
    targetBoardUuid: boardUuid,
    boardCommands: [
      {
        payload: int32Payload(COMMAND_SET_CURRENT, Math.round(clampedCurrentA * 1000)),
        responseExpected: false,
        durationMs,
      },
      ...(durationMs > 0 ? [{
        payload: int32Payload(COMMAND_SET_CURRENT, Math.round(clampedFinalCurrentA * 1000)),
        responseExpected: false,
        durationMs: 0,
      }] : []),
    ],
  });
}

export async function holdVescTrampaMotor(boardUuid: Uint8Array): Promise<void> {
  await commandManager.sendVescTrampaCommand({
    targetBoardUuid: boardUuid,
    motorMode: {
      mode: vesc_trampa.VescTrampaMotorMode.VESC_TRAMPA_MOTOR_MODE_HOLD,
    },
  });
}

/** Same signed COMM_SET_RPM wire payload and terminal zero as station-pi. */
export async function setVescTrampaRpm(
  boardUuid: Uint8Array,
  rpm: number,
  durationMs = 250,
): Promise<void> {
  if (!Number.isFinite(rpm) || !Number.isFinite(durationMs)) throw new Error('Invalid RPM command');
  const target = Math.round(Math.max(-10_000, Math.min(10_000, rpm)));
  const duration = target === 0 ? 0 : Math.max(1, Math.min(2500, Math.floor(durationMs)));
  await commandManager.sendVescTrampaCommand({
    targetBoardUuid: boardUuid,
    boardCommands: [
      { payload: int32Payload(8, target), responseExpected: false, durationMs: duration },
      ...(target !== 0 ? [{ payload: int32Payload(8, 0), responseExpected: false, durationMs: 0 }] : []),
    ],
  });
}

import { commandManager } from '@/api/commands';
import { vesc_trampa } from '@/api/proto.js';

export const VESC_TRAMPA_CURRENT_MIN_A = -15;
export const VESC_TRAMPA_CURRENT_MAX_A = 15;
export const VESC_TRAMPA_CURRENT_HARD_LIMIT_A = 40;
export const VESC_TRAMPA_CURRENT_STEP_A = 0.1;

const COMMAND_SET_CURRENT = 6;

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
  maxAbsCurrentA = VESC_TRAMPA_CURRENT_MAX_A,
): Promise<void> {
  const clampedCurrentA = clampVescTrampaCurrent(currentA, maxAbsCurrentA);
  await commandManager.sendVescTrampaCommand({
    targetBoardUuid: boardUuid,
    boardCommand: {
      payload: int32Payload(COMMAND_SET_CURRENT, Math.round(clampedCurrentA * 1000)),
      responseExpected: false,
    },
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

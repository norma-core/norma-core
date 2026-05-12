const ADDR_MIDPOINT = 0x1F;
export const ADDR_TORQUE_ENABLE = 0x28;
export const ADDR_GOAL_POSITION = 0x2A;
const ADDR_REAL_POSITION = 0x38;
const ADDR_PRESENT_VELOCITY = 0x3A;
const ADDR_PRESENT_VOLTAGE = 0x3E;
const ADDR_PRESENT_TEMPERATURE = 0x3F;
const ADDR_STATUS = 0x40;
const ADDR_PRESENT_CURRENT = 0x45;

const SIGN_BIT_MASK = 0x8000;
const MAX_ANGLE_STEP = 4095;
const BUFFER_SIZE = 0x47;

export function getMotorPosition(data: Uint8Array): number {
  if (data.length < ADDR_REAL_POSITION + 2) {
    return 0;
  }

  const position = data[ADDR_REAL_POSITION] | (data[ADDR_REAL_POSITION + 1] << 8);
  if ((position & SIGN_BIT_MASK) !== 0) {
    const magnitude = position & MAX_ANGLE_STEP;
    return (MAX_ANGLE_STEP + 1 - magnitude) & MAX_ANGLE_STEP;
  } else {
    return position & MAX_ANGLE_STEP;
  }
}

export function getMotorCurrent(data: Uint8Array): number {
  if (data.length < ADDR_PRESENT_CURRENT + 2) {
    return 0;
  }

  return data[ADDR_PRESENT_CURRENT] | (data[ADDR_PRESENT_CURRENT + 1] << 8);
}

export function getMotorVelocity(data: Uint8Array): number {
  if (data.length < ADDR_PRESENT_VELOCITY + 2) {
    return 0;
  }

  return data[ADDR_PRESENT_VELOCITY] | (data[ADDR_PRESENT_VELOCITY + 1] << 8);
}

export function getMotorTemperature(data: Uint8Array): number {
  if (data.length < ADDR_PRESENT_TEMPERATURE + 1) {
    return 0;
  }

  return data[ADDR_PRESENT_TEMPERATURE];
}

export function getMotorVoltage(data: Uint8Array): number {
  if (data.length < ADDR_PRESENT_VOLTAGE + 1) {
    return 0;
  }

  return data[ADDR_PRESENT_VOLTAGE];
}

export function isTorqueEnabled(data: Uint8Array): boolean {
  if (data.length < ADDR_TORQUE_ENABLE + 1) {
    return false;
  }

  return data[ADDR_TORQUE_ENABLE] !== 0;
}

export function isMotorError(data: Uint8Array): boolean {
  if (data.length < BUFFER_SIZE) {
    return true;
  }

  return data[ADDR_STATUS] !== 0;
}

export function getMotorMidpoint(data: Uint8Array): number {
  if (data.length < ADDR_MIDPOINT + 2) {
    return 0;
  }

  return data[ADDR_MIDPOINT] | (data[ADDR_MIDPOINT + 1] << 8);
}

export const ME_REGISTER_LENGTH = 0xa8;

export const ME_OFFSETS = {
  status: 0x00,
  sampleCounter: 0x01,
  softwareRevision: 0x0c,
  productId: 0x0d,
  serial: 0x0e,
  accel: 0x14,
  gyro: 0x20,
  mag: 0x2c,
  linAccel: 0x38,
  gravity: 0x44,
  quat: 0x50, // w, x, y, z, accuracy (5 x f32)
  euler: 0x64, // heading, pitch, roll
  temperature: 0x70,
  humidity: 0x74,
  pressure: 0x78,
  gasResistance: 0x7c,
  iaq: 0x80,
  iaqStatic: 0x84,
  eco2: 0x88,
  bvoc: 0x8c,
  bsecAccuracy: 0x90,
  compTemperature: 0x94,
  compHumidity: 0x98,
  stepCount: 0xa0,
  activity: 0xa4,
} as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ArduinoNiclaSenseMeMainValues {
  accelG: Vec3 | null;
  gyroDps: Vec3 | null;
  magUt: Vec3 | null;
  headingDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  temperatureC: number | null;
  humidityPercent: number | null;
  pressureHpa: number | null;
  iaq: number | null;
  eco2Ppm: number | null;
  stepCount: number | null;
  statusByte: number | null;
  sampleCounter: number | null;
}

function hasRange(bytes: Uint8Array, offset: number, length: number): boolean {
  // For buffers shorter than the full register size, only allow reading offset 0x00 and 0x01 (metadata)
  if (bytes.length < ME_REGISTER_LENGTH && offset > 0x01) {
    return false;
  }
  return offset >= 0 && length >= 0 && offset + length <= bytes.length;
}

function viewFor(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function f32le(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 4) ? viewFor(bytes).getFloat32(offset, true) : null;
}

export function u32le(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 4) ? viewFor(bytes).getUint32(offset, true) : null;
}

export function u8(bytes: Uint8Array, offset: number): number | null {
  return hasRange(bytes, offset, 1) ? bytes[offset] : null;
}

export function vec3(bytes: Uint8Array, offset: number): Vec3 | null {
  const x = f32le(bytes, offset);
  const y = f32le(bytes, offset + 4);
  const z = f32le(bytes, offset + 8);
  if (x === null || y === null || z === null) {
    return null;
  }
  return { x, y, z };
}

export function vecMagnitude(v: Vec3 | null): number | null {
  if (!v) {
    return null;
  }
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function cardinalName(headingDeg: number): string {
  const normalized = ((headingDeg % 360) + 360) % 360;
  return CARDINALS[Math.round(normalized / 45) % 8];
}

export function readArduinoNiclaSenseMeMainValues(
  data: Uint8Array | null | undefined,
): ArduinoNiclaSenseMeMainValues {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array();
  return {
    accelG: vec3(bytes, ME_OFFSETS.accel),
    gyroDps: vec3(bytes, ME_OFFSETS.gyro),
    magUt: vec3(bytes, ME_OFFSETS.mag),
    headingDeg: f32le(bytes, ME_OFFSETS.euler),
    pitchDeg: f32le(bytes, ME_OFFSETS.euler + 4),
    rollDeg: f32le(bytes, ME_OFFSETS.euler + 8),
    temperatureC: f32le(bytes, ME_OFFSETS.temperature),
    humidityPercent: f32le(bytes, ME_OFFSETS.humidity),
    pressureHpa: f32le(bytes, ME_OFFSETS.pressure),
    iaq: f32le(bytes, ME_OFFSETS.iaq),
    eco2Ppm: f32le(bytes, ME_OFFSETS.eco2),
    stepCount: u32le(bytes, ME_OFFSETS.stepCount),
    statusByte: u8(bytes, ME_OFFSETS.status),
    sampleCounter: u8(bytes, ME_OFFSETS.sampleCounter),
  };
}

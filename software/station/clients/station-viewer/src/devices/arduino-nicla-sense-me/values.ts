import { normalizeQuat } from './attitude';

/**
 * Register image published by firmware revision 6 (see
 * device-support/arduino-nicla-sense-me/README.md). The firmware writes only
 * what the sensor hub measured plus the metadata needed to interpret it
 * (full-scale ranges, freshness flags); everything derived — SI scaling,
 * gravity, linear acceleration, roll/pitch/yaw, heading — is computed here
 * and in ./attitude.ts.
 */
export const ME_REVISION = 6;
export const ME_REGISTER_LENGTH = 0x7c;
export const ME_PRODUCT_ID = 0x4d;

export const ME_OFFSETS = {
  status: 0x00, // bit0: BHY2 running
  sampleCounter: 0x01, // u8, wraps
  softwareRevision: 0x0c,
  productId: 0x0d,
  serial: 0x0e, // 6 bytes
  accelRaw: 0x14, // 3 x i16 counts
  gyroRaw: 0x1a, // 3 x i16 counts
  magRaw: 0x20, // 3 x i16 counts
  accelRangeG: 0x26, // u16, full scale in g
  gyroRangeDps: 0x28, // u16, full scale in dps
  magLsbPerUt: 0x2a, // u16
  quat: 0x2c, // w, x, y, z, accuracy (5 x f32)
  temperature: 0x40,
  humidity: 0x44,
  pressure: 0x48,
  gasResistance: 0x4c,
  iaq: 0x50,
  iaqStatic: 0x54,
  eco2: 0x58,
  bvoc: 0x5c,
  compTemperature: 0x60,
  compHumidity: 0x64,
  bsecAccuracy: 0x68, // u8
  calibFlags: 0x69, // u8, see ME_CALIB
  calibMinutesSinceSave: 0x6a, // u8, 255 = no save this session
  stepCount: 0x6c, // u32
  activity: 0x70, // u32 bitfield
  tickCounter: 0x74, // u32, loop ticks since boot
  freshFlags: 0x78, // u16, see ME_FRESH
} as const;

/** Bits of the status register. */
export const ME_STATUS = {
  bhy2Running: 1 << 0,
} as const;

/**
 * Rotation-vector accuracy (rad) at or above which the hub has no magnetic
 * reference at all: the register reads π while the magnetometer is
 * uncalibrated and the quaternion then carries no heading information.
 */
export const ME_HEADING_UNCALIBRATED_RAD = 3.0;

/** Bits of the freshness register: the sensor delivered a new sample this tick. */
export const ME_FRESH = {
  accel: 1 << 0,
  gyro: 1 << 1,
  mag: 1 << 2,
  quat: 1 << 3,
  temperature: 1 << 4,
  humidity: 1 << 5,
  pressure: 1 << 6,
  gas: 1 << 7,
  bsec: 1 << 8,
  steps: 1 << 9,
  activity: 1 << 10,
} as const;

/**
 * Bits of the calibration-store status byte: the firmware persists the hub's
 * accel/gyro/mag calibration profiles in flash and restores them at boot.
 */
export const ME_CALIB = {
  restored: 1 << 0, // a stored profile was written into the hub at boot
  saved: 1 << 1, // at least one profile was saved this session
  storeError: 1 << 2, // flash or hub transfer error since boot
  recordIgnored: 1 << 3, // a stored record did not match this hub firmware
  restoreVerified: 1 << 4, // read-back after the restore matched the stored bytes
  restoreMismatch: 1 << 5, // read-back differed: the hub did not keep the profile
} as const;

/** Full-scale counts of the BHI260AP's 16-bit outputs. */
const ADC_FULL_SCALE = 32768;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ArduinoNiclaSenseMeQuat {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface ArduinoNiclaSenseMeSample {
  revision: number;
  statusByte: number;
  sampleCounter: number;
  tickCounter: number;
  freshFlags: number;

  accelRaw: Vec3;
  gyroRaw: Vec3;
  magRaw: Vec3;
  accelRangeG: number;
  gyroRangeDps: number;
  magLsbPerUt: number;
  /** Scaled from counts; null when the recorded range is unusable. */
  accelG: Vec3 | null;
  gyroDps: Vec3 | null;
  magUt: Vec3 | null;

  /** Unit rotation vector, or null while unpopulated / off-scale. */
  quat: ArduinoNiclaSenseMeQuat | null;
  quatRaw: ArduinoNiclaSenseMeQuat;
  quatAccuracyRad: number;

  temperatureC: number;
  humidityPercent: number;
  pressureHpa: number;
  gasResistanceOhm: number;

  iaq: number;
  iaqStatic: number;
  eco2Ppm: number;
  bvocPpm: number;
  bsecAccuracy: number;
  compTemperatureC: number;
  compHumidityPercent: number;

  stepCount: number;
  activity: number;

  calibFlags: number;
  /** Minutes since the firmware last saved calibration profiles; null = none this session. */
  calibMinutesSinceSave: number | null;
}

// One DataView per buffer instead of one per field read: a full decode runs
// at render rate (~100 Hz over USB), so per-read allocations are measurable
// GC churn.
const viewCache = new WeakMap<Uint8Array, DataView>();

function viewFor(bytes: Uint8Array): DataView {
  let view = viewCache.get(bytes);
  if (!view) {
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    viewCache.set(bytes, view);
  }
  return view;
}

function vec3i16(view: DataView, offset: number): Vec3 {
  return {
    x: view.getInt16(offset, true),
    y: view.getInt16(offset + 2, true),
    z: view.getInt16(offset + 4, true),
  };
}

function scaled(raw: Vec3, factor: number): Vec3 | null {
  if (!Number.isFinite(factor) || factor === 0) {
    return null;
  }
  return { x: raw.x * factor, y: raw.y * factor, z: raw.z * factor };
}

/**
 * Decodes a revision-6 register image. Returns null for a missing or short
 * buffer or for any other firmware revision: there is no legacy path, the
 * layout is the contract with the firmware.
 */
export function decodeArduinoNiclaSenseMe(
  data: Uint8Array | null | undefined,
): ArduinoNiclaSenseMeSample | null {
  if (!(data instanceof Uint8Array) || data.length < ME_REGISTER_LENGTH) {
    return null;
  }
  if (data[ME_OFFSETS.softwareRevision] !== ME_REVISION) {
    return null;
  }
  const view = viewFor(data);
  const f32 = (offset: number) => view.getFloat32(offset, true);

  const accelRaw = vec3i16(view, ME_OFFSETS.accelRaw);
  const gyroRaw = vec3i16(view, ME_OFFSETS.gyroRaw);
  const magRaw = vec3i16(view, ME_OFFSETS.magRaw);
  const accelRangeG = view.getUint16(ME_OFFSETS.accelRangeG, true);
  const gyroRangeDps = view.getUint16(ME_OFFSETS.gyroRangeDps, true);
  const magLsbPerUt = view.getUint16(ME_OFFSETS.magLsbPerUt, true);

  const quatRaw = {
    w: f32(ME_OFFSETS.quat),
    x: f32(ME_OFFSETS.quat + 4),
    y: f32(ME_OFFSETS.quat + 8),
    z: f32(ME_OFFSETS.quat + 12),
  };

  return {
    revision: data[ME_OFFSETS.softwareRevision],
    statusByte: data[ME_OFFSETS.status],
    sampleCounter: data[ME_OFFSETS.sampleCounter],
    tickCounter: view.getUint32(ME_OFFSETS.tickCounter, true),
    freshFlags: view.getUint16(ME_OFFSETS.freshFlags, true),

    accelRaw,
    gyroRaw,
    magRaw,
    accelRangeG,
    gyroRangeDps,
    magLsbPerUt,
    accelG: scaled(accelRaw, accelRangeG / ADC_FULL_SCALE),
    gyroDps: scaled(gyroRaw, gyroRangeDps / ADC_FULL_SCALE),
    magUt: scaled(magRaw, magLsbPerUt === 0 ? 0 : 1 / magLsbPerUt),

    quat: normalizeQuat(quatRaw),
    quatRaw,
    quatAccuracyRad: f32(ME_OFFSETS.quat + 16),

    temperatureC: f32(ME_OFFSETS.temperature),
    humidityPercent: f32(ME_OFFSETS.humidity),
    pressureHpa: f32(ME_OFFSETS.pressure),
    gasResistanceOhm: f32(ME_OFFSETS.gasResistance),

    iaq: f32(ME_OFFSETS.iaq),
    iaqStatic: f32(ME_OFFSETS.iaqStatic),
    eco2Ppm: f32(ME_OFFSETS.eco2),
    bvocPpm: f32(ME_OFFSETS.bvoc),
    bsecAccuracy: data[ME_OFFSETS.bsecAccuracy],
    compTemperatureC: f32(ME_OFFSETS.compTemperature),
    compHumidityPercent: f32(ME_OFFSETS.compHumidity),

    stepCount: view.getUint32(ME_OFFSETS.stepCount, true),
    activity: view.getUint32(ME_OFFSETS.activity, true),

    calibFlags: data[ME_OFFSETS.calibFlags],
    calibMinutesSinceSave: data[ME_OFFSETS.calibMinutesSinceSave] === 255 ? null : data[ME_OFFSETS.calibMinutesSinceSave],
  };
}

export function isFresh(sample: ArduinoNiclaSenseMeSample, flag: number): boolean {
  return (sample.freshFlags & flag) !== 0;
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

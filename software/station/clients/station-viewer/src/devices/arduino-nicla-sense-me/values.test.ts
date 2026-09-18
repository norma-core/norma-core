import { describe, expect, it } from 'vitest';
import {
  ME_CALIB,
  ME_FRESH,
  ME_OFFSETS,
  ME_REGISTER_LENGTH,
  ME_REVISION,
  cardinalName,
  decodeArduinoNiclaSenseMe,
  headingAccuracy,
  isFresh,
  vecMagnitude,
} from './values';

function writeVec3i16(view: DataView, offset: number, x: number, y: number, z: number): void {
  view.setInt16(offset, x, true);
  view.setInt16(offset + 2, y, true);
  view.setInt16(offset + 4, z, true);
}

function buildImage(): Uint8Array {
  const bytes = new Uint8Array(ME_REGISTER_LENGTH);
  const view = new DataView(bytes.buffer);
  bytes[ME_OFFSETS.status] = 0b1;
  bytes[ME_OFFSETS.sampleCounter] = 42;
  bytes[ME_OFFSETS.softwareRevision] = ME_REVISION;
  bytes[ME_OFFSETS.productId] = 0x4d;
  bytes.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff], ME_OFFSETS.serial);
  writeVec3i16(view, ME_OFFSETS.accelRaw, 2048, -4096, 32767);
  writeVec3i16(view, ME_OFFSETS.gyroRaw, 16384, -8192, 0);
  writeVec3i16(view, ME_OFFSETS.magRaw, 800, -160, 16);
  view.setUint16(ME_OFFSETS.accelRangeG, 16, true);
  view.setUint16(ME_OFFSETS.gyroRangeDps, 2000, true);
  view.setUint16(ME_OFFSETS.magLsbPerUt, 16, true);
  // Off-unit quaternion on purpose: the decoder normalizes it.
  view.setFloat32(ME_OFFSETS.quat, 1.2, true);
  view.setFloat32(ME_OFFSETS.quat + 4, 0, true);
  view.setFloat32(ME_OFFSETS.quat + 8, 0, true);
  view.setFloat32(ME_OFFSETS.quat + 12, 0, true);
  view.setFloat32(ME_OFFSETS.quat + 16, 0.25, true);
  view.setFloat32(ME_OFFSETS.temperature, 24.5, true);
  view.setFloat32(ME_OFFSETS.humidity, 41.0, true);
  view.setFloat32(ME_OFFSETS.pressure, 1013.2, true);
  view.setFloat32(ME_OFFSETS.gasResistance, 123456, true);
  view.setFloat32(ME_OFFSETS.iaq, 55.0, true);
  view.setFloat32(ME_OFFSETS.iaqStatic, 57.0, true);
  view.setFloat32(ME_OFFSETS.eco2, 640.0, true);
  view.setFloat32(ME_OFFSETS.bvoc, 0.7, true);
  view.setFloat32(ME_OFFSETS.compTemperature, 23.9, true);
  view.setFloat32(ME_OFFSETS.compHumidity, 42.5, true);
  bytes[ME_OFFSETS.bsecAccuracy] = 3;
  bytes[ME_OFFSETS.calibFlags] = ME_CALIB.restored | ME_CALIB.saved | ME_CALIB.restoreVerified;
  bytes[ME_OFFSETS.calibMinutesSinceSave] = 7;
  view.setUint32(ME_OFFSETS.stepCount, 1234, true);
  view.setUint32(ME_OFFSETS.activity, 0b1000000, true);
  view.setUint32(ME_OFFSETS.tickCounter, 70000, true);
  view.setUint16(ME_OFFSETS.freshFlags, ME_FRESH.accel | ME_FRESH.quat | ME_FRESH.bsec, true);
  return bytes;
}

describe('decodeArduinoNiclaSenseMe', () => {
  it('decodes header, counters and raw counts from a full image', () => {
    const sample = decodeArduinoNiclaSenseMe(buildImage())!;
    expect(sample).not.toBeNull();
    expect(sample.revision).toBe(ME_REVISION);
    expect(sample.statusByte).toBe(1);
    expect(sample.sampleCounter).toBe(42);
    expect(sample.tickCounter).toBe(70000);
    expect(sample.accelRaw).toEqual({ x: 2048, y: -4096, z: 32767 });
    expect(sample.gyroRaw).toEqual({ x: 16384, y: -8192, z: 0 });
    expect(sample.magRaw).toEqual({ x: 800, y: -160, z: 16 });
    expect(sample.accelRangeG).toBe(16);
    expect(sample.gyroRangeDps).toBe(2000);
    expect(sample.magLsbPerUt).toBe(16);
  });

  it('scales counts with the recorded full-scale ranges', () => {
    const sample = decodeArduinoNiclaSenseMe(buildImage())!;
    expect(sample.accelG?.x).toBeCloseTo(1.0); // 2048 / 32768 * 16 g
    expect(sample.accelG?.y).toBeCloseTo(-2.0);
    expect(sample.accelG?.z).toBeCloseTo(16 * 32767 / 32768);
    expect(sample.gyroDps?.x).toBeCloseTo(1000); // 16384 / 32768 * 2000 dps
    expect(sample.gyroDps?.y).toBeCloseTo(-500);
    expect(sample.gyroDps?.z).toBe(0);
    expect(sample.magUt?.x).toBeCloseTo(50); // 800 / 16 µT
    expect(sample.magUt?.y).toBeCloseTo(-10);
    expect(sample.magUt?.z).toBeCloseTo(1);
  });

  it('exposes the normalized quaternion and its raw form', () => {
    const sample = decodeArduinoNiclaSenseMe(buildImage())!;
    expect(sample.quat).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    expect(sample.quatRaw.w).toBeCloseTo(1.2);
    expect(sample.quatAccuracyRad).toBeCloseTo(0.25);
  });

  it('nulls the quaternion when the rotation vector is unpopulated', () => {
    const image = buildImage();
    new DataView(image.buffer).setFloat32(ME_OFFSETS.quat, 0, true);
    const sample = decodeArduinoNiclaSenseMe(image)!;
    expect(sample.quat).toBeNull();
    expect(sample.quatRaw).toEqual({ w: 0, x: 0, y: 0, z: 0 });
    expect(sample.accelG?.x).toBeCloseTo(1.0);
  });

  it('decodes environment, BSEC and activity fields', () => {
    const sample = decodeArduinoNiclaSenseMe(buildImage())!;
    expect(sample.temperatureC).toBeCloseTo(24.5);
    expect(sample.humidityPercent).toBeCloseTo(41.0);
    expect(sample.pressureHpa).toBeCloseTo(1013.2);
    expect(sample.gasResistanceOhm).toBeCloseTo(123456);
    expect(sample.iaq).toBeCloseTo(55.0);
    expect(sample.iaqStatic).toBeCloseTo(57.0);
    expect(sample.eco2Ppm).toBeCloseTo(640.0);
    expect(sample.bvocPpm).toBeCloseTo(0.7);
    expect(sample.bsecAccuracy).toBe(3);
    expect(sample.compTemperatureC).toBeCloseTo(23.9);
    expect(sample.compHumidityPercent).toBeCloseTo(42.5);
    expect(sample.stepCount).toBe(1234);
    expect(sample.activity).toBe(0b1000000);
  });

  it('nulls scaled vectors when a range register is zero', () => {
    const image = buildImage();
    const view = new DataView(image.buffer);
    view.setUint16(ME_OFFSETS.accelRangeG, 0, true);
    view.setUint16(ME_OFFSETS.magLsbPerUt, 0, true);
    const sample = decodeArduinoNiclaSenseMe(image)!;
    expect(sample.accelG).toBeNull();
    expect(sample.magUt).toBeNull();
    expect(sample.gyroDps?.x).toBeCloseTo(1000);
    expect(sample.accelRaw.x).toBe(2048);
  });

  it('decodes the calibration-store status bytes', () => {
    const sample = decodeArduinoNiclaSenseMe(buildImage())!;
    expect(sample.calibFlags).toBe(ME_CALIB.restored | ME_CALIB.saved | ME_CALIB.restoreVerified);
    expect(sample.calibFlags & ME_CALIB.restoreMismatch).toBe(0);
    expect(sample.calibMinutesSinceSave).toBe(7);
    const never = buildImage();
    never[ME_OFFSETS.calibFlags] = 0;
    never[ME_OFFSETS.calibMinutesSinceSave] = 255;
    const cold = decodeArduinoNiclaSenseMe(never)!;
    expect(cold.calibFlags).toBe(0);
    expect(cold.calibMinutesSinceSave).toBeNull();
  });

  it('reports per-sensor freshness flags', () => {
    const sample = decodeArduinoNiclaSenseMe(buildImage())!;
    expect(isFresh(sample, ME_FRESH.accel)).toBe(true);
    expect(isFresh(sample, ME_FRESH.quat)).toBe(true);
    expect(isFresh(sample, ME_FRESH.bsec)).toBe(true);
    expect(isFresh(sample, ME_FRESH.gyro)).toBe(false);
    expect(isFresh(sample, ME_FRESH.temperature)).toBe(false);
  });

  it('returns null for missing, short or foreign-revision buffers', () => {
    expect(decodeArduinoNiclaSenseMe(undefined)).toBeNull();
    expect(decodeArduinoNiclaSenseMe(null)).toBeNull();
    expect(decodeArduinoNiclaSenseMe(new Uint8Array(ME_REGISTER_LENGTH - 1))).toBeNull();
    const legacy = new Uint8Array(0xa8);
    legacy[ME_OFFSETS.softwareRevision] = 5;
    expect(decodeArduinoNiclaSenseMe(legacy)).toBeNull();
  });

  it('accepts a longer buffer that starts with a rev-6 image', () => {
    const padded = new Uint8Array(ME_REGISTER_LENGTH + 8);
    padded.set(buildImage());
    expect(decodeArduinoNiclaSenseMe(padded)?.stepCount).toBe(1234);
  });
});

describe('helpers', () => {
  it('computes vector magnitude', () => {
    expect(vecMagnitude({ x: 3, y: 4, z: 0 })).toBeCloseTo(5);
    expect(vecMagnitude(null)).toBeNull();
  });

  it('names cardinal directions', () => {
    expect(cardinalName(0)).toBe('N');
    expect(cardinalName(63)).toBe('NE');
    expect(cardinalName(180)).toBe('S');
    expect(cardinalName(359)).toBe('N');
  });
});

describe('headingAccuracy', () => {
  it('is unknown while the register is zero or not finite', () => {
    expect(headingAccuracy(0)).toBeNull();
    expect(headingAccuracy(NaN)).toBeNull();
    expect(headingAccuracy(Infinity)).toBeNull();
  });

  it('rates the hub\'s quantized levels: calibrated good, early fair, uncalibrated poor', () => {
    expect(headingAccuracy(0.436)).toMatchObject({ level: 'good', uncalibrated: false });
    expect(headingAccuracy(0.525)).toMatchObject({ level: 'good', uncalibrated: false });
    expect(headingAccuracy(1.03)).toMatchObject({ level: 'fair', uncalibrated: false });
    expect(headingAccuracy(Math.PI)).toMatchObject({ level: 'poor', uncalibrated: true });
    expect(headingAccuracy(0.2)?.deg).toBeCloseTo(11.46, 1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ME_OFFSETS,
  ME_REGISTER_LENGTH,
  cardinalName,
  readArduinoNiclaSenseMeMainValues,
  vecMagnitude,
} from './values';

function buildImage(): Uint8Array {
  const bytes = new Uint8Array(ME_REGISTER_LENGTH);
  const view = new DataView(bytes.buffer);
  bytes[ME_OFFSETS.status] = 0b11;
  bytes[ME_OFFSETS.sampleCounter] = 42;
  view.setFloat32(ME_OFFSETS.accel, 0.1, true);
  view.setFloat32(ME_OFFSETS.accel + 4, -0.2, true);
  view.setFloat32(ME_OFFSETS.accel + 8, 0.98, true);
  view.setFloat32(ME_OFFSETS.gyro, 1.5, true);
  view.setFloat32(ME_OFFSETS.gyro + 4, -2.5, true);
  view.setFloat32(ME_OFFSETS.gyro + 8, 0.5, true);
  view.setFloat32(ME_OFFSETS.mag, 21, true);
  view.setFloat32(ME_OFFSETS.mag + 4, -7, true);
  view.setFloat32(ME_OFFSETS.mag + 8, -43, true);
  view.setFloat32(ME_OFFSETS.euler, 63, true);
  view.setFloat32(ME_OFFSETS.euler + 4, -2.1, true);
  view.setFloat32(ME_OFFSETS.euler + 8, 0.8, true);
  view.setFloat32(ME_OFFSETS.temperature, 24.5, true);
  view.setFloat32(ME_OFFSETS.humidity, 41.0, true);
  view.setFloat32(ME_OFFSETS.pressure, 1013.2, true);
  view.setFloat32(ME_OFFSETS.iaq, 55.0, true);
  view.setFloat32(ME_OFFSETS.eco2, 640.0, true);
  view.setUint32(ME_OFFSETS.stepCount, 1234, true);
  return bytes;
}

describe('readArduinoNiclaSenseMeMainValues', () => {
  it('reads all mapped values from a full image', () => {
    const values = readArduinoNiclaSenseMeMainValues(buildImage());
    expect(values.statusByte).toBe(3);
    expect(values.sampleCounter).toBe(42);
    expect(values.accelG?.x).toBeCloseTo(0.1);
    expect(values.accelG?.y).toBeCloseTo(-0.2);
    expect(values.accelG?.z).toBeCloseTo(0.98);
    expect(values.gyroDps?.y).toBeCloseTo(-2.5);
    expect(values.magUt?.z).toBeCloseTo(-43);
    expect(values.headingDeg).toBeCloseTo(63);
    expect(values.pitchDeg).toBeCloseTo(-2.1);
    expect(values.rollDeg).toBeCloseTo(0.8);
    expect(values.temperatureC).toBeCloseTo(24.5);
    expect(values.humidityPercent).toBeCloseTo(41.0);
    expect(values.pressureHpa).toBeCloseTo(1013.2);
    expect(values.iaq).toBeCloseTo(55.0);
    expect(values.eco2Ppm).toBeCloseTo(640.0);
    expect(values.stepCount).toBe(1234);
  });

  it('returns nulls for short or missing buffers', () => {
    const empty = readArduinoNiclaSenseMeMainValues(undefined);
    expect(empty.accelG).toBeNull();
    expect(empty.temperatureC).toBeNull();

    const short = readArduinoNiclaSenseMeMainValues(new Uint8Array(0x20));
    expect(short.statusByte).toBe(0);
    expect(short.accelG).toBeNull();
    expect(short.stepCount).toBeNull();
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

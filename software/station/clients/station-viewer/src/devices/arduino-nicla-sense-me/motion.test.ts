import { describe, expect, it } from 'vitest';
import { MOTION_SAMPLE_SIZE, parseMotionBatch } from './motion';

function buildBatch(
  count: number,
  dropped: number,
  firstMillis: number,
  samples: { dt: number; a: [number, number, number]; g: [number, number, number]; m: [number, number, number] }[],
): Uint8Array {
  const bytes = new Uint8Array(8 + samples.length * MOTION_SAMPLE_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, count, true);
  view.setUint16(2, dropped, true);
  view.setUint32(4, firstMillis, true);
  samples.forEach((sample, i) => {
    const base = 8 + i * MOTION_SAMPLE_SIZE;
    bytes[base] = sample.dt;
    view.setInt16(base + 1, sample.a[0], true);
    view.setInt16(base + 3, sample.a[1], true);
    view.setInt16(base + 5, sample.a[2], true);
    view.setInt16(base + 7, sample.g[0], true);
    view.setInt16(base + 9, sample.g[1], true);
    view.setInt16(base + 11, sample.g[2], true);
    view.setInt16(base + 13, sample.m[0], true);
    view.setInt16(base + 15, sample.m[1], true);
    view.setInt16(base + 17, sample.m[2], true);
  });
  return bytes;
}

describe('parseMotionBatch', () => {
  it('parses a 2-sample batch into SI units', () => {
    const bytes = buildBatch(2, 3, 123456, [
      { dt: 10, a: [4096, 0, 0], g: [0, -164, 0], m: [0, 0, 800] },
      { dt: 10, a: [0, 4096, 0], g: [164, 0, 0], m: [800, 0, 0] },
    ]);
    const batch = parseMotionBatch(bytes);
    expect(batch).not.toBeNull();
    expect(batch?.count).toBe(2);
    expect(batch?.dropped).toBe(3);
    expect(batch?.firstMillis).toBe(123456);
    expect(batch?.accel).toHaveLength(2);
    expect(batch?.accel[0].x).toBeCloseTo(1.0, 5);
    expect(batch?.gyro[0].y).toBeCloseTo(-10.0, 1);
    expect(batch?.mag[0].z).toBeCloseTo(50.0, 5);
    expect(batch?.accel[1].y).toBeCloseTo(1.0, 5);
    expect(batch?.gyro[1].x).toBeCloseTo(10.0, 1);
    expect(batch?.mag[1].x).toBeCloseTo(50.0, 5);
  });

  it('returns a batch with empty arrays when count is 0', () => {
    const bytes = buildBatch(0, 0, 0, []);
    const batch = parseMotionBatch(bytes);
    expect(batch).not.toBeNull();
    expect(batch?.count).toBe(0);
    expect(batch?.accel).toEqual([]);
    expect(batch?.gyro).toEqual([]);
    expect(batch?.mag).toEqual([]);
  });

  it('returns null for non-Uint8Array input', () => {
    expect(parseMotionBatch(null)).toBeNull();
    expect(parseMotionBatch(undefined)).toBeNull();
    // @ts-expect-error deliberately wrong type for the negative test
    expect(parseMotionBatch([1, 2, 3])).toBeNull();
  });

  it('returns null when the buffer is shorter than the 8-byte header', () => {
    expect(parseMotionBatch(new Uint8Array(7))).toBeNull();
  });

  it('returns null when the buffer length does not match the declared count', () => {
    const bytes = buildBatch(2, 0, 0, [
      { dt: 10, a: [0, 0, 0], g: [0, 0, 0], m: [0, 0, 0] },
    ]);
    expect(parseMotionBatch(bytes)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { Vec3History, buildAxisPolylines, historyFor } from './sparkline';

describe('Vec3History', () => {
  it('appends samples and exposes them in order', () => {
    const history = new Vec3History(3);
    history.push('a', { x: 1, y: 2, z: 3 });
    history.push('b', { x: 4, y: 5, z: 6 });
    expect(history.get().map((s) => s.x)).toEqual([1, 4]);
  });

  it('dedupes consecutive pushes with the same key', () => {
    const history = new Vec3History(3);
    history.push('a', { x: 1, y: 1, z: 1 });
    history.push('a', { x: 9, y: 9, z: 9 });
    expect(history.get()).toHaveLength(1);
    expect(history.get()[0].x).toBe(1);
  });

  it('drops the oldest sample beyond capacity', () => {
    const history = new Vec3History(2);
    history.push('a', { x: 1, y: 0, z: 0 });
    history.push('b', { x: 2, y: 0, z: 0 });
    history.push('c', { x: 3, y: 0, z: 0 });
    expect(history.get().map((s) => s.x)).toEqual([2, 3]);
  });

  it('ignores null samples without consuming the key', () => {
    const history = new Vec3History(3);
    history.push('a', null);
    expect(history.get()).toHaveLength(0);
    history.push('a', { x: 1, y: 1, z: 1 });
    expect(history.get()).toHaveLength(1);
  });
});

describe('historyFor', () => {
  it('returns the same store for the same key and distinct stores otherwise', () => {
    const one = historyFor('device-1');
    const same = historyFor('device-1');
    const other = historyFor('device-2');
    expect(same).toBe(one);
    expect(other).not.toBe(one);
  });
});

describe('buildAxisPolylines', () => {
  it('returns empty polylines for no samples', () => {
    const result = buildAxisPolylines([], 100, 30, 2, 60);
    expect(result.x).toBe('');
    expect(result.y).toBe('');
    expect(result.z).toBe('');
    expect(result.zeroY).toBeNull();
  });

  it('maps values into the viewbox using the minimum span when data is flat', () => {
    // Flat signal at 0 for all axes: span clamps to minSpan=2 → range [-1, 1].
    // 0 maps to the vertical middle of a 30px-high box.
    const samples = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ];
    const result = buildAxisPolylines(samples, 118, 30, 2, 60);
    // Two samples in a 60-capacity buffer: x-step is width/(capacity-1) = 2.
    expect(result.x).toBe('0,15 2,15');
    expect(result.zeroY).toBe(15);
  });

  it('scales to the data range when it exceeds the minimum span', () => {
    // x axis spans -5..5 (span 10 > minSpan 2); y/z stay flat at 0.
    const samples = [
      { x: -5, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ];
    const result = buildAxisPolylines(samples, 118, 30, 2, 60);
    // Range [-5, 5]: -5 → bottom (30), +5 → top (0), 0 → middle (15).
    expect(result.x).toBe('0,30 2,0');
    expect(result.y).toBe('0,15 2,15');
    expect(result.zeroY).toBe(15);
  });

  it('omits the zero line when zero is outside the data range', () => {
    const samples = [
      { x: 10, y: 12, z: 11 },
      { x: 14, y: 12, z: 13 },
    ];
    const result = buildAxisPolylines(samples, 118, 30, 2, 60);
    expect(result.zeroY).toBeNull();
  });
});

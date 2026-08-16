import { describe, expect, it } from 'vitest';
import { Vec3History, buildAxisPolylines, buildDecimatedAxisPolylines, historyFor } from './sparkline';

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

  it('pushBatch appends all samples and dedupes repeated batch keys', () => {
    const history = new Vec3History(10);
    history.pushBatch('batch-1', [
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]);
    history.pushBatch('batch-1', [{ x: 99, y: 0, z: 0 }]);
    expect(history.get().map((s) => s.x)).toEqual([1, 2]);
    history.pushBatch('batch-2', [{ x: 3, y: 0, z: 0 }]);
    expect(history.get().map((s) => s.x)).toEqual([1, 2, 3]);
  });

  it('pushBatch trims to capacity, keeping the newest samples', () => {
    const history = new Vec3History(3);
    history.pushBatch('b1', [
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]);
    history.pushBatch('b2', [
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
    expect(history.get().map((s) => s.x)).toEqual([2, 3, 4]);
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

  it('honors the capacity passed on creation and ignores later calls', () => {
    const store = historyFor('cap-test', 5);
    for (let i = 0; i < 6; i++) {
      store.push(`k${i}`, { x: i, y: 0, z: 0 });
    }
    expect(store.get()).toHaveLength(5);
    expect(store.get().map((s) => s.x)).toEqual([1, 2, 3, 4, 5]);

    const same = historyFor('cap-test', 100);
    expect(same).toBe(store);
    expect(same.get()).toHaveLength(5);
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

describe('buildDecimatedAxisPolylines', () => {
  it('emits a min/max point pair per bucket over the shared axis range', () => {
    // Shared range across all axes/samples: x in {0,10,-5,5}, y/z all 0 → [-5, 10], span 15.
    // Bucket 0 = samples[0,1] (x: 0,10) → min 0 @ x=0, max 10 @ x=25.
    // Bucket 1 = samples[2,3] (x: -5,5) → min -5 @ x=50, max 5 @ x=75.
    const samples = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: -5, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ];
    const result = buildDecimatedAxisPolylines(samples, 100, 30, 2, 2);
    expect(result.x).toBe('0,20 25,0 50,30 75,10');
    expect(result.y).toBe('0,20 25,20 50,20 75,20');
    expect(result.z).toBe('0,20 25,20 50,20 75,20');
    expect(result.zeroY).toBe(20);
  });

  it('falls back to buildAxisPolylines when samples fit within the bucket count', () => {
    const samples = [
      { x: -5, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ];
    const decimated = buildDecimatedAxisPolylines(samples, 118, 30, 2, 5);
    const fallback = buildAxisPolylines(samples, 118, 30, 2, 5);
    expect(decimated).toEqual(fallback);
  });
});

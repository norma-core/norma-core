import type { Vec3 } from './values';

export const SPARKLINE_CAPACITY = 60;

/**
 * Rolling per-device history of 3-axis samples feeding the live widget's
 * sparklines. Samples arrive one per station poll (~1 Hz); pushes are deduped
 * by an envelope-stamp key so React re-renders never duplicate a sample.
 */
export class Vec3History {
  private samples: Vec3[] = [];
  private lastKey: string | null = null;

  constructor(private capacity = SPARKLINE_CAPACITY) {}

  push(key: string, sample: Vec3 | null): void {
    if (!sample) {
      return;
    }
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    this.samples.push(sample);
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
  }

  get(): readonly Vec3[] {
    return this.samples;
  }
}

const stores = new Map<string, Vec3History>();

/**
 * Module-level store so graph history survives component unmounts (e.g.
 * switching to the History page and back).
 */
export function historyFor(storeKey: string): Vec3History {
  let store = stores.get(storeKey);
  if (!store) {
    store = new Vec3History();
    stores.set(storeKey, store);
  }
  return store;
}

export interface AxisPolylines {
  x: string;
  y: string;
  z: string;
  zeroY: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Builds SVG polyline point strings for the three axes over a shared value
 * range. The range auto-scales to the window's min/max but never shrinks
 * below `minSpan` (so flat signals do not zoom into noise), and is centered
 * on the data. Points advance left-to-right with a fixed step derived from
 * `capacity`, so a partially filled buffer grows from the left edge.
 */
export function buildAxisPolylines(
  samples: readonly Vec3[],
  width: number,
  height: number,
  minSpan: number,
  capacity = SPARKLINE_CAPACITY,
): AxisPolylines {
  if (samples.length === 0) {
    return { x: '', y: '', z: '', zeroY: null };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    for (const value of [sample.x, sample.y, sample.z]) {
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { x: '', y: '', z: '', zeroY: null };
  }

  const center = (min + max) / 2;
  const span = Math.max(max - min, minSpan);
  const lo = center - span / 2;
  const step = width / (capacity - 1);
  const toY = (value: number) => height - ((value - lo) / span) * height;

  const points = (axis: keyof Vec3) =>
    samples
      .map((sample, index) => `${round2(index * step)},${round2(toY(sample[axis]))}`)
      .join(' ');

  const zeroInRange = lo <= 0 && 0 <= lo + span;
  return {
    x: points('x'),
    y: points('y'),
    z: points('z'),
    zeroY: zeroInRange ? round2(toY(0)) : null,
  };
}

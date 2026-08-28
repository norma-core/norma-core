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
    this.trim();
  }


  get(): readonly Vec3[] {
    return this.samples;
  }

  private trim(): void {
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
  }
}

const stores = new Map<string, Vec3History>();

/**
 * Module-level store so graph history survives component unmounts (e.g.
 * switching to the History page and back). `capacity` only applies when the
 * store is created; later calls with a different capacity are ignored.
 */
export function historyFor(storeKey: string, capacity = SPARKLINE_CAPACITY): Vec3History {
  let store = stores.get(storeKey);
  if (!store) {
    store = new Vec3History(capacity);
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

interface AxisRange {
  lo: number;
  span: number;
}

/**
 * Shared value-range computation for the axis-polyline builders below: finds
 * the min/max across all three axes and all samples, then centers a span
 * that never shrinks below `minSpan` (so flat signals do not zoom into
 * noise). Returns null when there is no finite data to plot.
 */
function computeAxisRange(samples: readonly Vec3[], minSpan: number): AxisRange | null {
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
    return null;
  }

  const center = (min + max) / 2;
  const span = Math.max(max - min, minSpan);
  return { lo: center - span / 2, span };
}

function zeroY(range: AxisRange, toY: (value: number) => number): number | null {
  const zeroInRange = range.lo <= 0 && 0 <= range.lo + range.span;
  return zeroInRange ? round2(toY(0)) : null;
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

  const range = computeAxisRange(samples, minSpan);
  if (!range) {
    return { x: '', y: '', z: '', zeroY: null };
  }
  const { lo, span } = range;
  const step = width / (capacity - 1);
  const toY = (value: number) => height - ((value - lo) / span) * height;

  const points = (axis: keyof Vec3) =>
    samples
      .map((sample, index) => `${round2(index * step)},${round2(toY(sample[axis]))}`)
      .join(' ');

  return {
    x: points('x'),
    y: points('y'),
    z: points('z'),
    zeroY: zeroY(range, toY),
  };
}

/**
 * Decimated variant of `buildAxisPolylines` for high-rate data (e.g. 100Hz
 * motion batches) that would otherwise produce far more points than pixels.
 * Samples are split into `buckets` contiguous groups; each bucket
 * contributes two points per axis — its min then its max — at
 * `x = b*step` and `x = b*step + step/2` where `step = width / buckets`.
 * Empty buckets are skipped. Falls back to `buildAxisPolylines` (with
 * `capacity = buckets`) when there are already few enough samples to plot
 * directly.
 */
export function buildDecimatedAxisPolylines(
  samples: readonly Vec3[],
  width: number,
  height: number,
  minSpan: number,
  buckets: number,
): AxisPolylines {
  if (samples.length <= buckets) {
    return buildAxisPolylines(samples, width, height, minSpan, buckets);
  }

  const range = computeAxisRange(samples, minSpan);
  if (!range) {
    return { x: '', y: '', z: '', zeroY: null };
  }
  const { lo, span } = range;
  const step = width / buckets;
  const toY = (value: number) => height - ((value - lo) / span) * height;

  const points = (axis: keyof Vec3) => {
    const parts: string[] = [];
    for (let b = 0; b < buckets; b++) {
      const start = Math.floor((b * samples.length) / buckets);
      const end = Math.floor(((b + 1) * samples.length) / buckets);
      if (end <= start) {
        continue;
      }
      let bucketMin = Number.POSITIVE_INFINITY;
      let bucketMax = Number.NEGATIVE_INFINITY;
      for (let i = start; i < end; i++) {
        const value = samples[i][axis];
        if (Number.isFinite(value)) {
          bucketMin = Math.min(bucketMin, value);
          bucketMax = Math.max(bucketMax, value);
        }
      }
      if (!Number.isFinite(bucketMin) || !Number.isFinite(bucketMax)) {
        continue;
      }
      const x0 = round2(b * step);
      const x1 = round2(b * step + step / 2);
      parts.push(`${x0},${round2(toY(bucketMin))}`);
      parts.push(`${x1},${round2(toY(bucketMax))}`);
    }
    return parts.join(' ');
  };

  return {
    x: points('x'),
    y: points('y'),
    z: points('z'),
    zeroY: zeroY(range, toY),
  };
}

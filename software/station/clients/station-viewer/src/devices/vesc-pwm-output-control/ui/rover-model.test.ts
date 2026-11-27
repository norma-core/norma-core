// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { RoverMotion } from '../rover-motion';
import { renderRoverModel } from './rover-model';

function arrow(field: 'accel' | 'gyro', magnitude: number) {
  const motion: RoverMotion = {
    heading: 0, pitch: 0, roll: 0,
    accel: { x: 0, y: 0, z: 0 }, gyro: { x: 0, y: 0, z: 0 },
  };
  motion[field].x = magnitude;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.innerHTML = renderRoverModel(motion, 'test');
  const line = svg.querySelector('line[marker-end]');
  if (!line) return null;
  const dx = Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'));
  const dy = Number(line.getAttribute('y2')) - Number(line.getAttribute('y1'));
  return { dx, dy, length: Math.hypot(dx, dy) };
}

describe.each([['accel', 1], ['gyro', 90]] as const)('%s vector magnitude', (field, reference) => {
  it('hides stationary noise instead of normalizing it into a full-length arrow', () => {
    expect(arrow(field, 0)).toBeNull();
    expect(arrow(field, reference * 0.0001)).toBeNull();
  });
  it('grows with magnitude, compresses large changes and caps length', () => {
    const small = arrow(field, reference * 0.05)!;
    const medium = arrow(field, reference * 0.2)!;
    const large = arrow(field, reference)!;
    expect(small.length).toBeGreaterThan(0);
    expect(small.length).toBeLessThan(medium.length);
    expect(medium.length).toBeLessThan(large.length);
    expect(medium.length / small.length).toBeLessThan(4);
    expect(arrow(field, reference * 100)!.length).toBeCloseTo(large.length);
  });
  it('preserves direction and magnitude when the sign reverses', () => {
    const positive = arrow(field, reference * 0.2)!;
    const negative = arrow(field, -reference * 0.2)!;
    expect(negative.dx).toBeCloseTo(-positive.dx);
    expect(negative.dy).toBeCloseTo(-positive.dy);
    expect(negative.length).toBeCloseTo(positive.length);
  });
});

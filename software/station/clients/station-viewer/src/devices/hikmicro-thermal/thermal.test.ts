import { expect, it } from 'vitest';
import { renderThermalFrame } from './thermal';

it('rotates only EA2976465 counterclockwise while preserving pixels and temperature statistics', () => {
  const payload = new Uint8Array(256 * 192 * 2);
  const samples = new DataView(payload.buffer);
  for (let i = 0; i < payload.length / 2; i++) samples.setUint16(i * 2, i, true);
  const frame = { payload };
  const original = renderThermalFrame({}, frame, 'silver');
  const rotated = renderThermalFrame({ deviceInfo: { usb: { serialNumber: 'EA2976465' } } }, frame, 'silver');
  expect([rotated.width, rotated.height]).toEqual([original.height, original.width]);
  // Asymmetric points catch a reversed rotation, reflection, or wrong row stride.
  for (const [x, y] of [[0, 0], [255, 0], [0, 191], [255, 191], [43, 87]]) {
    const source = (y * original.width + x) * 4;
    const target = ((original.width - 1 - x) * rotated.width + y) * 4;
    expect(rotated.rgba.slice(target, target + 4)).toEqual(original.rgba.slice(source, source + 4));
  }
  expect([rotated.centerRaw, rotated.minRaw, rotated.maxRaw]).toEqual([original.centerRaw, original.minRaw, original.maxRaw]);
  const otherCamera = renderThermalFrame({ deviceInfo: { usb: { serialNumber: 'EA2976466' } } }, frame, 'silver');
  expect(otherCamera).toEqual(original);
});

// Guard against deriving contours from palette colors or rotating only the image.
it('keeps thermal contours palette-independent and aligned with the mounted camera', () => {
  const payload = new Uint8Array(256 * 192 * 2);
  const samples = new DataView(payload.buffer);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) samples.setUint16((y * 256 + x) * 2, 1000 + x * 8, true);
  const original = renderThermalFrame({}, { payload }, 'arctic', true);
  expect(original.contours?.length).toBeGreaterThan(0);
  expect(renderThermalFrame({}, { payload }, 'silver', true).contours).toEqual(original.contours);
  expect(renderThermalFrame({}, { payload }, 'arctic').contours).toBeUndefined();
  const rotated = renderThermalFrame({ deviceInfo: { usb: { serialNumber: 'EA2976465' } } }, { payload }, 'arctic', true);
  for (let i = 0; i < original.contours!.length; i += 2) {
    const x = original.contours![i], y = original.contours![i + 1];
    expect(Number.isFinite(x) && x >= 0 && x <= 256).toBe(true);
    expect(Number.isFinite(y) && y >= 0 && y <= 192).toBe(true);
    expect(rotated.contours![i]).toBeCloseTo(y, 3);
    expect(rotated.contours![i + 1]).toBeCloseTo(256 - x, 3);
  }
  // A horizontal temperature gradient must produce vertical isolines.
  for (let i = 0; i < original.contours!.length; i += 4) expect(original.contours![i]).toBeCloseTo(original.contours![i + 2], 3);
});

it('does not invent contours in a uniform thermal scene', () => {
  const payload = new Uint8Array(256 * 192 * 2).fill(32);
  expect(renderThermalFrame({}, { payload }, 'arctic', true).contours).toHaveLength(0);
});

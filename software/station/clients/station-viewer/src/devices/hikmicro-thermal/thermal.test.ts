import { expect, it } from 'vitest';
import { renderThermalFrame } from './thermal';

it('keeps every camera in native orientation, including the formerly rotated serial', () => {
  const payload = new Uint8Array(256 * 192 * 2);
  const samples = new DataView(payload.buffer);
  for (let i = 0; i < payload.length / 2; i++) samples.setUint16(i * 2, i, true);
  const frame = { payload };
  const original = renderThermalFrame({}, frame, 'silver');
  expect([original.width, original.height]).toEqual([256, 192]);
  for (const serialNumber of ['EA2976465', 'EA2976466']) {
    expect(renderThermalFrame({ deviceInfo: { usb: { serialNumber } } }, frame, 'silver')).toEqual(original);
  }
});

// Guard against deriving contours from palette colors or rotating only the image.
it('keeps thermal contours palette-independent and aligned in native sensor orientation', () => {
  const payload = new Uint8Array(256 * 192 * 2);
  const samples = new DataView(payload.buffer);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) samples.setUint16((y * 256 + x) * 2, 1000 + x * 8, true);
  const original = renderThermalFrame({}, { payload }, 'arctic', true);
  expect(original.contours?.length).toBeGreaterThan(0);
  expect(renderThermalFrame({}, { payload }, 'silver', true).contours).toEqual(original.contours);
  expect(renderThermalFrame({}, { payload }, 'arctic').contours).toBeUndefined();
  const identified = renderThermalFrame({ deviceInfo: { usb: { serialNumber: 'EA2976465' } } }, { payload }, 'arctic', true);
  for (let i = 0; i < original.contours!.length; i += 2) {
    const x = original.contours![i], y = original.contours![i + 1];
    expect(Number.isFinite(x) && x >= 0 && x <= 256).toBe(true);
    expect(Number.isFinite(y) && y >= 0 && y <= 192).toBe(true);
    expect(identified.contours![i]).toBeCloseTo(x, 3);
    expect(identified.contours![i + 1]).toBeCloseTo(y, 3);
  }
  // A horizontal temperature gradient must produce vertical isolines.
  for (let i = 0; i < original.contours!.length; i += 4) expect(original.contours![i]).toBeCloseTo(original.contours![i + 2], 3);
});

it('does not invent contours in a uniform thermal scene', () => {
  const payload = new Uint8Array(256 * 192 * 2).fill(32);
  expect(renderThermalFrame({}, { payload }, 'arctic', true).contours).toHaveLength(0);
});

it('computes the HUD spectrum from detector values independently of camera identity', () => {
  const payload = new Uint8Array(256 * 192 * 2);
  const view = new DataView(payload.buffer);
  for (let i = 0; i < 256 * 192; i++) view.setUint16(i * 2, i < 256 * 96 ? 4096 : 32768, true);
  const normal = renderThermalFrame({}, { payload }, 'terminator');
  expect(normal.spectrum?.unit).toBe('RAW');
  expect(normal.spectrum?.bins[16]).toBe(256 * 96);
  expect(normal.spectrum?.bins[128]).toBe(256 * 96);
  const identified = renderThermalFrame({ deviceInfo: { usb: { serialNumber: 'EA2976465' } } }, { payload }, 'terminator');
  expect(identified.spectrum).toEqual(normal.spectrum);
  expect(renderThermalFrame({}, { payload }, 'silver').spectrum).toBeUndefined();
});

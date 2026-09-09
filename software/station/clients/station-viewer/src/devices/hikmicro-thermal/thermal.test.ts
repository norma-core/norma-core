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
    const { rgba, ...metadata } = renderThermalFrame({ deviceInfo: { usb: { serialNumber } } }, frame, 'silver');
    const { rgba: originalPixels, ...originalMetadata } = original;
    expect(metadata).toEqual(originalMetadata);
    expect(rgba.length).toBe(originalPixels.length);
    expect(rgba.every((value, index) => value === originalPixels[index])).toBe(true);
  }
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

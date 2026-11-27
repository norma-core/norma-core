import { expect, it } from 'vitest';
import type { hikmicro } from '@/api/proto.js';
import { renderThermalFrame } from './thermal';
import { decodeY16 } from './y16';
import { SENSOR_FRAME_ENCODED, SMALL_PLANES } from './y16-fixtures';

const bytes = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
const le16 = (plane: Uint16Array) => new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength);

function sensorFramePixel(x: number, y: number): number {
  if ((x === 0 && y === 0) || (x === 255 && y === 191)) return 0xffff;
  if ((x === 255 && y === 0) || (x === 0 && y === 191)) return 0;
  return 7600 + 3 * x + 5 * y + (x * y) % 4;
}

function sensorFrame(): Uint16Array {
  const plane = new Uint16Array(256 * 192);
  for (let i = 0; i < plane.length; i++) plane[i] = sensorFramePixel(i % 256, Math.floor(i / 256));
  return plane;
}

it('decodes planes encoded by the driver bit for bit', () => {
  for (const { width, height, y16, encoded } of SMALL_PLANES) {
    expect(le16(decodeY16(bytes(encoded), width, height))).toEqual(bytes(y16));
  }
  expect(decodeY16(bytes(SENSOR_FRAME_ENCODED), 256, 192)).toEqual(sensorFrame());
});

// A single-segment frame declaring 256x192x2 bytes, with one last block.
function zstdFrame(blockType: number, blockSize: number, body: Uint8Array): Uint8Array {
  const size = 256 * 192 * 2;
  const header = 1 | (blockType << 1) | (blockSize << 3);
  return Uint8Array.of(
    0x28, 0xb5, 0x2f, 0xfd, 0xa0, size & 0xff, (size >> 8) & 0xff, size >> 16, 0,
    header & 0xff, (header >> 8) & 0xff, header >> 16, ...body,
  );
}

it('rejects a truncated plane, one of another size or a forged content size', () => {
  const encoded = bytes(SENSOR_FRAME_ENCODED);
  expect(() => decodeY16(encoded.subarray(0, encoded.length - 8), 256, 192)).toThrow();
  expect(() => decodeY16(encoded, 256, 191)).toThrow();
  expect(() => decodeY16(new Uint8Array(), 256, 192)).toThrow();
  // Claims 1.5 GiB, and a frame that is not single-segment so carries no content size.
  const forged = Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0x00, 0x00, 0x00, 0x60, 0x01, 0x00, 0x00);
  expect(() => decodeY16(forged, 256, 192)).toThrow(/holds 1610612736 bytes/);
  const unsized = Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x58, 0x01, 0x00, 0x00);
  expect(() => decodeY16(unsized, 256, 192)).toThrow(/not a single-segment frame/);
});

it('rejects a frame whose blocks decode to fewer or more bytes than it declares', () => {
  const size = 256 * 192 * 2;
  expect(decodeY16(zstdFrame(0, size, new Uint8Array(size)), 256, 192)).toEqual(new Uint16Array(256 * 192));
  expect(() => decodeY16(zstdFrame(0, size - 10, new Uint8Array(size - 10)), 256, 192)).toThrow(/decodes to 98294 bytes/);
  expect(() => decodeY16(zstdFrame(1, 200000, Uint8Array.of(7)), 256, 192)).toThrow(/decodes past 98304 bytes/);
});

it('renders an encoded frame exactly like the same frame stored raw, runtime block included', () => {
  const runtimeBlock = new Uint8Array(2048).map((_, i) => i * 7);
  const runtime = new DataView(runtimeBlock.buffer);
  runtime.setUint32(512, 0xaabbccdd, true);
  runtime.setUint32(516, 0x53, true);
  // Mode and range index the calibration tables.
  runtime.setUint16(5 * 2, 0, true);
  runtime.setUint16(13 * 2, 0, true);
  const container = new Uint8Array(0x3800);
  new DataView(container.buffer).setUint32(8, 0x53, true);
  const envelope = { deviceInfo: { calibration: { ok: true, container, factoryBlobOffset: 0, factoryBlobLength: 0x3800 } } };
  const payload = new Uint8Array(256 * 192 * 2 + 2048);
  payload.set(le16(sensorFrame()));
  payload.set(runtimeBlock, 256 * 192 * 2);
  const encoded = { y16Encoding: 1, y16: bytes(SENSOR_FRAME_ENCODED), runtimeBlock };
  for (const palette of ['iron', 'terminator'] as const) {
    const packed = renderThermalFrame(envelope, encoded, palette);
    expect(packed.usedCalibration).toBe(true);
    expect(packed).toEqual(renderThermalFrame(envelope, { payload }, palette));
  }
});

it('refuses a Y16 encoding it does not know instead of reading the payload', () => {
  const payload = new Uint8Array(256 * 192 * 2 + 2048);
  // A newer driver's encoding, which protobufjs passes through as a plain number.
  const frame = { y16Encoding: 2 as hikmicro.Y16Encoding, payload };
  expect(() => renderThermalFrame({}, frame, 'iron')).toThrow('unsupported Y16 encoding 2');
});

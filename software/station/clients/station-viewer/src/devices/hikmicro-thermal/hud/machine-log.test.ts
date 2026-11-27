import { expect, it } from 'vitest';
import type { hikmicro } from '@/api/proto.js';
import { y16Plane } from '../thermal';
import { SENSOR_FRAME_ENCODED } from '../y16-fixtures';
import { ThermalMachineLog } from './machine-log';

const base = { usedCalibration: false, minRaw: 100, maxRaw: 900, centerRaw: 500, centerC: null };
const statsFor = (frame: hikmicro.IThermalFrame) => ({ ...base, y16: y16Plane(frame) });
function payload() {
  const storage = new Uint8Array(256 * 192 * 2 + 7);
  const bytes = storage.subarray(7);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length; offset += 2) view.setUint16(offset, 0x1234, true);
  return bytes;
}

it('coalesces pending frames and reads little-endian words from the actual byte view', () => {
  const log = new ThermalMachineLog();
  for (let i = 0; i < 25; i++) {
    const frame = { payload: payload() };
    log.observe(frame, statsFor(frame));
  }
  const snapshot = log.flush()!;
  expect(snapshot.receivedFrames).toBe(25);
  expect(snapshot.lines.map(line => line.text).join('\n')).toContain('1234 1234 1234');
  expect(snapshot.rawLines.map(line => line.text).join('\n')).toContain('1234 1234 1234 1234');
  expect(log.flush()).toBeNull();
});

it('does not invent incoming frames on palette updates and keeps only eight log lines', () => {
  const log = new ThermalMachineLog();
  const frame = { payload: payload() };
  const stats = statsFor(frame);
  log.observe(frame, stats);
  log.flush();
  log.observe(frame, { ...stats });
  expect(log.flush()).toBeNull();
  let snapshot;
  for (let i = 0; i < 100; i++) {
    log.observe({ payload: payload() }, stats);
    snapshot = log.flush()!;
  }
  expect(snapshot!.receivedFrames).toBe(101);
  expect(snapshot!.lines).toHaveLength(8);
  expect(snapshot!.rawLines).toHaveLength(16);
  expect(new Set(snapshot!.lines.map(line => line.id)).size).toBe(8);
});

it('dumps the same words for a packed frame as for the frame stored raw', () => {
  const sensorPixel = (x: number, y: number) => {
    if ((x === 0 && y === 0) || (x === 255 && y === 191)) return 0xffff;
    if ((x === 255 && y === 0) || (x === 0 && y === 191)) return 0;
    return 7600 + 3 * x + 5 * y + (x * y) % 4;
  };
  const raw = new Uint8Array(256 * 192 * 2);
  const view = new DataView(raw.buffer);
  for (let i = 0; i < 256 * 192; i++) view.setUint16(i * 2, sensorPixel(i % 256, Math.floor(i / 256)), true);
  const y16 = Uint8Array.from(atob(SENSOR_FRAME_ENCODED), c => c.charCodeAt(0));
  const packedLog = new ThermalMachineLog();
  const rawLog = new ThermalMachineLog();
  for (let i = 0; i < 3; i++) {
    const packedFrame = { y16Encoding: 1, y16, runtimeBlock: new Uint8Array(2048) };
    const rawFrame = { payload: raw };
    packedLog.observe(packedFrame, statsFor(packedFrame));
    rawLog.observe(rawFrame, statsFor(rawFrame));
    const packed = packedLog.flush()!;
    expect(packed.lines.map(line => line.text).join('\n')).not.toContain('INCOMPLETE');
    expect(packed).toEqual(rawLog.flush());
  }
});

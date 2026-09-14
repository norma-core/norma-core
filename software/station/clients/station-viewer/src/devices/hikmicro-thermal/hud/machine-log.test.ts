import { expect, it } from 'vitest';
import { ThermalMachineLog } from './machine-log';

const stats = { usedCalibration: false, minRaw: 100, maxRaw: 900, centerRaw: 500, centerC: null };
function payload() {
  const storage = new Uint8Array(256 * 192 * 2 + 7);
  const bytes = storage.subarray(7);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length; offset += 2) view.setUint16(offset, 0x1234, true);
  return bytes;
}

it('coalesces pending frames and reads little-endian words from the actual byte view', () => {
  const log = new ThermalMachineLog();
  for (let i = 0; i < 25; i++) log.observe({ payload: payload() }, stats);
  const snapshot = log.flush()!;
  expect(snapshot.receivedFrames).toBe(25);
  expect(snapshot.lines.map(line => line.text).join('\n')).toContain('1234 1234 1234');
  expect(snapshot.rawLines.map(line => line.text).join('\n')).toContain('1234 1234 1234 1234');
  expect(log.flush()).toBeNull();
});

it('does not invent incoming frames on palette updates and keeps only eight log lines', () => {
  const log = new ThermalMachineLog();
  const frame = { payload: payload() };
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

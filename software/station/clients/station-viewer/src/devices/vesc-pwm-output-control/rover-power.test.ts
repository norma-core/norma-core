import Long from 'long';
import { expect, it } from 'vitest';
import { victron_smartsolar_mppt as victron } from '@/api/proto.js';
import { readRoverPower } from './rover-power';

const sample = (current: number): victron.IRxEnvelope => ({
  signalType: victron.VictronSignalType.VICTRON_TEXT_BLOCK,
  monotonicStampNs: Long.fromNumber(1e9),
  data: new TextEncoder().encode(`V\t13270\r\nI\t${current}\r\nIL\t2000\r\nPPV\t30\r\n`),
});
it('uses signed battery-terminal power without subtracting the LOAD current twice', () => {
  expect(readRoverPower(sample(-1200), 1100)?.watts).toBeCloseTo(-15.924);
  expect(readRoverPower(sample(500), 1100)?.watts).toBeCloseTo(6.635);
  expect(readRoverPower(sample(0), 1100)?.watts).toBe(0);
  expect(readRoverPower({ ...sample(500), signalType: victron.VictronSignalType.VICTRON_HEX_FRAME }, 1100)?.voltage).toBe(13.27);
});
it('does not present disconnected, missing, invalid or stale readings as battery balance', () => {
  const s = sample(-1200);
  expect(readRoverPower(s, 6100)).toBeNull();
  expect(readRoverPower({ ...s, error: 'lost link' }, 1100)).toBeNull();
  expect(readRoverPower({ ...s, signalType: victron.VictronSignalType.VICTRON_DISCONNECTED }, 1100)).toBeNull();
  expect(readRoverPower({ ...s, data: new TextEncoder().encode('V\t13270\r\n') }, 1100)).toBeNull();
  expect(readRoverPower({ ...s, data: new TextEncoder().encode('V\t0\r\nI\t500\r\n') }, 1100)).toBeNull();
  expect(readRoverPower(undefined, 1100)).toBeNull();
});

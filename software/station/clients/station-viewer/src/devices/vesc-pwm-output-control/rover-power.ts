import Long from 'long';
import { victron_smartsolar_mppt as victron } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';
import { parseVeDirectTextBlock } from '@/devices/victron-smartsolar-mppt/values';

export function readRoverPower(envelope: victron.IRxEnvelope | undefined, now: number): { watts: number; voltage: number; current: number } | null {
  if (!envelope || envelope.error || !envelope.monotonicStampNs) return null;
  const signal = envelope.signalType;
  if (signal !== victron.VictronSignalType.VICTRON_TEXT_BLOCK && signal !== victron.VictronSignalType.VICTRON_HEX_FRAME) return null;
  const age = now - serverToLocal(Long.fromValue(envelope.monotonicStampNs)).toNumber() / 1e6;
  if (!Number.isFinite(age) || age < -1000 || age > 5000) return null;
  // HEX snapshots also carry the driver's latest text block. I is signed
  // battery-terminal current: LOAD consumption is already accounted for.
  const values = parseVeDirectTextBlock(envelope.data);
  const voltage = values.batteryVoltageV;
  const current = values.batteryCurrentA;
  if (voltage === null || current === null || !Number.isFinite(voltage) || !Number.isFinite(current) || voltage <= 0) return null;
  return { watts: voltage * current, voltage, current };
}

import { afterEach, expect, it, vi } from 'vitest';
import { hikmicro } from '@/api/proto.js';
import type { StreamEntry } from '@/api/normfs';
import { ThermalLiveStream } from './live-stream';

afterEach(() => vi.useRealTimers());

function entry(id: number): StreamEntry {
  return { id: Uint8Array.of(id), data: hikmicro.RxEnvelope.encode({ frames: { sequence: id } }).finish() };
}

it('keeps reads bounded and discards a response from before hide/resume or disposal', async () => {
  vi.useFakeTimers();
  const pending: ((entry: StreamEntry) => void)[] = [];
  const client = { readLastEntry: vi.fn(() => new Promise<StreamEntry>(resolve => pending.push(resolve))) };
  const received: number[] = [];
  const stream = new ThermalLiveStream(client, 'thermal/camera', data => received.push(data.frames!.sequence!));
  stream.setEnabled(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.readLastEntry).toHaveBeenCalledTimes(1);
  stream.setEnabled(false);
  stream.setEnabled(true);
  pending.shift()!(entry(1));
  await vi.advanceTimersByTimeAsync(40);
  expect(received).toEqual([]);
  expect(client.readLastEntry).toHaveBeenCalledTimes(2);
  pending.shift()!(entry(2));
  await vi.advanceTimersByTimeAsync(40);
  expect(received).toEqual([2]);
  stream.dispose();
  pending.shift()!(entry(3));
  await vi.advanceTimersByTimeAsync(1000);
  expect(received).toEqual([2]);
  expect(client.readLastEntry).toHaveBeenCalledTimes(3);
});

it('does not republish duplicate tails and recovers from a failed read at the latest entry', async () => {
  vi.useFakeTimers();
  const client = { readLastEntry: vi.fn()
    .mockResolvedValueOnce(entry(1)).mockResolvedValueOnce(entry(1))
    .mockRejectedValueOnce(new Error('Entry not found')).mockResolvedValue(entry(8)) };
  const received: number[] = [];
  const stream = new ThermalLiveStream(client, 'thermal/camera', data => received.push(data.frames!.sequence!));
  stream.setEnabled(true);
  await vi.advanceTimersByTimeAsync(400);
  expect(received).toEqual([1, 8]);
  stream.dispose();
});

it('paces reads for older stations that still publish one-second batches', async () => {
  vi.useFakeTimers();
  const block = { id: Uint8Array.of(1), data: hikmicro.RxEnvelope.encode({
    frames: { frames: Array.from({ length: 25 }, () => ({ payload: Uint8Array.of(1) })) },
  }).finish() };
  const client = { readLastEntry: vi.fn().mockResolvedValue(block) };
  const stream = new ThermalLiveStream(client, 'thermal/camera', () => {});
  stream.setEnabled(true);
  await vi.advanceTimersByTimeAsync(999);
  expect(client.readLastEntry).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1001);
  expect(client.readLastEntry).toHaveBeenCalledTimes(3);
  stream.dispose();
});

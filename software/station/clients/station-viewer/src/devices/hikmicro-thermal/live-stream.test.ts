import { afterEach, expect, it, vi } from 'vitest';
import { hikmicro } from '@/api/proto.js';
import type { StreamEntry } from '@/api/normfs';
import { DeviceInfoLoader, ThermalDeviceInfoCache, ThermalLiveStream } from './live-stream';

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

it('reads a session\'s device info once and retries after a failed read', async () => {
  const deviceInfo = { usb: { serialNumber: 'EA6343104' }, calibration: { ok: true } };
  const client = { readSingleEntry: vi.fn()
    .mockRejectedValueOnce(new Error('request timed out'))
    .mockResolvedValue({ id: Uint8Array.of(1, 2), data: hikmicro.RxEnvelope.encode({ deviceInfo }).finish() }) };
  const cache = new ThermalDeviceInfoCache();
  const queue = 'thermal/device-info/camera';
  await expect(cache.load(client, queue, Uint8Array.of(1, 2))).rejects.toThrow('request timed out');
  expect(cache.get(queue, Uint8Array.of(1, 2))).toBeUndefined();
  const [first, second] = await Promise.all([
    cache.load(client, queue, Uint8Array.of(1, 2)),
    cache.load(client, queue, Uint8Array.of(1, 2)),
  ]);
  expect(first?.usb?.serialNumber).toBe('EA6343104');
  expect(second).toBe(first);
  await cache.load(client, queue, Uint8Array.of(1, 2));
  expect(client.readSingleEntry).toHaveBeenCalledTimes(2);
  expect(client.readSingleEntry).toHaveBeenLastCalledWith(queue, Uint8Array.of(1, 2));
  expect(cache.get(queue, Uint8Array.of(1, 2))).toBe(first);
});

it('evicts the least recently read session and keeps the last one per queue', async () => {
  const client = { readSingleEntry: vi.fn((queue: string, id: Uint8Array) => Promise.resolve({ id,
    data: hikmicro.RxEnvelope.encode({ deviceInfo: { driver: `${queue}#${id[0]}` } }).finish() })) };
  const cache = new ThermalDeviceInfoCache(2);
  await cache.load(client, 'a', Uint8Array.of(1));
  await cache.load(client, 'b', Uint8Array.of(1));
  cache.get('a', Uint8Array.of(1));
  await cache.load(client, 'b', Uint8Array.of(2));
  expect(cache.get('a', Uint8Array.of(1))?.driver).toBe('a#1');
  expect(cache.get('b', Uint8Array.of(1))).toBeUndefined();
  expect(cache.latestFor('b')?.driver).toBe('b#2');
});

it('keeps retrying device info that is not found yet, backing off, and at once on retryNow', async () => {
  vi.useFakeTimers();
  const notFound = new Error('Entry not found');
  const deviceInfo = { usb: { serialNumber: 'EA2976465' } };
  const client = { readSingleEntry: vi.fn()
    .mockRejectedValueOnce(notFound)
    .mockRejectedValueOnce(notFound)
    .mockRejectedValueOnce(notFound)
    .mockResolvedValue({ id: Uint8Array.of(7), data: hikmicro.RxEnvelope.encode({ deviceInfo }).finish() }) };
  const loaded = vi.fn();
  const loader = new DeviceInfoLoader(new ThermalDeviceInfoCache(), client, 'thermal/device-info/camera', Uint8Array.of(7), loaded,
    error => error === notFound);
  await vi.advanceTimersByTimeAsync(0);
  expect(client.readSingleEntry).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.readSingleEntry).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1999);
  expect(client.readSingleEntry).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(client.readSingleEntry).toHaveBeenCalledTimes(3);
  loader.retryNow();
  await vi.advanceTimersByTimeAsync(0);
  expect(client.readSingleEntry).toHaveBeenCalledTimes(4);
  expect(loaded).toHaveBeenCalledWith(expect.objectContaining({ usb: expect.objectContaining({ serialNumber: 'EA2976465' }) }));
  loader.dispose();
});

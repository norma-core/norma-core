import { describe, expect, it, vi } from 'vitest';
import { drivers, inference, normvla, sysinfo, usbvideo } from '@/api/proto.js';
import { normvlaCodec } from '@/devices/normvla/codec';
import { sysinfoCodec } from '@/devices/sysinfo/codec';
import { usbVideoCodec } from '@/devices/usbvideo/codec';
import { getLiveCameraFrame } from '@/usbvideo/live-camera-store';
import { parseFrame, type FrameEntryReader } from './frame-parser';

const ENTRY_ID = Uint8Array.of(9);

function reference(queue: string, type: drivers.QueueDataType, ptr = Uint8Array.of(1)): inference.InferenceRx.IEntry {
  return { queue, type, ptr };
}

function readerFor(entries: Record<string, Uint8Array>) {
  const readSingleEntry = vi.fn<FrameEntryReader['readSingleEntry']>(async (queue) => ({
    data: entries[queue],
    id: Uint8Array.of(1),
  }));
  return { readSingleEntry };
}

describe('parseFrame', () => {
  it('decodes a known codec and retains its provenance and raw bytes', async () => {
    const raw = sysinfo.Envelope.encode({ data: { hostname: 'station' } }).finish();
    const frame = await parseFrame(
      { entries: [reference('/system/rx', drivers.QueueDataType.QDT_SYSTEM)] },
      ENTRY_ID,
      readerFor({ '/system/rx': raw }),
    );

    expect(frame.devices.entryOf(sysinfoCodec)?.data.data?.hostname).toBe('station');
    expect(frame.devices.entryOf(sysinfoCodec)?.rawData).toEqual(raw);
    expect(frame.devices.entryOf(sysinfoCodec)?.queueType).toBe(drivers.QueueDataType.QDT_SYSTEM);
    expect(frame.issues).toEqual([]);
  });

  it('matches normvla by queue suffix without duplicating it as raw', async () => {
    const raw = normvla.Frame.encode({ images: [] }).finish();
    const queueId = '/robot/inference/normvla';
    const frame = await parseFrame(
      { entries: [reference(queueId, drivers.QueueDataType.QDT_INFERENCE_FRAMES)] },
      ENTRY_ID,
      readerFor({ [queueId]: raw }),
    );

    expect(frame.devices.entryOf(normvlaCodec)?.queueId).toBe(queueId);
    expect(frame.otherEntries).not.toHaveProperty(queueId);
  });

  it('keeps unknown and failed known payloads raw but only reports the decode failure', async () => {
    const unknownQueue = '/commands';
    const failedQueue = '/system/rx';
    const frame = await parseFrame(
      { entries: [
        reference(unknownQueue, drivers.QueueDataType.QDT_STATION_COMMANDS),
        reference(failedQueue, drivers.QueueDataType.QDT_SYSTEM),
      ] },
      ENTRY_ID,
      readerFor({ [unknownQueue]: Uint8Array.of(1), [failedQueue]: Uint8Array.of(0x80) }),
    );

    expect(frame.otherEntries).toHaveProperty(unknownQueue);
    expect(frame.otherEntries).toHaveProperty(failedQueue);
    expect(frame.issues).toMatchObject([{ queueId: failedQueue, stage: 'decode' }]);
  });

  it('reuses the exact decoded entry for an unchanged pointer without a second read', async () => {
    const raw = sysinfo.Envelope.encode({ data: { hostname: 'station' } }).finish();
    const reader = readerFor({ '/system/rx': raw });
    const inferenceRx = { entries: [reference('/system/rx', drivers.QueueDataType.QDT_SYSTEM)] };
    const first = await parseFrame(inferenceRx, ENTRY_ID, reader);
    const second = await parseFrame(inferenceRx, ENTRY_ID, reader, first);

    expect(reader.readSingleEntry).toHaveBeenCalledTimes(1);
    expect(second.devices.entryOf(sysinfoCodec)?.data).toBe(first.devices.entryOf(sysinfoCodec)?.data);
  });

  it('refetches when raw retention is newly requested', async () => {
    const raw = sysinfo.Envelope.encode({ data: { hostname: 'station' } }).finish();
    const reader = readerFor({ '/system/rx': raw });
    const inferenceRx = { entries: [reference('/system/rx', drivers.QueueDataType.QDT_SYSTEM)] };
    const withoutRaw = await parseFrame(inferenceRx, ENTRY_ID, reader, undefined, { retainRawData: false });
    const withRaw = await parseFrame(inferenceRx, ENTRY_ID, reader, withoutRaw, { retainRawData: true });

    expect(reader.readSingleEntry).toHaveBeenCalledTimes(2);
    expect(withRaw.devices.entryOf(sysinfoCodec)?.rawData).toEqual(raw);
  });

  it('keeps every single-cardinality entry and reports the violation', async () => {
    const raw = sysinfo.Envelope.encode({}).finish();
    const frame = await parseFrame(
      { entries: [
        reference('/a/system/rx', drivers.QueueDataType.QDT_SYSTEM, Uint8Array.of(1)),
        reference('/b/system/rx', drivers.QueueDataType.QDT_SYSTEM, Uint8Array.of(2)),
      ] },
      ENTRY_ID,
      readerFor({ '/a/system/rx': raw, '/b/system/rx': raw }),
    );

    expect(frame.devices.entriesOf(sysinfoCodec)).toHaveLength(2);
    expect(frame.issues).toMatchObject([{ stage: 'cardinality' }]);
  });

  it('does not treat an untyped queue with protobuf default type zero as sysinfo', async () => {
    const queueId = '/legacy/untyped';
    const raw = sysinfo.Envelope.encode({ data: { hostname: 'not-system' } }).finish();
    const frame = await parseFrame(
      { entries: [reference(queueId, drivers.QueueDataType.QDT_SYSTEM)] },
      ENTRY_ID,
      readerFor({ [queueId]: raw }),
    );

    expect(frame.devices.entryOf(sysinfoCodec)).toBeUndefined();
    expect(frame.otherEntries?.[queueId]?.data).toEqual(raw);
    expect(frame.issues).toEqual([]);
  });

  it('publishes usbvideo immediately before returning its metadata projection', async () => {
    const queueId = '/camera/test-routing';
    const raw = usbvideo.RxEnvelope.encode({
      camera: { uniqueId: 'camera-test-routing' },
      frames: { framesData: [Uint8Array.of(1, 2, 3)] },
    }).finish();
    const frame = await parseFrame(
      { entries: [reference(queueId, drivers.QueueDataType.QDT_USB_VIDEO_FRAMES)] },
      ENTRY_ID,
      readerFor({ [queueId]: raw }),
      undefined,
      { shouldPublishVideoFrames: () => true },
    );

    expect(Array.from(getLiveCameraFrame('camera-test-routing')?.data ?? [])).toEqual([1, 2, 3]);
    expect(frame.devices.entriesOf(usbVideoCodec)[0].data.frames?.framesData).toBeUndefined();
  });

  it('reuses an unchanged empty usbvideo envelope in full-payload mode', async () => {
    const queueId = '/camera/empty';
    const raw = usbvideo.RxEnvelope.encode({ frames: { framesData: [] } }).finish();
    const reader = readerFor({ [queueId]: raw });
    const inferenceRx = { entries: [reference(queueId, drivers.QueueDataType.QDT_USB_VIDEO_FRAMES)] };
    const first = await parseFrame(inferenceRx, ENTRY_ID, reader);
    const second = await parseFrame(inferenceRx, ENTRY_ID, reader, first);

    expect(reader.readSingleEntry).toHaveBeenCalledTimes(1);
    expect(second.devices.entriesOf(usbVideoCodec)[0].data).toBe(
      first.devices.entriesOf(usbVideoCodec)[0].data,
    );
  });
});

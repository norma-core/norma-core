import Long from 'long';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/websocket', () => ({ default: {} }));

import { parseFrame, type Frame } from '@/api/frame-parser';
import type { NormFsClient } from '@/api/normfs';
import { drivers, inference, usbvideo } from '@/api/proto.js';
import { isVideoSourceFresh } from './camera-source';

const QUEUE = 'usbvideo/cam/rx';
const SECOND_NS = 1_000_000_000;
const RECORDED_AT_NS = 1_000 * SECOND_NS;

function ptr(id: number): Uint8Array {
  return new Uint8Array(Long.fromNumber(id).toBytesLE());
}

function snapshot(entryPtr: number, stampNs: number): inference.IInferenceRx {
  return {
    monotonicStampNs: Long.fromNumber(stampNs),
    entries: [{ queue: QUEUE, type: drivers.QueueDataType.QDT_USB_VIDEO_FRAMES, ptr: ptr(entryPtr) }],
  };
}

const normFs = {
  readSingleEntry: async (_queue: string, id: Uint8Array) => ({
    id,
    data: usbvideo.RxEnvelope.encode({
      type: usbvideo.RxEnvelopeType.ET_FRAMES,
      camera: { uniqueId: 'cam' },
      stamp: { monotonicStampNs: Long.fromNumber(RECORDED_AT_NS) },
    }).finish(),
  }),
} as unknown as NormFsClient;

function observe(snapshots: inference.IInferenceRx[]): Promise<Frame> {
  return snapshots.reduce<Promise<Frame | undefined>>(
    (previous, rx, index) => previous.then((frame) => parseFrame(rx, ptr(index), normFs, frame, {
      shouldLoadVideoFrame: () => false,
    })),
    Promise.resolve(undefined),
  ) as Promise<Frame>;
}

const nowMs = (stampNs: number) => stampNs / 1e6;

describe('isVideoSourceFresh', () => {
  it('keeps an unwatched camera that is still recording', async () => {
    const lastSnapshotNs = RECORDED_AT_NS + 120 * SECOND_NS;
    const frame = await observe([
      snapshot(1, RECORDED_AT_NS),
      snapshot(2, RECORDED_AT_NS + 60 * SECOND_NS),
      snapshot(3, lastSnapshotNs),
    ]);

    expect(frame.videoQueues).toHaveLength(1);
    expect(isVideoSourceFresh(frame.videoQueues![0], nowMs(lastSnapshotNs))).toBe(true);
  });

  it('drops a camera whose queue stopped advancing', async () => {
    const lastSnapshotNs = RECORDED_AT_NS + 120 * SECOND_NS;
    const frame = await observe([
      snapshot(1, RECORDED_AT_NS),
      snapshot(1, RECORDED_AT_NS + 60 * SECOND_NS),
      snapshot(1, lastSnapshotNs),
    ]);

    expect(frame.videoQueues).toHaveLength(1);
    expect(isVideoSourceFresh(frame.videoQueues![0], nowMs(lastSnapshotNs))).toBe(false);
  });
});

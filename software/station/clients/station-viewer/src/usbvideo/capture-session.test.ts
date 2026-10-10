import { describe, expect, it, vi } from 'vitest';
import { usbvideo } from '@/api/proto.js';
import { resolveCaptureSession, withCaptureSession } from './capture-session.js';
import { idToBytes } from './vp8-chain.js';

function session(camera: string): Uint8Array {
  return usbvideo.RxEnvelope.encode({
    type: usbvideo.RxEnvelopeType.ET_CAPTURE_SESSION,
    camera: { uniqueId: camera },
    formats: [{ width: 640, height: 480 }],
  }).finish();
}

// Decoded, as the viewer gets it, so the copy keeps what decoding set.
function frameNaming(id: bigint): usbvideo.IRxEnvelope {
  return usbvideo.RxEnvelope.decode(
    usbvideo.RxEnvelope.encode({ type: usbvideo.RxEnvelopeType.ET_FRAMES, sessionPtr: idToBytes(id) }).finish(),
  );
}

describe('capture session', () => {
  it('fills a frame from its session record, read once', async () => {
    const readSingleEntry = vi.fn(async () => ({ id: idToBytes(4n), data: session('cam'), dataSource: 0 }));
    const reader = { readSingleEntry } as never;

    const first = await resolveCaptureSession(reader, 'q1', frameNaming(4n));
    const second = await resolveCaptureSession(reader, 'q1', frameNaming(4n));

    expect(first.formats).toHaveLength(1);
    expect(first.type).toBe(usbvideo.RxEnvelopeType.ET_FRAMES);
    expect(second.formats).toHaveLength(1);
    expect(withCaptureSession('q1', frameNaming(4n)).formats).toHaveLength(1);
    expect(readSingleEntry).toHaveBeenCalledTimes(1);
  });

  it('asks again for a record that was not there yet', async () => {
    vi.useFakeTimers();
    const readSingleEntry = vi
      .fn()
      .mockRejectedValueOnce(new Error('Entry not found'))
      .mockResolvedValue({ id: idToBytes(7n), data: session('late'), dataSource: 0 });
    const reader = { readSingleEntry } as never;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await resolveCaptureSession(reader, 'q2', frameNaming(7n))).formats).toEqual([]);
    expect((await resolveCaptureSession(reader, 'q2', frameNaming(7n))).formats).toEqual([]);
    vi.advanceTimersByTime(6_000);
    expect((await resolveCaptureSession(reader, 'q2', frameNaming(7n))).formats).toHaveLength(1);
    expect(readSingleEntry).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('leaves a frame that carries its formats as it is', async () => {
    const readSingleEntry = vi.fn();
    const envelope = { type: usbvideo.RxEnvelopeType.ET_FRAMES, formats: [{ width: 320 }] };

    expect(await resolveCaptureSession({ readSingleEntry } as never, 'q3', envelope)).toBe(envelope);
    expect(readSingleEntry).not.toHaveBeenCalled();
  });
});

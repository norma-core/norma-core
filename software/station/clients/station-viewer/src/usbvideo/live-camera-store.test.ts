import Long from 'long';
import { describe, expect, it, vi } from 'vitest';
import { frame, usbvideo } from '@/api/proto.js';
import {
  type LiveCameraFrame,
  clearLiveCameraFrame,
  createLiveCameraMetadataEnvelope,
  publishLiveCameraFrame,
  publishLiveCameraPicture,
  resumeLiveCameraFrame,
  subscribeLiveCameraFrame,
  suppressLiveCameraFrame,
} from './live-camera-store.js';

/** Stands in for ImageBitmap, which Node does not have; only close() matters here. */
function bitmap() {
  const picture = { closed: false, close() { picture.closed = true; } };
  return picture;
}

function deferred() {
  let resolve!: (picture: ImageBitmap | null) => void;
  const promise = new Promise<ImageBitmap | null>((r) => { resolve = r; });
  return { promise, resolve };
}

function vp8Envelope(camera: string, index: number): usbvideo.IRxEnvelope {
  return {
    type: usbvideo.RxEnvelopeType.ET_FRAMES,
    camera: { uniqueId: camera },
    stamp: { index: Long.fromNumber(index, true) },
    frames: {
      format: { width: 4, height: 4, kind: frame.FrameFormatKind.FF_VP8 },
      framesData: [new Uint8Array([1, 2, 3])],
    },
  };
}

describe('live camera store', () => {
  it('closes a decoded frame once a newer one replaces it, after listeners drew it', () => {
    const drawn: Array<boolean> = [];
    const unsubscribe = subscribeLiveCameraFrame('cam-a', (current: LiveCameraFrame | null) => {
      drawn.push(Boolean(current?.picture && !(current.picture as unknown as { closed: boolean }).closed));
    });
    const first = bitmap();
    const second = bitmap();
    publishLiveCameraFrame('q', vp8Envelope('cam-a', 1), first as unknown as ImageBitmap);
    publishLiveCameraFrame('q', vp8Envelope('cam-a', 2), second as unknown as ImageBitmap);

    expect(drawn).toEqual([true, true]);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);

    clearLiveCameraFrame('cam-a');
    expect(second.closed).toBe(true);
    unsubscribe();
  });

  it('closes a frame for a suppressed camera instead of keeping it', () => {
    suppressLiveCameraFrame('cam-b');
    const picture = bitmap();
    publishLiveCameraFrame('q', vp8Envelope('cam-b', 1), picture as unknown as ImageBitmap);
    expect(picture.closed).toBe(true);
    resumeLiveCameraFrame('cam-b');
  });

  it('never shows VP8 bytes as an image when no decoded frame comes with them', () => {
    const seen: Array<LiveCameraFrame | null> = [];
    const unsubscribe = subscribeLiveCameraFrame('cam-c', (current) => seen.push(current));
    publishLiveCameraFrame('q', vp8Envelope('cam-c', 1));
    expect(seen).toEqual([]);
    unsubscribe();
  });

  it('decodes only the newest frame that arrived while a decode was running', async () => {
    const shown: Array<string | null> = [];
    const unsubscribe = subscribeLiveCameraFrame('cam-d', (current) => shown.push(current?.index ?? null));
    const first = deferred();
    const last = deferred();
    const started: number[] = [];
    publishLiveCameraPicture('q', vp8Envelope('cam-d', 1), () => { started.push(1); return first.promise; });
    publishLiveCameraPicture('q', vp8Envelope('cam-d', 2), () => { started.push(2); return deferred().promise; });
    publishLiveCameraPicture('q', vp8Envelope('cam-d', 3), () => { started.push(3); return last.promise; });
    expect(started).toEqual([1]);

    first.resolve(bitmap() as unknown as ImageBitmap);
    await vi.waitFor(() => expect(started).toEqual([1, 3]));
    last.resolve(bitmap() as unknown as ImageBitmap);
    await vi.waitFor(() => expect(shown).toEqual(['1', '3']));
    clearLiveCameraFrame('cam-d');
    unsubscribe();
  });

  it('drops a decoded frame that a newer JPEG frame overtook', async () => {
    const shown: Array<string | null> = [];
    const unsubscribe = subscribeLiveCameraFrame('cam-e', (current) => shown.push(current?.index ?? null));
    const late = deferred();
    const picture = bitmap();
    publishLiveCameraPicture('q', vp8Envelope('cam-e', 1), () => late.promise);
    publishLiveCameraFrame('q', {
      type: usbvideo.RxEnvelopeType.ET_FRAMES,
      camera: { uniqueId: 'cam-e' },
      stamp: { index: Long.fromNumber(2, true) },
      frames: { framesData: [new Uint8Array([0xff, 0xd8])] },
    });
    late.resolve(picture as unknown as ImageBitmap);
    await vi.waitFor(() => expect(picture.closed).toBe(true));
    expect(shown).toEqual(['2']);
    clearLiveCameraFrame('cam-e');
    unsubscribe();
  });

  it('keeps a running decode when a snapshot reuses the camera entry', async () => {
    const shown: Array<string | null> = [];
    const unsubscribe = subscribeLiveCameraFrame('cam-f', (current) => shown.push(current?.index ?? null));
    const decode = deferred();
    publishLiveCameraPicture('q', vp8Envelope('cam-f', 1), () => decode.promise);
    // Another queue ticked; the camera's pointer did not move.
    publishLiveCameraFrame('q', createLiveCameraMetadataEnvelope(vp8Envelope('cam-f', 1)));
    decode.resolve(bitmap() as unknown as ImageBitmap);
    await vi.waitFor(() => expect(shown).toEqual(['1']));
    clearLiveCameraFrame('cam-f');
    unsubscribe();
  });

  it('starts the next decode even when showing a frame throws', async () => {
    let calls = 0;
    const shown: Array<string | null> = [];
    const unsubscribe = subscribeLiveCameraFrame('cam-g', (current) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('listener failed');
      }
      shown.push(current?.index ?? null);
    });
    const first = deferred();
    const second = deferred();
    publishLiveCameraPicture('q', vp8Envelope('cam-g', 1), () => first.promise);
    publishLiveCameraPicture('q', vp8Envelope('cam-g', 2), () => second.promise);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    first.resolve(bitmap() as unknown as ImageBitmap);
    second.resolve(bitmap() as unknown as ImageBitmap);
    await vi.waitFor(() => expect(shown).toEqual(['2']));
    error.mockRestore();
    clearLiveCameraFrame('cam-g');
    unsubscribe();
  });

  it('closes the replaced frame and reaches every listener when one throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unsubscribeThrowing = subscribeLiveCameraFrame('cam-h', () => {
      throw new Error('listener failed');
    });
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeLiveCameraFrame('cam-h', (current) => seen.push(current?.index ?? null));
    const first = bitmap();
    publishLiveCameraFrame('q', vp8Envelope('cam-h', 1), first as unknown as ImageBitmap);
    publishLiveCameraFrame('q', vp8Envelope('cam-h', 2), bitmap() as unknown as ImageBitmap);
    expect(first.closed).toBe(true);
    expect(seen).toEqual(['1', '2']);
    unsubscribeThrowing();
    clearLiveCameraFrame('cam-h');
    unsubscribe();
    error.mockRestore();
  });
});

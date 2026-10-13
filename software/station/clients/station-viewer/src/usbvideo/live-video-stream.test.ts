import Long from 'long';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { frame, normfs, usbvideo } from '@/api/proto.js';
import { idToBytes } from './vp8-chain.js';

let stuck = false;

vi.mock('./vp8-frames.js', () => ({
  decoderApi: async () => ({
    createDecoder: ({ output }: { output: (picture: unknown) => void }) => ({
      state: 'configured',
      configure() {},
      decode(chunk: { timestamp: number }) {
        if (!stuck) {
          queueMicrotask(() => output({ timestamp: chunk.timestamp, close() {} }));
        }
      },
      flush: async () => {},
      close() {},
    }),
    createChunk: (init: { timestamp: number }) => init,
    toBitmap: async () => ({ close() {} }),
  }),
}));

const { syncLiveVideoStreams } = await import('./live-video-stream.js');

class FakeSocket {
  static opened: FakeSocket[] = [];
  binaryType = '';
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeSocket.opened.push(this);
  }

  send() {}

  close() {
    this.closed = true;
  }

  entry(readId: number, id: bigint, envelope: usbvideo.IRxEnvelope) {
    const data = normfs.ServerResponse.encode({
      read: {
        readId: Long.fromNumber(readId),
        result: normfs.ReadResponse.Result.RR_ENTRY,
        id: { raw: idToBytes(id) },
        data: usbvideo.RxEnvelope.encode(envelope).finish(),
      },
    }).finish();
    this.onmessage?.({ data: new Uint8Array(data).buffer });
  }
}

const SECOND = 1_000_000_000;

function vp8(id: bigint, atNs: number): usbvideo.IRxEnvelope {
  return {
    type: usbvideo.RxEnvelopeType.ET_FRAMES,
    frames: {
      format: { kind: frame.FrameFormatKind.FF_VP8 },
      keyframe: id === 0n,
      keyframePtr: id === 0n ? undefined : idToBytes(0n),
      framesData: [new Uint8Array([id === 0n ? 1 : 0])],
      stamps: [{ monotonicStampNs: Long.fromNumber(atNs) }],
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// frame_skip: 134 at 30 fps.
async function followFramesEvery(intervalNs: number, count: number): Promise<FakeSocket> {
  vi.stubGlobal('WebSocket', FakeSocket);
  syncLiveVideoStreams('ws://station', [{ queueId: 'usbvideo/cam', data: undefined as never }]);
  const socket = FakeSocket.opened[0];
  socket.onopen?.();
  socket.entry(1, 0n, vp8(0n, intervalNs));
  await settle();
  for (let id = 0n; id < BigInt(count); id++) {
    socket.entry(2, id, vp8(id, (Number(id) + 1) * intervalNs));
    // eslint-disable-next-line no-await-in-loop -- each frame decodes and draws before the next arrives
    await settle();
  }
  return socket;
}

describe('live VP8 stream', () => {
  afterEach(() => {
    syncLiveVideoStreams('ws://station', []);
    FakeSocket.opened = [];
    stuck = false;
    vi.unstubAllGlobals();
  });

  it('keeps a slow camera that is drawn in time', async () => {
    const socket = await followFramesEvery(4.5 * SECOND, 6);
    expect(socket.closed).toBe(false);
  });

  it('starts over when frames are not drawn', async () => {
    stuck = true;
    const socket = await followFramesEvery(4.5 * SECOND, 6);
    expect(socket.closed).toBe(true);
  });
});

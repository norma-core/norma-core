// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
// oxlint-disable-next-line import/no-named-as-default -- the polyfill needs the default wrapper, not the named type
import LibAV from '@libav.js/variant-webm';
import * as polyfill from 'libavjs-webcodecs-polyfill';
import { frame, usbvideo } from '@/api/proto.js';
import { DecoderLateError, type ChainDecoder, type ChainEntry, type DecoderApi, Vp8ChainReader, idToBytes } from './vp8-chain.js';

type Picture = VideoFrame;

const W = 64;
const H = 48;

let api: DecoderApi<Picture>;

beforeAll(async () => {
  await polyfill.load({ polyfill: false, LibAV, libavOptions: { noworker: true } });
  api = {
    createDecoder: (init) => new polyfill.VideoDecoder(init),
    createChunk: (init) => new polyfill.EncodedVideoChunk(init),
    // Node has no canvas; drawing is the browser's part.
    toBitmap: () => Promise.reject(new Error('no canvas here')),
  };
}, 60_000);

/** Frame `t`: a gradient that moves, so P frames carry real residuals. */
function source(t: number): Picture {
  const yuv = new Uint8Array((W * H * 3) / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      yuv[y * W + x] = (x * 3 + y + t * 7) & 255;
    }
  }
  yuv.fill(128, W * H);
  return new polyfill.VideoFrame(yuv, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: t * 33_333 });
}

async function bytesOf(picture: Picture): Promise<Uint8Array> {
  const out = new Uint8Array(picture.allocationSize());
  await picture.copyTo(out);
  return out;
}

/** Entries 0.., keyframes every `chainLength` frames, a session event after frame 4. */
async function recordQueue(frames: number, chainLength: number): Promise<ChainEntry[]> {
  const packets: Array<{ key: boolean; data: Uint8Array }> = [];
  const encoder = new polyfill.VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ key: chunk.type === 'key', data });
    },
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({ codec: 'vp8', width: W, height: H, bitrate: 400_000, latencyMode: 'realtime' });
  for (let t = 0; t < frames; t++) {
    const picture = source(t);
    encoder.encode(picture, { keyFrame: t % chainLength === 0 });
    picture.close();
  }
  await encoder.flush();
  encoder.close();

  const entries: ChainEntry[] = [];
  let id = 0n;
  let keyframe = 0n;
  packets.forEach((packet, t) => {
    if (packet.key) {
      keyframe = id;
    }
    entries.push({
      id,
      envelope: usbvideo.RxEnvelope.create({
        type: usbvideo.RxEnvelopeType.ET_FRAMES,
        frames: {
          format: { width: W, height: H, kind: frame.FrameFormatKind.FF_VP8 },
          framesData: [packet.data],
          keyframe: packet.key,
          keyframePtr: packet.key ? new Uint8Array() : idToBytes(keyframe),
        },
      }),
    });
    id += 1n;
    if (t === 4) {
      entries.push({ id, envelope: usbvideo.RxEnvelope.create({ type: usbvideo.RxEnvelopeType.ET_DEVICE_CONNECTED }) });
      id += 1n;
    }
  });
  return entries;
}

/** One chain of `n` entries with placeholder packets, for decoders that do not decode. */
function fakeChain(n: number): ChainEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: BigInt(i),
    envelope: usbvideo.RxEnvelope.create({
      type: usbvideo.RxEnvelopeType.ET_FRAMES,
      frames: {
        format: { width: W, height: H, kind: frame.FrameFormatKind.FF_VP8 },
        framesData: [new Uint8Array([i])],
        keyframe: i === 0,
        keyframePtr: i === 0 ? new Uint8Array() : idToBytes(0n),
      },
    }),
  }));
}

interface FakePicture {
  timestamp: number;
  closed: boolean;
  close(): void;
}

/** `outputFor` maps each decoded chunk's timestamp to the picture timestamps it outputs. */
function fakeApi(outputFor: (timestamp: number) => number[], flush: () => Promise<void>) {
  const made: FakePicture[] = [];
  const decoders: Array<ChainDecoder & { closed: boolean; refuse: boolean; reclaim(): void }> = [];
  const fake: DecoderApi<FakePicture> = {
    createDecoder: ({ output, error }) => {
      const decoder = {
        closed: false,
        refuse: false,
        get state() {
          return decoder.closed ? 'closed' : 'configured';
        },
        configure: () => undefined,
        decode: (chunk: unknown) => {
          if (decoder.closed) {
            throw new DOMException('decoder is closed', 'InvalidStateError');
          }
          if (decoder.refuse) {
            throw new DOMException('a key frame is required', 'DataError');
          }
          for (const timestamp of outputFor((chunk as { timestamp: number }).timestamp)) {
            const picture: FakePicture = { timestamp, closed: false, close: () => { picture.closed = true; } };
            made.push(picture);
            output(picture);
          }
        },
        flush,
        close: () => {
          if (decoder.closed) {
            throw new DOMException('decoder is closed', 'InvalidStateError');
          }
          decoder.closed = true;
        },
        /** The browser closing the codec on its own, as for a background tab. */
        reclaim: () => {
          decoder.closed = true;
          error(new DOMException('codec reclaimed', 'QuotaExceededError'));
        },
      };
      decoders.push(decoder);
      return decoder;
    },
    createChunk: (init) => init,
    toBitmap: () => Promise.reject(new Error('no canvas here')),
  };
  return { fake, made, decoders };
}

function rangeOf(entries: ChainEntry[]) {
  return async (_queue: string, from: bigint, count: number) =>
    entries.filter((e) => e.id >= from && e.id < from + BigInt(count));
}

describe('Vp8ChainReader', () => {
  it('returns, for every entry id, the frame a sequential decode gives', async () => {
    const entries = await recordQueue(30, 10);
    const frames = entries.filter((e) => e.envelope.type === usbvideo.RxEnvelopeType.ET_FRAMES);
    expect(frames.filter((e) => e.envelope.frames?.keyframe).length).toBe(3);

    const sequential = new Map<bigint, Uint8Array>();
    const outputs: Picture[] = [];
    const decoder = new polyfill.VideoDecoder({ output: (p) => outputs.push(p), error: (e) => { throw e; } });
    decoder.configure({ codec: 'vp8' });
    for (const e of frames) {
      decoder.decode(new polyfill.EncodedVideoChunk({
        type: e.envelope.frames!.keyframe ? 'key' : 'delta',
        timestamp: Number(e.id),
        data: new Uint8Array(e.envelope.frames!.framesData![0]),
      }));
    }
    await decoder.flush();
    decoder.close();
    for (let i = 0; i < frames.length; i++) {
      // eslint-disable-next-line no-await-in-loop -- one frame at a time, in decode order
      sequential.set(frames[i].id, await bytesOf(outputs[i]));
      outputs[i].close();
    }

    const reader = new Vp8ChainReader(api, rangeOf(entries));
    // Forward, backward and across chains.
    const order = frames.map((e) => e.id).sort((a, b) => Number((a * 7919n) % 31n - (b * 7919n) % 31n));
    for (const id of order) {
      const envelope = entries.find((e) => e.id === id)!.envelope;
      // eslint-disable-next-line no-await-in-loop -- the order of lookups is what is under test
      const picture = await reader.frameAt('cam', id, envelope);
      expect(picture, `entry ${id}`).not.toBeNull();
      // eslint-disable-next-line no-await-in-loop -- as above
      expect(await bytesOf(picture!), `entry ${id}`).toEqual(sequential.get(id));
      picture!.close();
    }
    reader.close();
  }, 120_000);

  it('gives no frame when an entry of the chain is missing', async () => {
    const entries = await recordQueue(10, 10);
    const holed = entries.filter((e) => e.id !== 3n);
    const reader = new Vp8ChainReader(api, rangeOf(holed));
    const target = holed.find((e) => e.id === 7n)!;
    expect(await reader.frameAt('cam', target.id, target.envelope)).toBeNull();
    // Entries before the hole still decode.
    const before = holed.find((e) => e.id === 2n)!;
    const picture = await reader.frameAt('cam', before.id, before.envelope);
    expect(picture).not.toBeNull();
    picture!.close();
    reader.close();
  }, 120_000);

  it('gives no frame for an entry that is not a frame', async () => {
    const entries = await recordQueue(8, 8);
    const event = entries.find((e) => e.envelope.type !== usbvideo.RxEnvelopeType.ET_FRAMES)!;
    const reader = new Vp8ChainReader(api, rangeOf(entries));
    expect(await reader.frameAt('cam', event.id, event.envelope)).toBeNull();
    reader.close();
  }, 120_000);

  it('closes every frame it decodes except the one it returns', async () => {
    const entries = await recordQueue(20, 20);
    const made: Picture[] = [];
    const closed = new Set<Picture>();
    const counting: DecoderApi<Picture> = {
      ...api,
      createDecoder: (init) => api.createDecoder({
        ...init,
        output: (picture) => {
          made.push(picture);
          const close = picture.close.bind(picture);
          picture.close = () => {
            closed.add(picture);
            close();
          };
          init.output(picture);
        },
      }),
    };
    const reader = new Vp8ChainReader(counting, rangeOf(entries));
    // A live session reads forward; every step but the last decodes frames
    // nobody is handed.
    const frames = entries.filter((e) => e.envelope.type === usbvideo.RxEnvelopeType.ET_FRAMES);
    for (const target of [frames[3], frames[4], frames[12]]) {
      // eslint-disable-next-line no-await-in-loop -- reads follow each other, as a live view's do
      const picture = await reader.frameAt('cam', target.id, target.envelope);
      expect(picture).not.toBeNull();
      picture!.close();
    }
    const open = made.filter((picture) => !closed.has(picture));
    expect(made.length).toBeGreaterThan(3);
    expect(open).toEqual([]);
    reader.close();
  }, 120_000);

  it('reports a frame the decoder never outputs as late, and keeps reading', async () => {
    const entries = await recordQueue(10, 10);
    const frames = entries.filter((e) => e.envelope.type === usbvideo.RxEnvelopeType.ET_FRAMES);
    const lost = frames[5];
    // The chain decodes from its keyframe, so the sixth output is the lost frame.
    let outputs = 0;
    const dropping: DecoderApi<Picture> = {
      ...api,
      createDecoder: (init) => api.createDecoder({
        ...init,
        output: (picture) => {
          if (outputs++ === 5) {
            picture.close();
            return;
          }
          init.output(picture);
        },
      }),
    };
    const reader = new Vp8ChainReader(dropping, rangeOf(entries));
    await expect(reader.frameAt('cam', lost.id, lost.envelope)).rejects.toBeInstanceOf(DecoderLateError);
    const next = await reader.frameAt('cam', frames[7].id, frames[7].envelope);
    expect(next).not.toBeNull();
    next!.close();
    reader.close();
  }, 120_000);

  it("gives no frame when the decoder outputs another entry's picture in its place", async () => {
    const entries = fakeChain(4);
    const target = entries[3];
    const { fake, made } = fakeApi((t) => [t === 3000 ? 4000 : t], () => Promise.resolve());
    const reader = new Vp8ChainReader(fake, rangeOf(entries));
    expect(await reader.frameAt('cam', target.id, target.envelope)).toBeNull();
    expect(made.map((p) => p.timestamp)).toEqual([0, 1000, 2000, 4000]);
    expect(made.every((p) => p.closed)).toBe(true);
    reader.close();
  });

  it('starts a new decoder when the browser closed the last one between reads', async () => {
    const entries = fakeChain(4);
    const { fake, decoders } = fakeApi((t) => [t], () => Promise.resolve());
    const reader = new Vp8ChainReader(fake, rangeOf(entries));
    const first = await reader.frameAt('cam', entries[1].id, entries[1].envelope);
    expect(first?.timestamp).toBe(1000);
    decoders[0].reclaim();
    const next = await reader.frameAt('cam', entries[2].id, entries[2].envelope);
    expect(next?.timestamp).toBe(2000);
    expect(decoders).toHaveLength(2);
    reader.close();
  });

  it('gives no frame, rather than hanging, when decode throws', async () => {
    const entries = fakeChain(3);
    const { fake, decoders } = fakeApi((t) => [t], () => Promise.resolve());
    const reader = new Vp8ChainReader(fake, rangeOf(entries));
    expect((await reader.frameAt('cam', entries[1].id, entries[1].envelope))?.timestamp).toBe(1000);
    decoders[0].refuse = true;
    expect(await reader.frameAt('cam', entries[2].id, entries[2].envelope)).toBeNull();
    expect(decoders[0].closed).toBe(true);
    expect((await reader.frameAt('cam', entries[2].id, entries[2].envelope))?.timestamp).toBe(2000);
    reader.close();
  });

  it('gives up on a decoder whose flush never ends, and keeps reading', async () => {
    vi.useFakeTimers();
    try {
      const entries = fakeChain(4);
      const { fake, decoders } = fakeApi(() => [], () => new Promise<void>(() => undefined));
      const reader = new Vp8ChainReader(fake, rangeOf(entries));
      const stuck = reader.frameAt('cam', entries[2].id, entries[2].envelope);
      const next = reader.frameAt('cam', entries[3].id, entries[3].envelope);
      const stuckLate = expect(stuck).rejects.toBeInstanceOf(DecoderLateError);
      const nextLate = expect(next).rejects.toBeInstanceOf(DecoderLateError);
      await vi.advanceTimersByTimeAsync(12_000);
      await stuckLate;
      expect(decoders[0].closed).toBe(true);
      await vi.advanceTimersByTimeAsync(12_000);
      await nextLate;
      expect(decoders).toHaveLength(2);
      reader.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
// oxlint-disable-next-line import/no-named-as-default -- the polyfill needs the default wrapper, not the named type
import LibAV from '@libav.js/variant-webm';
import * as polyfill from 'libavjs-webcodecs-polyfill';
import { frame, usbvideo } from '@/api/proto.js';
import { type ChainEntry, type DecoderApi, Vp8ChainReader, idToBytes } from './vp8-chain.js';

type Picture = VideoFrame;

const W = 64;
const H = 48;

let api: DecoderApi<Picture>;

beforeAll(async () => {
  await polyfill.load({ polyfill: false, LibAV, libavOptions: { noworker: true } });
  api = {
    createDecoder: (init) => new polyfill.VideoDecoder(init),
    createChunk: (init) => new polyfill.EncodedVideoChunk(init),
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
});

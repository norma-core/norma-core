import { frame, usbvideo } from '@/api/proto.js';

// Mirrors software/drivers/usbvideo/src/codec/chain.rs: a VP8 entry decodes
// only after every entry back to its chain's keyframe, and any hole or frame
// of another chain is "no frame", never a picture of the wrong one.

/** A keyframe about every second; a longer chain means the writer is broken. */
const MAX_CHAIN = 1024n;

/** How long a decoder may hold a frame before the chain is flushed out of it. */
const OUTPUT_TIMEOUT_MS = 2000;

export interface ChainEntry {
  id: bigint;
  envelope: usbvideo.IRxEnvelope;
}

/** The parts of WebCodecs' VideoDecoder this module uses. */
export interface ChainDecoder {
  configure(config: { codec: string }): void;
  decode(chunk: unknown): void;
  flush(): Promise<void>;
  close(): void;
}

export interface DecoderApi<F extends { close(): void }> {
  createDecoder(init: { output: (frame: F) => void; error: (error: unknown) => void }): ChainDecoder;
  createChunk(init: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array<ArrayBuffer> }): unknown;
}

export function idFromBytes(raw: Uint8Array): bigint {
  let id = 0n;
  for (let i = raw.length - 1; i >= 0; i--) {
    id = (id << 8n) | BigInt(raw[i]);
  }
  return id;
}

export function idToBytes(id: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = Number((id >> BigInt(i * 8)) & 0xffn);
  }
  return out;
}

export function isVp8(envelope: usbvideo.IRxEnvelope): boolean {
  return envelope.type === usbvideo.RxEnvelopeType.ET_FRAMES
    && envelope.frames?.format?.kind === frame.FrameFormatKind.FF_VP8;
}

/** The keyframe entry the VP8 frame at `id` decodes from, or null. */
export function keyframeOf(id: bigint, envelope: usbvideo.IRxEnvelope): bigint | null {
  if (!isVp8(envelope)) {
    return null;
  }
  if (envelope.frames?.keyframe) {
    return id;
  }
  const raw = envelope.frames?.keyframePtr;
  if (!raw || raw.length === 0) {
    return null;
  }
  const keyframe = idFromBytes(raw);
  return keyframe < id ? keyframe : null;
}

interface Cursor<F> {
  keyframe: bigint;
  last: bigint;
  decoder: ChainDecoder;
  waiting: Array<(frame: F | null) => void>;
}

/**
 * Decodes VP8 frames by entry id, keeping one decoder per queue: reading a
 * queue forward costs a decode per frame, a jump at most its chain.
 */
export class Vp8ChainReader<F extends { close(): void }> {
  private readonly cursors = new Map<string, Cursor<F>>();
  private readonly busy = new Map<string, Promise<unknown>>();

  constructor(
    private readonly api: DecoderApi<F>,
    private readonly readRange: (queue: string, from: bigint, count: number) => Promise<ChainEntry[]>,
  ) {}

  /** The frame at `id`, which the caller owns and closes; null when the chain is broken. */
  frameAt(queue: string, id: bigint, envelope: usbvideo.IRxEnvelope): Promise<F | null> {
    // One reader per queue at a time: a decoder's outputs follow its inputs.
    const previous = this.busy.get(queue) ?? Promise.resolve();
    const next = previous.then(() => this.decodeAt(queue, id, envelope), () => this.decodeAt(queue, id, envelope));
    this.busy.set(queue, next.catch(() => undefined));
    return next;
  }

  close(): void {
    for (const cursor of this.cursors.values()) {
      cursor.decoder.close();
    }
    this.cursors.clear();
  }

  private async decodeAt(queue: string, id: bigint, envelope: usbvideo.IRxEnvelope): Promise<F | null> {
    const keyframe = keyframeOf(id, envelope);
    if (keyframe === null || id - keyframe >= MAX_CHAIN) {
      return null;
    }

    let cursor = this.cursors.get(queue);
    if (!cursor || cursor.keyframe !== keyframe || cursor.last >= id) {
      cursor?.decoder.close();
      cursor = this.newCursor(keyframe);
      this.cursors.set(queue, cursor);
    }
    const from = cursor.last < keyframe ? keyframe : cursor.last + 1n;
    const entries = await this.readRange(queue, from, Number(id - from + 1n));

    let expected = from;
    let target: Promise<F | null> | null = null;
    for (const entry of entries) {
      if (entry.id !== expected) {
        return this.drop(queue, cursor);
      }
      expected += 1n;
      if (entry.envelope.type !== usbvideo.RxEnvelopeType.ET_FRAMES) {
        if (entry.id === id) {
          return this.drop(queue, cursor);
        }
        continue;
      }
      const chain = keyframeOf(entry.id, entry.envelope);
      const packet = entry.envelope.frames?.framesData?.[0];
      if (chain !== keyframe || !packet || (entry.id === keyframe) !== Boolean(entry.envelope.frames?.keyframe)) {
        return this.drop(queue, cursor);
      }
      const output = new Promise<F | null>((resolve) => cursor!.waiting.push(resolve));
      cursor.decoder.decode(this.api.createChunk({
        type: entry.id === keyframe ? 'key' : 'delta',
        timestamp: Number(entry.id),
        data: new Uint8Array(packet),
      }));
      cursor.last = entry.id;
      if (entry.id === id) {
        target = output;
      } else {
        output.then((picture) => picture?.close());
      }
      if (entry.id === id) {
        break;
      }
    }
    if (!target) {
      return this.drop(queue, cursor);
    }

    const result = await Promise.race([
      target,
      new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), OUTPUT_TIMEOUT_MS)),
    ]);
    if (result === 'late') {
      // A decoder that buffers releases its frames on flush, after which it
      // wants a keyframe, so this chain cannot be continued.
      await cursor.decoder.flush().catch(() => undefined);
      const flushed = await target;
      this.drop(queue, cursor);
      return flushed;
    }
    if (result === null) {
      return this.drop(queue, cursor);
    }
    return result;
  }

  private newCursor(keyframe: bigint): Cursor<F> {
    const waiting: Array<(frame: F | null) => void> = [];
    const decoder = this.api.createDecoder({
      output: (picture) => {
        const resolve = waiting.shift();
        if (resolve) {
          resolve(picture);
        } else {
          picture.close();
        }
      },
      error: () => {
        for (const resolve of waiting.splice(0)) {
          resolve(null);
        }
      },
    });
    decoder.configure({ codec: 'vp8' });
    return { keyframe, last: keyframe - 1n, decoder, waiting };
  }

  private drop(queue: string, cursor: Cursor<F>): null {
    for (const resolve of cursor.waiting.splice(0)) {
      resolve(null);
    }
    cursor.decoder.close();
    if (this.cursors.get(queue) === cursor) {
      this.cursors.delete(queue);
    }
    return null;
  }
}

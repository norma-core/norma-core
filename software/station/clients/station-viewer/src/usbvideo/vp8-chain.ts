import { frame, usbvideo } from '@/api/proto.js';

// Mirrors software/drivers/usbvideo/src/codec/chain.rs: a VP8 entry decodes
// only after every entry back to its chain's keyframe, and any hole or frame
// of another chain is "no frame", never a picture of the wrong one.

/** A keyframe about every second; a longer chain means the writer is broken. */
const MAX_CHAIN = 1024n;

/** How long a decoder may hold a frame before the chain is flushed out of it. */
const OUTPUT_TIMEOUT_MS = 2000;

/** The same before any decoder has output: libav.js may still be starting its worker. */
const FIRST_OUTPUT_TIMEOUT_MS = 10_000;

/** The decoder did not output the frame in time, which says nothing about the chain. */
export class DecoderLateError extends Error {}

/** How long that flush may take before the decoder is given up on. */
const FLUSH_TIMEOUT_MS = 2000;

/** A decoded picture; its timestamp names the entry it was decoded from. */
interface Picture {
  readonly timestamp: number;
  close(): void;
}

export interface ChainEntry {
  id: bigint;
  envelope: usbvideo.IRxEnvelope;
}

/** The parts of WebCodecs' VideoDecoder this module uses. */
export interface ChainDecoder {
  readonly state: string;
  configure(config: { codec: string; optimizeForLatency?: boolean }): void;
  decode(chunk: unknown): void;
  flush(): Promise<void>;
  close(): void;
}

export interface DecoderApi<F extends Picture> {
  createDecoder(init: { output: (frame: F) => void; error: (error: unknown) => void }): ChainDecoder;
  createChunk(init: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array<ArrayBuffer> }): unknown;
  /** A drawable copy of the frame; the frame itself stays the caller's to close. */
  toBitmap(frame: F): Promise<ImageBitmap>;
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

interface Waiting<F> {
  timestamp: number;
  resolve: (frame: F | null) => void;
}

interface Cursor<F> {
  keyframe: bigint;
  last: bigint;
  decoder: ChainDecoder;
  waiting: Array<Waiting<F>>;
  /** The decoder reported an error, possibly between reads. */
  failed: boolean;
}

function closeDecoder(decoder: ChainDecoder): void {
  // The browser may already have closed it, e.g. reclaiming a background tab's codec.
  if (decoder.state !== 'closed') {
    decoder.close();
  }
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | 'late'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Decodes VP8 frames by entry id, keeping one decoder per queue: reading a
 * queue forward costs a decode per frame, a jump at most its chain.
 */
export class Vp8ChainReader<F extends Picture> {
  private readonly cursors = new Map<string, Cursor<F>>();
  private readonly busy = new Map<string, Promise<unknown>>();
  /** A decoder has output a picture, so the decoding library is up. */
  private started = false;

  constructor(
    private readonly api: DecoderApi<F>,
    private readonly readRange: (queue: string, from: bigint, count: number) => Promise<ChainEntry[]>,
  ) {}

  /**
   * The frame at `id`, which the caller owns and closes; null when the chain
   * is broken. Rejects with DecoderLateError when the decoder was too slow.
   */
  frameAt(queue: string, id: bigint, envelope: usbvideo.IRxEnvelope): Promise<F | null> {
    // One reader per queue at a time: a decoder's outputs follow its inputs.
    const previous = this.busy.get(queue) ?? Promise.resolve();
    const next = previous.then(() => this.decodeAt(queue, id, envelope), () => this.decodeAt(queue, id, envelope));
    this.busy.set(queue, next.catch(() => undefined));
    return next;
  }

  close(): void {
    for (const cursor of this.cursors.values()) {
      closeDecoder(cursor.decoder);
    }
    this.cursors.clear();
  }

  private async decodeAt(queue: string, id: bigint, envelope: usbvideo.IRxEnvelope): Promise<F | null> {
    const keyframe = keyframeOf(id, envelope);
    if (keyframe === null || id - keyframe >= MAX_CHAIN) {
      return null;
    }

    let cursor = this.cursors.get(queue);
    if (!cursor || cursor.failed || cursor.decoder.state === 'closed'
      || cursor.keyframe !== keyframe || cursor.last >= id) {
      if (cursor) {
        closeDecoder(cursor.decoder);
      }
      cursor = this.newCursor(keyframe);
      this.cursors.set(queue, cursor);
    }
    const from = cursor.last < keyframe ? keyframe : cursor.last + 1n;
    const entries = await this.readRange(queue, from, Number(id - from + 1n));

    let expected = from;
    let target: Promise<F | null> | null = null;
    try {
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
        // In milliseconds: the libav.js decoder keeps no finer timestamp.
        const timestamp = Number(entry.id) * 1000;
        const output = new Promise<F | null>((resolve) => cursor!.waiting.push({ timestamp, resolve }));
        cursor.decoder.decode(this.api.createChunk({
          type: entry.id === keyframe ? 'key' : 'delta',
          timestamp,
          data: new Uint8Array(packet),
        }));
        cursor.last = entry.id;
        if (entry.id === id) {
          target = output;
          break;
        }
        output.then((picture) => picture?.close());
      }
    } catch {
      // A decoder closed under us throws here rather than through its error callback.
      return this.drop(queue, cursor);
    }
    if (!target) {
      return this.drop(queue, cursor);
    }

    const result = await within(target, this.started ? OUTPUT_TIMEOUT_MS : FIRST_OUTPUT_TIMEOUT_MS);
    if (result === 'late') {
      // Flush releases a buffering decoder's frames but leaves it wanting a
      // keyframe; a target it still has not output was never produced. A
      // flush that hangs too is cut short, so the queue's next read can run.
      await within(cursor.decoder.flush().catch(() => undefined), FLUSH_TIMEOUT_MS);
      this.drop(queue, cursor);
      const picture = await target;
      if (!picture) {
        throw new DecoderLateError(`no picture for entry ${id} in time`);
      }
      return picture;
    }
    if (result === null) {
      return this.drop(queue, cursor);
    }
    return result;
  }

  private newCursor(keyframe: bigint): Cursor<F> {
    const waiting: Array<Waiting<F>> = [];
    const cursor = { keyframe, last: keyframe - 1n, waiting, failed: false } as Cursor<F>;
    cursor.decoder = this.api.createDecoder({
      output: (picture) => {
        this.started = true;
        // Outputs come in decode order; one past a request means the decoder
        // dropped that frame, and a picture nobody asked for is closed.
        while (waiting.length > 0 && waiting[0].timestamp < picture.timestamp) {
          waiting.shift()!.resolve(null);
        }
        if (waiting.length > 0 && waiting[0].timestamp === picture.timestamp) {
          waiting.shift()!.resolve(picture);
        } else {
          picture.close();
        }
      },
      error: () => {
        cursor.failed = true;
        for (const { resolve } of waiting.splice(0)) {
          resolve(null);
        }
      },
    });
    cursor.decoder.configure({ codec: 'vp8', optimizeForLatency: true });
    return cursor;
  }

  private drop(queue: string, cursor: Cursor<F>): null {
    for (const { resolve } of cursor.waiting.splice(0)) {
      resolve(null);
    }
    closeDecoder(cursor.decoder);
    if (this.cursors.get(queue) === cursor) {
      this.cursors.delete(queue);
    }
    return null;
  }
}

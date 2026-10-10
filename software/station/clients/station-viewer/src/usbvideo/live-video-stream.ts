import Long from 'long';
import { normfs, usbvideo } from '@/api/proto.js';
import {
  publishLiveCameraFrame,
  shouldLoadLiveCameraFrame,
  subscribeLiveCameraWatchers,
} from './live-camera-store.js';
import { type ChainDecoder, type DecoderApi, idFromBytes, idToBytes, isVp8, keyframeOf } from './vp8-chain.js';
import { decoderApi } from './vp8-frames.js';
import { rememberCaptureSession, withCaptureSession } from './capture-session.js';

/** Behind this, a caught-up stream starts over from the latest keyframe. */
const MAX_LAG_NS = 4_000_000_000;

/** For the tail, the backlog from its keyframe and the next frame; a slow camera stretches the last. */
const DEADLINE_MS = 5000;
const MAX_SILENCE_MS = 60_000;

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 10_000;

/** Falling behind sooner than this after catching up counts as a failure. */
const HEALTHY_MS = 20_000;

// A stream that keeps failing to keep up is left to snapshot reads for a while.
const MAX_FAILURES = 3;
const SNAPSHOT_READS_MS = 30_000;

const LAST_READ_ID = 1;
const FOLLOW_READ_ID = 2;

function stampNs(envelope: usbvideo.IRxEnvelope): number {
  const stamp = envelope.frames?.stamps?.[0]?.monotonicStampNs;
  return stamp == null ? 0 : Long.fromValue(stamp).toNumber();
}

interface Decoding {
  id: bigint;
  envelope: usbvideo.IRxEnvelope;
}

interface Drawing {
  decoder: ChainDecoder;
  api: DecoderApi<VideoFrame>;
  picture: VideoFrame;
  envelope: usbvideo.IRxEnvelope;
}

// Kept per queue, so a stream closed and opened again does not start from a clean slate.
const failuresByQueue = new Map<string, number>();

/**
 * Follows one camera queue on a socket of its own, since NormFS has no way to
 * cancel a follow short of the connection closing.
 */
class LiveVideoStream {
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly stallCheck: ReturnType<typeof setInterval>;
  private closed = false;
  private tailRead = false;
  private following = false;
  private followedAt = 0;
  private connectedAt = 0;
  // Snapshot reads stay on until the stream delivers an entry past the tail in time.
  private caughtUp = false;
  private caughtUpAt = 0;
  private retries = 0;
  private silenceMs = DEADLINE_MS;
  private frameIntervalMs = 0;
  // Arrival time less frame stamp; its minimum stands for no lag, so no clock sync is needed.
  private minOffsetNs = Infinity;

  private api: DecoderApi<VideoFrame> | null = null;
  private decoder: ChainDecoder | null = null;
  private readonly decoding = new Map<number, Decoding>();
  private keyframe: bigint | null = null;
  private last = 0n;
  private showFrom = 0n;
  private next: Drawing | null = null;
  private drawing = false;

  private lastEntryAt = 0;
  private receivedNs = 0;
  private arrivalLagNs = 0;
  private drawnNs = 0;
  private latestEnvelope: usbvideo.IRxEnvelope | null = null;

  constructor(private readonly url: string, private readonly queueId: string) {
    this.connect();
    this.stallCheck = setInterval(() => this.checkDeadlines(), 1000);
  }

  private get failures(): number {
    return failuresByQueue.get(this.queueId) ?? 0;
  }

  private set failures(count: number) {
    if (count > 0) {
      failuresByQueue.set(this.queueId, count);
    } else {
      failuresByQueue.delete(this.queueId);
    }
  }

  private checkDeadlines(): void {
    const now = Date.now();
    if (this.ws && !this.tailRead && now - this.connectedAt > DEADLINE_MS) {
      this.fail(`no tail in ${DEADLINE_MS / 1000} s`);
    } else if (this.following && this.last < this.showFrom && now - this.followedAt > DEADLINE_MS) {
      this.fail(`backlog not read in ${DEADLINE_MS / 1000} s`);
    } else if (this.following && now - this.lastEntryAt > this.silenceMs) {
      console.warn(`Live video ${this.queueId}: no frame for ${this.silenceMs / 1000} s, starting over.`);
      if (this.frameIntervalMs === 0) {
        this.silenceMs = Math.min(this.silenceMs * 2, MAX_SILENCE_MS);
      }
      this.restart();
    }
  }

  get isCaughtUp(): boolean {
    return this.caughtUp;
  }

  get latest(): usbvideo.IRxEnvelope | null {
    return this.caughtUp ? this.latestEnvelope : null;
  }

  close(): void {
    this.closed = true;
    clearInterval(this.stallCheck);
    this.stop();
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.connectedAt = Date.now();
    ws.onopen = () => this.read(LAST_READ_ID, new Uint8Array(8), normfs.OffsetType.OT_SHIFT_FROM_TAIL, 1);
    ws.onmessage = (event) => {
      try {
        const read = normfs.ServerResponse.decode(new Uint8Array(event.data)).read;
        if (read) {
          this.receive(read);
        }
      } catch (error) {
        console.error(`Live video ${this.queueId}: bad message:`, error);
      }
    };
    ws.onclose = () => this.restart();
    ws.onerror = () => ws.close();
  }

  private read(readId: number, offset: Uint8Array, type: normfs.OffsetType, limit: number): void {
    const request = normfs.ClientRequest.encode({
      read: {
        readId: Long.fromNumber(readId),
        queueId: this.queueId,
        offset: { id: { raw: offset }, type },
        limit: Long.fromNumber(limit),
        step: Long.ONE,
      },
    }).finish();
    this.ws?.send(request as unknown as ArrayBuffer);
  }

  private receive(read: normfs.IReadResponse): void {
    const readId = Long.fromValue(read.readId ?? 0).toNumber();
    const result = read.result ?? normfs.ReadResponse.Result.RR_START;
    if (result === normfs.ReadResponse.Result.RR_START) {
      return;
    }
    if (result !== normfs.ReadResponse.Result.RR_ENTRY || !read.id?.raw || !read.data) {
      // A follow never ends; a tail read that ends before its entry found nothing.
      if (readId === FOLLOW_READ_ID || !this.tailRead) {
        this.restart();
      }
      return;
    }
    const id = idFromBytes(read.id.raw);
    let envelope: usbvideo.IRxEnvelope;
    try {
      envelope = usbvideo.RxEnvelope.decode(read.data);
    } catch (error) {
      console.error(`Live video ${this.queueId}: bad entry:`, error);
      return;
    }
    if (readId === LAST_READ_ID) {
      this.tailRead = true;
      void this.follow(id, envelope);
    } else {
      this.onEntry(id, envelope);
    }
  }

  private async follow(id: bigint, envelope: usbvideo.IRxEnvelope): Promise<void> {
    const ws = this.ws;
    let from = id;
    // A session record goes in ahead of a keyframe, so a tail that is one is
    // followed by VP8 frames too.
    const record = envelope.type !== usbvideo.RxEnvelopeType.ET_FRAMES;
    if (record) {
      rememberCaptureSession(this.queueId, id, envelope);
    }
    if (isVp8(envelope) || record) {
      this.api = await decoderApi();
      if (ws !== this.ws) {
        return;
      }
      if (!this.api) {
        this.restart();
        return;
      }
      // Without its keyframe the tail cannot be shown; the next keyframe can.
      from = record ? id + 1n : keyframeOf(id, envelope) ?? id + 1n;
    }
    this.showFrom = id;
    this.last = from - 1n;
    this.following = true;
    this.followedAt = Date.now();
    this.lastEntryAt = this.followedAt;
    this.read(FOLLOW_READ_ID, idToBytes(from), normfs.OffsetType.OT_ABSOLUTE, 0);
  }

  private onEntry(id: bigint, envelope: usbvideo.IRxEnvelope): void {
    const now = Date.now();
    this.lastEntryAt = now;
    if (envelope.type !== usbvideo.RxEnvelopeType.ET_FRAMES) {
      rememberCaptureSession(this.queueId, id, envelope);
      this.last = id;
      return;
    }
    envelope = withCaptureSession(this.queueId, envelope);
    if (isVp8(envelope)) {
      if (!this.api || !this.decode(id, envelope)) {
        this.restart();
        return;
      }
    }
    const previousNs = id === this.last + 1n ? this.receivedNs : 0;
    this.last = id;
    this.receivedNs = stampNs(envelope);
    this.trackArrival(previousNs);
    // The tail may be old when the camera went quiet; only what follows it can be late.
    if (id <= this.showFrom) {
      return;
    }
    this.latestEnvelope = envelope;
    if (!this.caughtUp) {
      this.caughtUp = true;
      this.caughtUpAt = now;
      this.retries = 0;
      this.drawnNs = this.receivedNs;
    } else if (now - this.caughtUpAt > HEALTHY_MS) {
      this.failures = 0;
    }
    if (!isVp8(envelope)) {
      publishLiveCameraFrame(this.queueId, envelope);
      this.drawnNs = this.receivedNs;
    }
    const lagNs = Math.max(this.receivedNs - this.drawnNs, this.arrivalLagNs);
    if (lagNs > MAX_LAG_NS) {
      const behind = `${(lagNs / 1e9).toFixed(1)} s behind`;
      if (now - this.caughtUpAt < HEALTHY_MS) {
        this.fail(behind);
      } else {
        console.warn(`Live video ${this.queueId}: ${behind}, starting over.`);
        this.restart();
      }
    }
  }

  private trackArrival(previousNs: number): void {
    if (this.receivedNs === 0) {
      return;
    }
    const offsetNs = performance.now() * 1_000_000 - this.receivedNs;
    this.minOffsetNs = Math.min(this.minOffsetNs, offsetNs);
    this.arrivalLagNs = offsetNs - this.minOffsetNs;
    if (previousNs > 0 && this.receivedNs > previousNs) {
      const intervalMs = (this.receivedNs - previousNs) / 1_000_000;
      this.frameIntervalMs = this.frameIntervalMs === 0 ? intervalMs : this.frameIntervalMs * 0.9 + intervalMs * 0.1;
      this.silenceMs = Math.max(DEADLINE_MS, 3 * this.frameIntervalMs);
    }
  }

  private decode(id: bigint, envelope: usbvideo.IRxEnvelope): boolean {
    const api = this.api!;
    const keyframe = keyframeOf(id, envelope);
    const packet = envelope.frames?.framesData?.[0];
    const isKey = keyframe === id;
    if (!packet || keyframe === null || (!isKey && (keyframe !== this.keyframe || id !== this.last + 1n))) {
      return false;
    }
    if (!this.decoder || this.decoder.state === 'closed') {
      this.decoder = this.createDecoder(api);
    }
    this.keyframe = keyframe;
    // In milliseconds, as in vp8-chain: the libav.js decoder keeps no finer timestamp.
    const timestamp = Number(id) * 1000;
    this.decoding.set(timestamp, { id, envelope });
    try {
      this.decoder.decode(api.createChunk({
        type: isKey ? 'key' : 'delta',
        timestamp,
        data: new Uint8Array(packet),
      }));
    } catch {
      return false;
    }
    return true;
  }

  private createDecoder(api: DecoderApi<VideoFrame>): ChainDecoder {
    const decoder = api.createDecoder({
      output: (picture) => this.show(decoder, api, picture),
      error: () => {
        if (this.decoder === decoder) {
          this.restart();
        }
      },
    });
    decoder.configure({ codec: 'vp8', optimizeForLatency: true });
    return decoder;
  }

  private show(decoder: ChainDecoder, api: DecoderApi<VideoFrame>, picture: VideoFrame): void {
    const decoded = this.decoding.get(picture.timestamp);
    for (const timestamp of this.decoding.keys()) {
      if (timestamp > picture.timestamp) {
        break;
      }
      this.decoding.delete(timestamp);
    }
    if (this.decoder !== decoder || !this.caughtUp || !decoded || decoded.id <= this.showFrom) {
      picture.close();
      return;
    }
    // Only the newest picture waits to be drawn; decoders stall on frames held open.
    this.next?.picture.close();
    this.next = { decoder, api, picture, envelope: decoded.envelope };
    if (!this.drawing) {
      void this.draw();
    }
  }

  private async draw(): Promise<void> {
    if (!this.next) {
      this.drawing = false;
      return;
    }
    this.drawing = true;
    const { decoder, api, picture, envelope } = this.next;
    this.next = null;
    try {
      const bitmap = await api.toBitmap(picture);
      if (this.decoder === decoder) {
        publishLiveCameraFrame(this.queueId, envelope, bitmap);
        this.drawnNs = Math.max(this.drawnNs, stampNs(envelope));
      } else {
        bitmap.close();
      }
    } catch (error) {
      console.error(`Live video ${this.queueId}: frame not drawn:`, error);
    } finally {
      picture.close();
    }
    void this.draw();
  }

  private fail(reason: string): void {
    this.failures += 1;
    if (this.failures < MAX_FAILURES) {
      console.warn(`Live video ${this.queueId}: ${reason}, starting over.`);
      this.restart();
      return;
    }
    console.warn(`Live video ${this.queueId}: ${reason}, reading snapshots for ${SNAPSHOT_READS_MS / 1000} s.`);
    // One more failure after that goes straight back to snapshot reads.
    this.failures = MAX_FAILURES - 1;
    this.restart(SNAPSHOT_READS_MS);
  }

  private restart(delayMs?: number): void {
    this.stop();
    if (this.closed) {
      return;
    }
    const delay = delayMs ?? Math.min(FIRST_RETRY_MS * 2 ** this.retries, MAX_RETRY_MS);
    this.retries += 1;
    this.retry = setTimeout(() => this.connect(), delay);
  }

  private stop(): void {
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.close();
    }
    this.decoder = null;
    this.decoding.clear();
    this.next?.picture.close();
    this.next = null;
    this.tailRead = false;
    this.following = false;
    this.caughtUp = false;
    this.keyframe = null;
    this.last = 0n;
    this.latestEnvelope = null;
    this.receivedNs = 0;
    this.arrivalLagNs = 0;
    this.drawnNs = 0;
  }
}

const streams = new Map<string, LiveVideoStream>();

type LiveVideoSource = { queueId: string; data: usbvideo.IRxEnvelope };
let lastUrl = '';
let lastSources: readonly LiveVideoSource[] = [];

/** Follows the camera queues someone is watching in a visible tab and stops the rest. */
export function syncLiveVideoStreams(url: string, sources: readonly LiveVideoSource[]): void {
  lastUrl = url;
  lastSources = sources;
  if (sources.length > 0) {
    for (const queueId of failuresByQueue.keys()) {
      if (!sources.some((source) => source.queueId === queueId)) {
        failuresByQueue.delete(queueId);
      }
    }
  }
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const watched = new Set(hidden ? [] : sources
    .filter((source) => shouldLoadLiveCameraFrame(source.queueId, source.data))
    .map((source) => source.queueId));
  for (const [queueId, stream] of streams) {
    if (!watched.has(queueId)) {
      stream.close();
      streams.delete(queueId);
    }
  }
  for (const queueId of watched) {
    if (!streams.has(queueId)) {
      streams.set(queueId, new LiveVideoStream(url, queueId));
    }
  }
}

function resync(): void {
  syncLiveVideoStreams(lastUrl, lastSources);
}

subscribeLiveCameraWatchers(resync);
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', resync);
}

/** Whether frames of `queueId` come from its stream rather than snapshot reads. */
export function isLiveVideoFollowing(queueId: string): boolean {
  return streams.get(queueId)?.isCaughtUp ?? false;
}

/** The newest envelope a caught-up stream has seen, for the snapshot's metadata. */
export function getLiveVideoEnvelope(queueId: string): usbvideo.IRxEnvelope | null {
  const stream = streams.get(queueId);
  return stream?.latest ?? null;
}

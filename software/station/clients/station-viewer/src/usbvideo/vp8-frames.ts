// Bundled rather than imported on demand: a failed chunk import stays failed until the page reloads.
import * as polyfill from 'libavjs-webcodecs-polyfill';
import { usbvideo } from '@/api/proto.js';
import type { NormFsClient } from '@/api/normfs.js';
import { DecoderLateError, type ChainEntry, type DecoderApi, Vp8ChainReader, idFromBytes, idToBytes } from './vp8-chain.js';

type Frame = VideoFrame;

/** How long a failed decoder load is left alone before it is tried again. */
export const RETRY_AFTER_MS = 10_000;
/** A load still pending after this counts as failed; the wasm is 2.3 MB. */
export const LOAD_TIMEOUT_MS = 60_000;
/** How long a load runs before a reconnect gives up on it; a younger one may be loading fine. */
export const RESTART_AFTER_MS = 5_000;
/** Frames woken by a reconnect read again spread over this long, not all at once. */
export const RECONNECT_SPREAD_MS = 1_000;

export interface RetryingLoader<T> {
  (): Promise<T | null>;
  /** When a failed load may be tried again; null when none is waiting. */
  retryAt(): number | null;
  /** After a reconnect: gives up on a load once it has run RESTART_AFTER_MS, or lets a failed one go again. */
  restart(): void;
}

const RESTARTED = new Error('restarted');

/**
 * Runs `load` once and keeps its result. A load that fails or takes longer
 * than LOAD_TIMEOUT_MS gives null, logged once, and is not tried again until
 * RETRY_AFTER_MS have passed.
 */
export function retryingLoader<T>(
  load: (attempt: number, signal: AbortSignal) => Promise<T>,
  now: () => number = () => Date.now(),
): RetryingLoader<T> {
  let pending: Promise<T | null> | null = null;
  let failedAt: number | null = null;
  let attempt = 0;
  let current: { startedAt: number; reject: (error: Error) => void; run: Promise<unknown> } | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  // An attempt given up on after a reconnect; the next waits for it, so two never initialise the decoder at once.
  let abandoned: Promise<unknown> | null = null;
  const get = () => {
    if (pending) {
      return pending;
    }
    if (failedAt !== null && now() - failedAt < RETRY_AFTER_MS) {
      return Promise.resolve(null);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reject: (error: Error) => void = () => undefined;
    const timeout = new Promise<never>((_, rejectLoad) => {
      timer = setTimeout(() => rejectLoad(new Error(`no answer in ${LOAD_TIMEOUT_MS / 1000} s`)), LOAD_TIMEOUT_MS);
      reject = rejectLoad;
    });
    const startedAt = now();
    const controller = new AbortController();
    const n = attempt++;
    // An abandoned attempt may be stuck starting a worker, which nothing can stop, so it is waited for only so long.
    const run = abandoned
      ? Promise.race([abandoned, new Promise((resolve) => setTimeout(resolve, RESTART_AFTER_MS))])
        .then(() => load(n, controller.signal))
      : load(n, controller.signal);
    abandoned = null;
    const self = { startedAt, reject, run: run.catch(() => undefined) };
    current = self;
    pending = Promise.race([run, timeout])
      .then((loaded) => {
        failedAt = null;
        return loaded;
      })
      .catch((error: unknown) => {
        controller.abort();
        if (error === RESTARTED) {
          failedAt = now() - RETRY_AFTER_MS;
        } else {
          console.error(`VP8 decoder did not load; trying again in ${RETRY_AFTER_MS / 1000} s:`, error);
          failedAt = now();
        }
        pending = null;
        return null;
      })
      .finally(() => {
        clearTimeout(timer);
        if (current === self) {
          current = null;
          clearTimeout(restartTimer);
        }
      });
    return pending;
  };
  return Object.assign(get, {
    retryAt: () => (pending || failedAt === null ? null : failedAt + RETRY_AFTER_MS),
    restart: () => {
      const running = current;
      if (!running) {
        if (failedAt !== null) {
          failedAt = now() - RETRY_AFTER_MS;
        }
        return;
      }
      clearTimeout(restartTimer);
      const giveUp = () => {
        if (current === running) {
          abandoned = running.run;
          running.reject(RESTARTED);
        }
      };
      const left = running.startedAt + RESTART_AFTER_MS - now();
      if (left <= 0) {
        giveUp();
      } else {
        restartTimer = setTimeout(giveUp, left);
      }
    },
  });
}

async function webCodecsDecodesVp8(): Promise<boolean> {
  if (typeof globalThis.VideoDecoder !== 'function') {
    return false;
  }
  try {
    return (await VideoDecoder.isConfigSupported({ codec: 'vp8' })).supported === true;
  } catch {
    return false;
  }
}

type LibAVWrapper = typeof import('@libav.js/variant-webm');
type LibAVInstance = Awaited<ReturnType<LibAVWrapper['LibAV']>>;

/**
 * libav.js as the polyfill sees it: instances log errors only, and one finished after `signal`
 * aborted is stopped. Earlier ones are left alone, as they may sit in the polyfill's shared pool.
 */
export function quietLibAV(LibAV: LibAVWrapper, signal: AbortSignal): LibAVWrapper {
  return Object.create(LibAV, {
    LibAV: {
      // The polyfill passes the options through, worker or not.
      value: async (options?: Record<string, unknown>) => {
        const libav = await (LibAV.LibAV as (options?: Record<string, unknown>) => Promise<LibAVInstance>)(options);
        if (signal.aborted) {
          libav.terminate();
          throw new Error('decoder load abandoned');
        }
        await libav.av_log_set_level(libav.AV_LOG_ERROR);
        return libav;
      },
    },
  });
}

/**
 * WebCodecs where the browser has it and it decodes VP8; it is missing
 * outside a secure context, so plain-http station pages load a wasm libvpx
 * instead. libav.js's loader is fetched from libav/ next to the page at
 * runtime, not bundled, so the whole LGPL library can be swapped by
 * replacing the files there (scripts/copy-libav.mjs puts them in place).
 */
async function loadDecoderApi(attempt: number, signal: AbortSignal): Promise<DecoderApi<Frame>> {
  if (await webCodecsDecodesVp8()) {
    return {
      createDecoder: (init) => new VideoDecoder(init),
      createChunk: (init) => new EncodedVideoChunk(init),
      toBitmap: (picture) => createImageBitmap(picture),
    };
  }
  // A full URL, so neither Vite nor a sub-path deployment rewrites it.
  const base = new URL('libav', document.baseURI).href;
  // A failed module import stays cached under its URL; a retry asks for a new one.
  const loader = `${base}/libav-webm.mjs${attempt > 0 ? `?attempt=${attempt}` : ''}`;
  const { default: LibAV } = await (import(/* @vite-ignore */ loader) as Promise<{ default: LibAVWrapper }>);
  const quiet = quietLibAV(LibAV, signal);
  if (signal.aborted) {
    throw new Error('decoder load abandoned');
  }
  await polyfill.load({ polyfill: false, LibAV: quiet, libavOptions: { base } });
  return {
    createDecoder: (init) => new polyfill.VideoDecoder(init),
    createChunk: (init) => new polyfill.EncodedVideoChunk(init),
    toBitmap: (picture) => polyfill.createImageBitmap(picture),
  };
}

export const decoderApi = retryingLoader(loadDecoderApi);

/** When the wasm decoder may be loaded again after a failure; null if not waiting. */
export function decoderRetryAt(): number | null {
  return decoderApi.retryAt();
}

export const READ_RETRY_MS = 5_000;
export const READ_RETRY_MAX_MS = 60_000;

/** A read of a frame's entries failed; `reason` is what the read was rejected with. */
export class FrameReadError extends Error {
  readonly reason: unknown;

  constructor(message: string, reason: unknown) {
    super(message);
    this.reason = reason;
  }
}

/** The frame was not drawn for a reason that may pass, such as a slow decoder. */
export class FrameRetryError extends Error {}

/** The frame cannot be shown; `reason` says why, for the console. */
export class FrameMissing {
  readonly reason: string;

  constructor(reason: string) {
    this.reason = reason;
  }
}

let reader: Vp8ChainReader<Frame> | null = null;
let watched: NormFsClient | null = null;
const reconnectListeners = new Set<() => void>();

/** Calls `listener` each time the station connection is set up again; returns the unsubscribe. */
export function subscribeReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

// A load cut off with the connection can hang until LOAD_TIMEOUT_MS, so a reconnect starts it over.
function restartDecoderLoadOnReconnect(normFs: NormFsClient): void {
  if (watched !== normFs) {
    watched = normFs;
    normFs.addEventListener('__setup_response', () => {
      decoderApi.restart();
      reconnectListeners.forEach((listener) => listener());
    });
  }
}

function chainReader(normFs: NormFsClient, decoders: DecoderApi<Frame>): Vp8ChainReader<Frame> {
  reader ??= new Vp8ChainReader<Frame>(
    decoders,
    async (queue, from, count): Promise<ChainEntry[]> => {
      let entries;
      try {
        entries = await normFs.readRange(queue, idToBytes(from), count);
      } catch (error) {
        throw new FrameReadError(`reading ${count} entries of ${queue}: ${String(error)}`, error);
      }
      return entries.map((entry) => ({
        id: idFromBytes(entry.id),
        envelope: usbvideo.RxEnvelope.decode(entry.data),
      }));
    },
  );
  return reader;
}

/**
 * The exact frame at `entryId` of a VP8 entry, ready to draw; the caller
 * closes it. Null when that frame cannot be decoded.
 */
export async function decodeUsbVideoPicture(
  normFs: NormFsClient,
  queue: string,
  entryId: Uint8Array,
  envelope: usbvideo.IRxEnvelope,
): Promise<ImageBitmap | null> {
  const picture = await readUsbVideoPicture(normFs, queue, entryId, envelope);
  return picture instanceof ImageBitmap ? picture : null;
}

/** As decodeUsbVideoPicture, but says why there is no picture and whether trying again may help. */
export async function readUsbVideoPicture(
  normFs: NormFsClient,
  queue: string,
  entryId: Uint8Array,
  envelope: usbvideo.IRxEnvelope,
): Promise<ImageBitmap | FrameMissing | FrameReadError | FrameRetryError> {
  restartDecoderLoadOnReconnect(normFs);
  try {
    const decoders = await decoderApi();
    if (!decoders) {
      return new FrameMissing('VP8 decoder did not load');
    }
    const picture = await chainReader(normFs, decoders).frameAt(queue, idFromBytes(entryId), envelope);
    if (!picture) {
      return new FrameMissing('the chain back to its keyframe is broken or does not decode');
    }
    try {
      return await decoders.toBitmap(picture);
    } catch (error) {
      console.debug('VP8 frame draw failed:', error);
      return new FrameRetryError(`drawing the decoded frame failed: ${String(error)}`);
    } finally {
      // Decoders hand out a few frames at a time; holding one stalls them.
      picture.close();
    }
  } catch (error) {
    if (error instanceof FrameReadError) {
      console.debug('VP8 frame read failed:', error.message);
      return error;
    }
    if (error instanceof DecoderLateError) {
      return new FrameRetryError(error.message);
    }
    console.error('VP8 frame decode failed:', error);
    return new FrameMissing(`decode failed: ${String(error)}`);
  }
}

/** JPEG of a drawn frame, for the rare consumer that needs image bytes. */
export function canvasToJpegUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(URL.createObjectURL(blob));
      } else {
        reject(new Error('canvas has no image to encode'));
      }
    }, 'image/jpeg', 0.9);
  });
}

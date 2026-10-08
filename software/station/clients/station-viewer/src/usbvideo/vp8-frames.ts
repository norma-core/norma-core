import { usbvideo } from '@/api/proto.js';
import type { NormFsClient } from '@/api/normfs.js';
import { type ChainEntry, type DecoderApi, Vp8ChainReader, idFromBytes, idToBytes } from './vp8-chain.js';

type Frame = VideoFrame;

/** How long a failed decoder load is left alone before it is tried again. */
export const RETRY_AFTER_MS = 10_000;
/** A load still pending after this counts as failed; the wasm is 2.3 MB. */
export const LOAD_TIMEOUT_MS = 60_000;

export interface RetryingLoader<T> {
  (): Promise<T | null>;
  /** When a failed load may be tried again; null when none is waiting. */
  retryAt(): number | null;
}

/**
 * Runs `load` once and keeps its result. A load that fails or takes longer
 * than LOAD_TIMEOUT_MS gives null, logged once, and is not tried again until
 * RETRY_AFTER_MS have passed.
 */
export function retryingLoader<T>(
  load: (attempt: number) => Promise<T>,
  now: () => number = () => Date.now(),
): RetryingLoader<T> {
  let pending: Promise<T | null> | null = null;
  let failedAt: number | null = null;
  let attempt = 0;
  const get = () => {
    if (pending) {
      return pending;
    }
    if (failedAt !== null && now() - failedAt < RETRY_AFTER_MS) {
      return Promise.resolve(null);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${LOAD_TIMEOUT_MS / 1000} s`)), LOAD_TIMEOUT_MS);
    });
    pending = Promise.race([load(attempt++), timeout])
      .then((loaded) => {
        failedAt = null;
        return loaded;
      })
      .catch((error: unknown) => {
        console.error(`VP8 decoder did not load; trying again in ${RETRY_AFTER_MS / 1000} s:`, error);
        failedAt = now();
        pending = null;
        return null;
      })
      .finally(() => clearTimeout(timer));
    return pending;
  };
  return Object.assign(get, {
    retryAt: () => (pending || failedAt === null ? null : failedAt + RETRY_AFTER_MS),
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
 * WebCodecs where the browser has it and it decodes VP8; it is missing
 * outside a secure context, so plain-http station pages load a wasm libvpx
 * instead. libav.js's loader is fetched from libav/ next to the page at
 * runtime, not bundled, so the whole LGPL library can be swapped by
 * replacing the files there (scripts/copy-libav.mjs puts them in place).
 */
async function loadDecoderApi(attempt: number): Promise<DecoderApi<Frame>> {
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
  const [{ default: LibAV }, polyfill] = await Promise.all([
    import(/* @vite-ignore */ loader) as Promise<{ default: LibAVWrapper }>,
    import('libavjs-webcodecs-polyfill'),
  ]);
  // Every instance the polyfill makes passes through here, so its log level
  // goes down to errors; libav.js prints the rest to the console.
  const quiet: LibAVWrapper = Object.create(LibAV, {
    LibAV: {
      // The polyfill passes the options through, worker or not.
      value: async (options?: Record<string, unknown>) => {
        const libav = await (LibAV.LibAV as (options?: Record<string, unknown>) => Promise<LibAVInstance>)(options);
        await libav.av_log_set_level(libav.AV_LOG_ERROR);
        return libav;
      },
    },
  });
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

let reader: Vp8ChainReader<Frame> | null = null;

function chainReader(normFs: NormFsClient, decoders: DecoderApi<Frame>): Vp8ChainReader<Frame> {
  reader ??= new Vp8ChainReader<Frame>(
    decoders,
    async (queue, from, count): Promise<ChainEntry[]> => {
      const entries = await normFs.readRange(queue, idToBytes(from), count);
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
  try {
    const decoders = await decoderApi();
    if (!decoders) {
      return null;
    }
    const picture = await chainReader(normFs, decoders).frameAt(queue, idFromBytes(entryId), envelope);
    if (!picture) {
      return null;
    }
    try {
      return await decoders.toBitmap(picture);
    } finally {
      // Decoders hand out a few frames at a time; holding one stalls them.
      picture.close();
    }
  } catch (error) {
    console.error('VP8 frame decode failed:', error);
    return null;
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

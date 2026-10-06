import { frame, usbvideo } from '@/api/proto.js';
import type { NormFsClient } from '@/api/normfs.js';
import { type ChainEntry, type DecoderApi, Vp8ChainReader, idFromBytes, idToBytes, isVp8 } from './vp8-chain.js';

type Frame = VideoFrame;

/** Where scripts/copy-libav.mjs puts the decoder used without WebCodecs. */
const LIBAV_BASE = '/libav';

let api: Promise<DecoderApi<Frame>> | null = null;

/**
 * WebCodecs where the browser has it; it is missing outside a secure
 * context, so plain-http station pages load a wasm libvpx instead.
 */
function decoderApi(): Promise<DecoderApi<Frame>> {
  api ??= (async () => {
    if (typeof globalThis.VideoDecoder === 'function') {
      return {
        createDecoder: (init) => new VideoDecoder(init),
        createChunk: (init) => new EncodedVideoChunk(init),
      };
    }
    const [{ default: LibAV }, polyfill] = await Promise.all([
      import('@libav.js/variant-webm'),
      import('libavjs-webcodecs-polyfill'),
    ]);
    await polyfill.load({ polyfill: false, LibAV, libavOptions: { base: LIBAV_BASE } });
    return {
      createDecoder: (init) => new polyfill.VideoDecoder(init),
      createChunk: (init) => new polyfill.EncodedVideoChunk(init),
    };
  })();
  return api;
}

let reader: Promise<Vp8ChainReader<Frame>> | null = null;

function chainReader(normFs: NormFsClient): Promise<Vp8ChainReader<Frame>> {
  reader ??= decoderApi().then((decoders) => new Vp8ChainReader<Frame>(
    decoders,
    async (queue, from, count): Promise<ChainEntry[]> => {
      const entries = await normFs.readRange(queue, idToBytes(from), count);
      return entries.map((entry) => ({
        id: idFromBytes(entry.id),
        envelope: usbvideo.RxEnvelope.decode(entry.data),
      }));
    },
  ));
  return reader;
}

async function toJpeg(picture: Frame): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(picture.displayWidth, picture.displayHeight);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('no 2d context');
  }
  context.drawImage(picture, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * A VP8 entry as the JPEG entry the rest of the viewer draws, decoded to the
 * exact frame at `entryId`; other entries pass through. Null when that frame
 * cannot be decoded.
 */
export async function usbVideoEnvelopeAsJpeg(
  normFs: NormFsClient,
  queue: string,
  entryId: Uint8Array,
  envelope: usbvideo.RxEnvelope,
): Promise<usbvideo.RxEnvelope | null> {
  if (!isVp8(envelope)) {
    return envelope;
  }
  try {
    const picture = await (await chainReader(normFs)).frameAt(queue, idFromBytes(entryId), envelope);
    if (!picture) {
      return null;
    }
    try {
      const jpeg = await toJpeg(picture);
      const pack = envelope.frames!;
      pack.format = frame.FrameFormat.create({
        width: picture.displayWidth,
        height: picture.displayHeight,
        kind: frame.FrameFormatKind.FF_JPEG,
      });
      pack.framesData = [jpeg];
      return envelope;
    } finally {
      picture.close();
    }
  } catch (error) {
    console.error('VP8 frame decode failed:', error);
    return null;
  }
}

import { useEffect, useRef, useState } from 'react';
import type { usbvideo } from '@/api/proto.js';
import { ErrEntryNotFound, ErrQueueNotFound } from '@/api/normfs';
import webSocketManager from '@/api/websocket';
import { isVp8 } from '@/usbvideo/vp8-chain';
import {
  FrameReadError,
  READ_RETRY_MAX_MS,
  READ_RETRY_MS,
  decoderRetryAt,
  readUsbVideoPicture,
} from '@/usbvideo/vp8-frames';

// The station answered and the entries are gone; reading again cannot help.
const FINAL_READ_ERRORS: unknown[] = [ErrEntryNotFound, ErrQueueNotFound];

export type UsbVideoPicture = ImageBitmap | 'decoding' | 'missing';

/**
 * The decoded frame of a VP8 entry; undefined for entries that carry JPEG.
 * The previous frame stays up while the next one decodes, and each frame is
 * closed once it is replaced or the hook unmounts.
 */
export function useUsbVideoPicture(
  queueId: string | undefined,
  entryId: Uint8Array | undefined,
  envelope: usbvideo.IRxEnvelope,
): UsbVideoPicture | undefined {
  const vp8 = isVp8(envelope);
  const [picture, setPicture] = useState<UsbVideoPicture | undefined>(vp8 ? 'decoding' : undefined);
  const shown = useRef<ImageBitmap | null>(null);
  // Bumped when a decoder that failed to load may be tried again.
  const [retry, setRetry] = useState(0);

  useEffect(() => () => {
    shown.current?.close();
    shown.current = null;
  }, []);

  useEffect(() => {
    const show = (next: UsbVideoPicture | undefined) => {
      const previous = shown.current;
      shown.current = next instanceof ImageBitmap ? next : null;
      setPicture(next);
      if (previous && previous !== shown.current) {
        previous.close();
      }
    };

    if (!vp8) {
      show(undefined);
      return;
    }
    if (!queueId || !entryId) {
      show('missing');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!shown.current) {
      show('decoding');
    }
    const load = (failures: number) => {
      readUsbVideoPicture(webSocketManager.normFs, queueId, entryId, envelope).then((result) => {
        if (cancelled) {
          if (result instanceof ImageBitmap) {
            result.close();
          }
          return;
        }
        if (result instanceof FrameReadError) {
          if (FINAL_READ_ERRORS.includes(result.reason)) {
            show('missing');
            return;
          }
          // The entries may be readable once the connection is back.
          const delay = Math.min(READ_RETRY_MS * 2 ** failures, READ_RETRY_MAX_MS);
          timer = setTimeout(() => load(failures + 1), delay);
          return;
        }
        const retryAt = result ? null : decoderRetryAt();
        if (retryAt === null) {
          show(result ?? 'missing');
          return;
        }
        // No decoder yet, so not this frame's fault: try again once one may load.
        timer = setTimeout(() => setRetry((n) => n + 1), Math.max(0, retryAt - Date.now()));
      });
    };
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [vp8, queueId, entryId, envelope, retry]);

  // From the entry itself, so the first render after a JPEG entry does not
  // treat VP8 bytes as an image.
  return vp8 ? (picture ?? 'decoding') : undefined;
}

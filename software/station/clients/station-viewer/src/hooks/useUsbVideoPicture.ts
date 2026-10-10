import { useEffect, useRef, useState } from 'react';
import type { usbvideo } from '@/api/proto.js';
import { ErrEntryNotFound, ErrQueueNotFound } from '@/api/normfs';
import webSocketManager from '@/api/websocket';
import { idFromBytes, isVp8 } from '@/usbvideo/vp8-chain';
import {
  FrameReadError,
  FrameRetryError,
  READ_RETRY_MAX_MS,
  READ_RETRY_MS,
  RECONNECT_SPREAD_MS,
  decoderRetryAt,
  readUsbVideoPicture,
  subscribeReconnect,
} from '@/usbvideo/vp8-frames';

// The station answered and the entries are gone; reading again cannot help.
const FINAL_READ_ERRORS: unknown[] = [ErrEntryNotFound, ErrQueueNotFound];
const DECODER_RETRIES = 3;

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
    let unsubscribe: (() => void) | undefined;
    const soon = (run: () => void) => {
      clearTimeout(timer);
      timer = setTimeout(run, Math.random() * RECONNECT_SPREAD_MS);
    };
    if (!shown.current) {
      show('decoding');
    }
    const load = (failures: number, lateTries: number) => {
      readUsbVideoPicture(webSocketManager.normFs, queueId, entryId, envelope).then((result) => {
        if (cancelled) {
          if (result instanceof ImageBitmap) {
            result.close();
          }
          return;
        }
        if (result instanceof ImageBitmap) {
          show(result);
          return;
        }
        const final = result instanceof FrameReadError && FINAL_READ_ERRORS.includes(result.reason);
        // A decoder that stays late is more likely choking on the chain than slow, so it gets a few tries.
        const late = result instanceof FrameRetryError && lateTries < DECODER_RETRIES;
        if (late || (result instanceof FrameReadError && !final)) {
          // The entries may be readable once the connection is back.
          const delay = Math.min(READ_RETRY_MS * 2 ** failures, READ_RETRY_MAX_MS);
          const again = () => {
            clearTimeout(timer);
            unsubscribe?.();
            load(failures + 1, late ? lateTries + 1 : lateTries);
          };
          timer = setTimeout(again, delay);
          if (!late) {
            // A failed read is most likely the lost connection, so it goes again once that is back.
            unsubscribe = subscribeReconnect(() => soon(again));
          }
          return;
        }
        const retryAt = decoderRetryAt();
        if (retryAt === null) {
          console.warn(`VP8 frame ${idFromBytes(entryId)} of ${queueId} is not available:`,
            result instanceof FrameReadError ? `entries are gone (${String(result.reason)})`
              : result instanceof FrameRetryError ? result.message : result.reason);
          show('missing');
          return;
        }
        // No decoder yet, so not this frame's fault: try again once one may load.
        const reload = () => {
          clearTimeout(timer);
          unsubscribe?.();
          setRetry((n) => n + 1);
        };
        timer = setTimeout(reload, Math.max(0, retryAt - Date.now()));
        unsubscribe = subscribeReconnect(() => soon(reload));
      });
    };
    load(0, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [vp8, queueId, entryId, envelope, retry]);

  // From the entry itself, so the first render after a JPEG entry does not
  // treat VP8 bytes as an image.
  return vp8 ? (picture ?? 'decoding') : undefined;
}

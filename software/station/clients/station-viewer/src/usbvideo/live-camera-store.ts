import Long from 'long';
import { usbvideo } from '@/api/proto.js';
import { isVp8 } from './vp8-chain.js';

export interface LiveCameraFrame {
  sourceId: string;
  queueId: string;
  envelope: usbvideo.IRxEnvelope;
  /** JPEG bytes; empty for a VP8 frame, which comes decoded in `picture`. */
  data: Uint8Array;
  /**
   * Owned by the store and closed when the next frame replaces it, so a
   * listener draws it during the call and keeps no reference.
   */
  picture?: ImageBitmap;
  index: string | null;
}

type LiveCameraListener = (frame: LiveCameraFrame | null) => void;

const framesBySourceId = new Map<string, LiveCameraFrame>();

function setFrame(sourceId: string, frame: LiveCameraFrame | null): void {
  const previous = framesBySourceId.get(sourceId);
  if (frame) {
    framesBySourceId.set(sourceId, frame);
  } else {
    framesBySourceId.delete(sourceId);
  }
  try {
    listenersBySourceId.get(sourceId)?.forEach((listener) => {
      try {
        listener(frame);
      } catch (error) {
        console.error('Live camera listener failed:', error);
      }
    });
  } finally {
    if (previous?.picture && previous.picture !== frame?.picture) {
      previous.picture.close();
    }
  }
}
const listenersBySourceId = new Map<string, Set<LiveCameraListener>>();
const suppressedSourceIds = new Set<string>();
const watcherListeners = new Set<() => void>();

function notifyWatchers(): void {
  watcherListeners.forEach((listener) => listener());
}

/** Called whenever a camera gains or loses its last viewer, or is hidden or shown. */
export function subscribeLiveCameraWatchers(listener: () => void): () => void {
  watcherListeners.add(listener);
  return () => watcherListeners.delete(listener);
}

interface PendingPicture {
  queueId: string;
  envelope: usbvideo.IRxEnvelope;
  decode: () => Promise<ImageBitmap | null>;
}

// Bumped by a directly published frame or a clear; a decode started before it is stale.
const generationBySourceId = new Map<string, number>();
const decodingSourceIds = new Set<string>();
const queuedPictureBySourceId = new Map<string, PendingPicture>();

function invalidatePictures(sourceId: string): void {
  generationBySourceId.set(sourceId, (generationBySourceId.get(sourceId) ?? 0) + 1);
  queuedPictureBySourceId.delete(sourceId);
}

export function getLiveCameraSourceId(queueId: string, envelope: usbvideo.IRxEnvelope): string {
  return envelope.camera?.uniqueId || queueId;
}

export function createLiveCameraMetadataEnvelope(
  envelope: usbvideo.IRxEnvelope,
): usbvideo.IRxEnvelope {
  return {
    type: envelope.type,
    stamp: envelope.stamp,
    camera: envelope.camera,
    formats: envelope.formats,
    error: envelope.error,
    lastInferenceQueuePtr: envelope.lastInferenceQueuePtr,
    frames: envelope.frames
      ? {
          format: envelope.frames.format,
          stamps: envelope.frames.stamps,
        }
      : undefined,
  };
}

/** Takes ownership of `picture`, the decoded frame of a VP8 envelope. */
export function publishLiveCameraFrame(
  queueId: string,
  envelope: usbvideo.IRxEnvelope,
  picture?: ImageBitmap,
): void {
  // A VP8 envelope without its picture, like a reused snapshot entry, shows nothing.
  if (isVp8(envelope) && !picture) {
    return;
  }
  invalidatePictures(getLiveCameraSourceId(queueId, envelope));
  showFrame(queueId, envelope, picture);
}

/**
 * Shows the frame `decode` gives once it resolves. One decode runs per
 * camera; a newer frame replaces one still waiting for it.
 */
export function publishLiveCameraPicture(
  queueId: string,
  envelope: usbvideo.IRxEnvelope,
  decode: () => Promise<ImageBitmap | null>,
): void {
  const sourceId = getLiveCameraSourceId(queueId, envelope);
  if (decodingSourceIds.has(sourceId)) {
    queuedPictureBySourceId.set(sourceId, { queueId, envelope, decode });
    return;
  }
  decodingSourceIds.add(sourceId);
  const generation = generationBySourceId.get(sourceId) ?? 0;
  void decode()
    .catch(() => null)
    .then((picture) => {
      if ((generationBySourceId.get(sourceId) ?? 0) !== generation) {
        picture?.close();
      } else if (picture) {
        showFrame(queueId, envelope, picture);
      }
    })
    .catch((error) => console.error('Failed to show a decoded camera frame:', error))
    .finally(() => {
      decodingSourceIds.delete(sourceId);
      const queued = queuedPictureBySourceId.get(sourceId);
      if (queued) {
        queuedPictureBySourceId.delete(sourceId);
        publishLiveCameraPicture(queued.queueId, queued.envelope, queued.decode);
      }
    });
}

function showFrame(
  queueId: string,
  envelope: usbvideo.IRxEnvelope,
  picture?: ImageBitmap,
): void {
  const sourceId = getLiveCameraSourceId(queueId, envelope);
  if (suppressedSourceIds.has(sourceId)) {
    picture?.close();
    return;
  }

  // A VP8 frame is shown only decoded; its bytes are not an image.
  const data = isVp8(envelope)
    ? new Uint8Array()
    : envelope.frames?.framesData?.[0] ?? envelope.frames?.linearData;
  if (!picture && (!data || data.length === 0)) {
    return;
  }

  const index = envelope.stamp?.index != null
    ? Long.fromValue(envelope.stamp.index).toString()
    : null;
  setFrame(sourceId, {
    sourceId,
    queueId,
    envelope,
    data: data ?? new Uint8Array(),
    picture,
    index,
  });
}

export function getLiveCameraFrame(sourceId: string): LiveCameraFrame | null {
  return framesBySourceId.get(sourceId) ?? null;
}

export function clearLiveCameraFrame(sourceId: string): void {
  invalidatePictures(sourceId);
  setFrame(sourceId, null);
}

export function suppressLiveCameraFrame(sourceId: string): void {
  suppressedSourceIds.add(sourceId);
  clearLiveCameraFrame(sourceId);
  notifyWatchers();
}

export function isLiveCameraSuppressed(sourceId: string): boolean {
  return suppressedSourceIds.has(sourceId);
}

export function resumeLiveCameraFrame(sourceId: string): void {
  suppressedSourceIds.delete(sourceId);
  notifyWatchers();
}

export function shouldLoadLiveCameraFrame(
  queueId: string,
  previousEnvelope?: usbvideo.IRxEnvelope,
): boolean {
  // The first frame supplies the metadata needed to identify and select the
  // camera. After discovery, only mounted viewers need fresh frames.
  if (!previousEnvelope) {
    return true;
  }

  const sourceId = getLiveCameraSourceId(queueId, previousEnvelope);
  if (suppressedSourceIds.has(sourceId)) {
    return false;
  }

  return (listenersBySourceId.get(sourceId)?.size ?? 0) > 0;
}

export function subscribeLiveCameraFrame(
  sourceId: string,
  listener: LiveCameraListener,
): () => void {
  const listeners = listenersBySourceId.get(sourceId) ?? new Set<LiveCameraListener>();
  listeners.add(listener);
  listenersBySourceId.set(sourceId, listeners);
  if (listeners.size === 1) {
    notifyWatchers();
  }

  const currentFrame = getLiveCameraFrame(sourceId);
  if (currentFrame) {
    listener(currentFrame);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersBySourceId.delete(sourceId);
      notifyWatchers();
    }
  };
}

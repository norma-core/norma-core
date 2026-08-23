import Long from 'long';
import { usbvideo } from '@/api/proto.js';

export interface LiveCameraFrame {
  sourceId: string;
  queueId: string;
  envelope: usbvideo.IRxEnvelope;
  data: Uint8Array;
  index: string | null;
}

type LiveCameraListener = (frame: LiveCameraFrame | null) => void;

const framesBySourceId = new Map<string, LiveCameraFrame>();
const listenersBySourceId = new Map<string, Set<LiveCameraListener>>();
const suppressedSourceIds = new Set<string>();

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

export function publishLiveCameraFrame(
  queueId: string,
  envelope: usbvideo.IRxEnvelope,
): void {
  const sourceId = getLiveCameraSourceId(queueId, envelope);
  if (suppressedSourceIds.has(sourceId)) {
    return;
  }

  const data = envelope.frames?.framesData?.[0] ?? envelope.frames?.linearData;
  if (!data || data.length === 0) {
    return;
  }

  const index = envelope.stamp?.index != null
    ? Long.fromValue(envelope.stamp.index).toString()
    : null;
  const frame = {
    sourceId,
    queueId,
    envelope,
    data,
    index,
  };

  framesBySourceId.set(sourceId, frame);
  listenersBySourceId.get(sourceId)?.forEach((listener) => listener(frame));
}

export function getLiveCameraFrame(sourceId: string): LiveCameraFrame | null {
  return framesBySourceId.get(sourceId) ?? null;
}

export function clearLiveCameraFrame(sourceId: string): void {
  framesBySourceId.delete(sourceId);
  listenersBySourceId.get(sourceId)?.forEach((listener) => listener(null));
}

export function suppressLiveCameraFrame(sourceId: string): void {
  suppressedSourceIds.add(sourceId);
  clearLiveCameraFrame(sourceId);
}

export function resumeLiveCameraFrame(sourceId: string): void {
  suppressedSourceIds.delete(sourceId);
}

export function shouldLoadLiveCameraFrame(
  queueId: string,
  previousEnvelope?: usbvideo.IRxEnvelope,
): boolean {
  // The first frame supplies the metadata needed to identify and select the
  // camera. After discovery, only fetch fresh image data for mounted viewers.
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

  const currentFrame = getLiveCameraFrame(sourceId);
  if (currentFrame) {
    listener(currentFrame);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersBySourceId.delete(sourceId);
    }
  };
}

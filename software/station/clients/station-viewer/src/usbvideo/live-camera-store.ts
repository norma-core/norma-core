import Long from 'long';
import { usbvideo } from '@/api/proto.js';

export interface LiveCameraFrame {
  sourceId: string;
  queueId: string;
  envelope: usbvideo.IRxEnvelope;
  data: Uint8Array;
  index: string | null;
}

type LiveCameraListener = (frame: LiveCameraFrame) => void;

const framesBySourceId = new Map<string, LiveCameraFrame>();
const listenersBySourceId = new Map<string, Set<LiveCameraListener>>();

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
  const data = envelope.frames?.framesData?.[0] ?? envelope.frames?.linearData;
  if (!data || data.length === 0) {
    return;
  }

  const sourceId = getLiveCameraSourceId(queueId, envelope);
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

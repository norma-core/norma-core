import { useEffect, useState } from 'react';
import Long from 'long';
import webSocketManager from '@/api/websocket';
import { normfs, inference_tags } from '@/api/proto.js';
import {
  resolveInferenceTagEvents,
  type InferenceTagEvent,
  type TagMarker,
} from '@/utils/inference-tags';

const TAGS_QUEUE = 'inference-tags/rx';
const MAX_TAGS = 1000;

let cachedTags: Promise<TagMarker[]> | null = null;

function fetchTags(): Promise<TagMarker[]> {
  return new Promise((resolve, reject) => {
    const offset = new Uint8Array(Long.fromNumber(MAX_TAGS).toBytesLE());
    const stream = webSocketManager.normFs.read(
      TAGS_QUEUE,
      offset,
      normfs.OffsetType.OT_SHIFT_FROM_TAIL,
      MAX_TAGS,
    );

    const events: InferenceTagEvent[] = [];

    const onData = (event: Event) => {
      const readResponse = (event as CustomEvent).detail as normfs.IReadResponse;
      if (!readResponse.data) return;
      try {
        const data = readResponse.data instanceof Uint8Array
          ? readResponse.data
          : new Uint8Array(readResponse.data);
        const envelope = inference_tags.RxEnvelope.decode(data);
        if (!envelope.inferenceQueuePtr || envelope.inferenceQueuePtr.length === 0) return;
        const pointer = new Uint8Array(envelope.inferenceQueuePtr);
        const frame = Long.fromBytesLE(Array.from(pointer), true).toNumber();
        events.push({
          frame,
          pointer,
          tag: envelope.tag || '',
          removed: envelope.type === inference_tags.CommandType.CT_REMOVE_TAG,
        });
      } catch (err) {
        console.warn('[inferenceTags] failed to decode entry:', err);
      }
    };

    const onEnd = () => {
      cleanup();
      resolve(resolveInferenceTagEvents(events));
    };

    const onError = (event: Event) => {
      cleanup();
      reject((event as CustomEvent).detail);
    };

    const cleanup = () => {
      stream.removeEventListener('data', onData);
      stream.removeEventListener('end', onEnd);
      stream.removeEventListener('error', onError);
    };

    stream.addEventListener('data', onData);
    stream.addEventListener('end', onEnd);
    stream.addEventListener('error', onError);
  });
}

function loadTags(): Promise<TagMarker[]> {
  if (cachedTags === null) {
    cachedTags = fetchTags().catch((err) => {
      cachedTags = null;
      throw err;
    });
  }
  return cachedTags;
}

export function invalidateTagsCache(): void {
  cachedTags = null;
}

export function useInferenceTags(): TagMarker[] {
  const [tags, setTags] = useState<TagMarker[]>([]);

  useEffect(() => {
    let cancelled = false;

    const tryLoad = () => {
      if (cancelled) return;
      if (!webSocketManager.isConnected()) {
        window.setTimeout(tryLoad, 100);
        return;
      }
      loadTags()
        .then((t) => {
          if (!cancelled) setTags(t);
        })
        .catch((err) => {
          console.error('Failed to load inference tags:', err);
        });
    };

    tryLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  return tags;
}

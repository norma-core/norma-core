/** Queue-backed GNSS state, independent of frame sampling.
 *
 * The live frame pipeline delivers only the newest rx envelope at whatever
 * rate frames get processed, so the widget used to see roughly one in every
 * few dozen epochs — and the once-a-second GSV satellite burst almost
 * never. This store reads the rx queue itself: once a second it catches up
 * on every entry since the last one processed and folds each epoch into
 * cumulative state via mergeNmeaBatch, so nothing the receiver reports is
 * lost between frames.
 */

import Long from 'long';
import { useCallback, useSyncExternalStore } from 'react';

import { arduino_pro_4g_gnss, normfs } from '@/api/proto.js';
import webSocketManager from '@/api/websocket';
import { planCatchUp } from './catch-up';
import { decodeBatchText, mergeNmeaBatch, type GnssState } from './values';

const NMEA_BATCH =
  arduino_pro_4g_gnss.ArduinoPro4gGnssSignalType.ARDUINO_PRO_4G_GNSS_NMEA_BATCH;

/** GSV bursts arrive once a second; catching up at the same cadence
 * processes every epoch while adding only one small read per second. */
const CATCH_UP_INTERVAL_MS = 1000;

function idToNumber(raw: Uint8Array): number {
  return Long.fromBytesLE(Array.from(raw)).toNumber();
}

function numberToId(value: number): Uint8Array {
  return new Uint8Array(Long.fromNumber(value).toBytesLE());
}

interface QueueEntry {
  id: number;
  data: Uint8Array;
}

function readRange(queueId: string, startId: number, count: number): Promise<QueueEntry[]> {
  return new Promise((resolve, reject) => {
    const stream = webSocketManager.normFs.read(
      queueId,
      numberToId(startId),
      normfs.OffsetType.OT_ABSOLUTE,
      count,
    );
    const entries: QueueEntry[] = [];

    const onData = (event: Event) => {
      const response = (event as CustomEvent).detail as normfs.IReadResponse;
      if (response.data && response.id?.raw) {
        entries.push({ id: idToNumber(response.id.raw as Uint8Array), data: response.data });
      }
    };
    const onError = (event: Event) => {
      cleanup();
      reject((event as CustomEvent).detail);
    };
    const onEnd = () => {
      cleanup();
      resolve(entries);
    };
    const cleanup = () => {
      stream.removeEventListener('data', onData);
      stream.removeEventListener('error', onError);
      stream.removeEventListener('end', onEnd);
    };

    stream.addEventListener('data', onData);
    stream.addEventListener('error', onError, { once: true });
    stream.addEventListener('end', onEnd, { once: true });
  });
}

interface GnssLiveSlot {
  state: GnssState | null;
  lastProcessedId: number | null;
  listeners: Set<() => void>;
  timer: number | null;
  busy: boolean;
}

const slots = new Map<string, GnssLiveSlot>();

function getSlot(queueId: string): GnssLiveSlot {
  let slot = slots.get(queueId);
  if (!slot) {
    slot = { state: null, lastProcessedId: null, listeners: new Set(), timer: null, busy: false };
    slots.set(queueId, slot);
  }
  return slot;
}

async function catchUp(queueId: string): Promise<void> {
  const slot = getSlot(queueId);
  if (slot.busy) {
    return;
  }
  slot.busy = true;
  try {
    let lastId: number;
    try {
      const last = await webSocketManager.normFs.readLastEntry(queueId);
      lastId = idToNumber(last.id);
    } catch {
      return; // Queue empty or connection down; try again next tick.
    }

    const range = planCatchUp(slot.lastProcessedId, lastId);
    if (!range) {
      return;
    }

    let entries: QueueEntry[];
    try {
      entries = await readRange(queueId, range.startId, range.count);
    } catch {
      // The window's oldest entries may have been evicted; skip forward so
      // the next tick reads only fresh data instead of erroring forever.
      slot.lastProcessedId = lastId;
      return;
    }

    let state = slot.state;
    for (const entry of entries.sort((a, b) => a.id - b.id)) {
      let envelope: arduino_pro_4g_gnss.RxEnvelope;
      try {
        envelope = arduino_pro_4g_gnss.RxEnvelope.decode(entry.data);
      } catch {
        continue;
      }
      if (envelope.signalType === NMEA_BATCH) {
        state = mergeNmeaBatch(state, decodeBatchText(envelope.data));
      }
    }
    slot.lastProcessedId = lastId;
    if (state !== slot.state) {
      slot.state = state;
      for (const listener of slot.listeners) {
        listener();
      }
    }
  } finally {
    slot.busy = false;
  }
}

export function subscribeGnssLive(queueId: string, listener: () => void): () => void {
  const slot = getSlot(queueId);
  slot.listeners.add(listener);
  if (slot.timer === null) {
    void catchUp(queueId);
    slot.timer = window.setInterval(() => void catchUp(queueId), CATCH_UP_INTERVAL_MS);
  }
  return () => {
    slot.listeners.delete(listener);
    if (slot.listeners.size === 0 && slot.timer !== null) {
      window.clearInterval(slot.timer);
      slot.timer = null;
    }
  };
}

export function getGnssLiveState(queueId: string): GnssState | null {
  return slots.get(queueId)?.state ?? null;
}

export function useGnssLive(queueId: string): GnssState | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeGnssLive(queueId, listener),
    [queueId],
  );
  const getSnapshot = useCallback(() => getGnssLiveState(queueId), [queueId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

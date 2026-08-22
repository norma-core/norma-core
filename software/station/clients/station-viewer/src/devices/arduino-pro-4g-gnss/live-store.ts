/** Queue-backed GNSS state, independent of frame sampling.
 *
 * The live frame pipeline delivers only the newest rx envelope at whatever
 * rate frames get processed, so the widget used to see roughly one in every
 * few dozen epochs — and the once-a-second GSV satellite burst almost
 * never. This store reads the rx queue itself: once a second it catches up
 * on every entry since the last one processed and folds each epoch into
 * cumulative state via mergeNmeaBatch, so nothing the receiver reports is
 * lost between frames.
 *
 * Beyond NMEA it also captures the driver's Connected/Disconnected/Error
 * signals and XTRA assistance injections, and stamps when the last epoch
 * arrived — so the widget can tell "live", "no fix", and "stream dead"
 * apart instead of freezing on the last good numbers.
 */

import Long from 'long';
import { useCallback, useSyncExternalStore } from 'react';

import { arduino_pro_4g_gnss, normfs } from '@/api/proto.js';
import webSocketManager from '@/api/websocket';
import { detectQueueReset, planCatchUp } from './catch-up';
import { decodeBatchText, mergeNmeaBatch, type GnssState } from './values';

const SIGNAL = arduino_pro_4g_gnss.ArduinoPro4gGnssSignalType;

/** GSV bursts arrive once a second; catching up at the same cadence
 * processes every epoch while adding only one small read per second. */
const CATCH_UP_INTERVAL_MS = 1000;

/** The stream runs at 10 Hz and catch-up at 1 Hz, so anything beyond a
 * few seconds without an epoch means the stream is down. */
export const STREAM_STALE_AFTER_MS = 5000;

export interface GnssLiveSnapshot {
  values: GnssState | null;
  /** When the newest NMEA epoch was recorded — the envelope's own device
   * timestamp, not browser receive time: a page that backfills after a
   * reboot must not present minutes-old epochs as seconds fresh. */
  lastEpochAtMs: number | null;
  /** Browser-clock ms when new entries last arrived; staleness detection
   * uses this so a skewed device clock cannot fake or mask an outage. */
  lastMergeAtMs: number | null;
  /** Latest driver connection signal; null until one is observed. */
  connected: boolean | null;
  connectionError: string | null;
  /** Last observed gpsOneXTRA assistance injection, if any was seen. */
  xtraValidityMinutes: number | null;
  xtraInjectedAtMs: number | null;
}

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

/** The envelope's device wall-clock stamp in ms; browser receive time is
 * only a fallback for envelopes without one. */
function envelopeStampMs(envelope: arduino_pro_4g_gnss.RxEnvelope): number {
  const stampNs = envelope.localStampNs;
  if (stampNs && Long.fromValue(stampNs).greaterThan(0)) {
    return Long.fromValue(stampNs).divide(1_000_000).toNumber();
  }
  return Date.now();
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
  snapshot: GnssLiveSnapshot;
  lastProcessedId: number | null;
  listeners: Set<() => void>;
  timer: number | null;
  busy: boolean;
}

function emptySnapshot(): GnssLiveSnapshot {
  return {
    values: null,
    lastEpochAtMs: null,
    lastMergeAtMs: null,
    connected: null,
    connectionError: null,
    xtraValidityMinutes: null,
    xtraInjectedAtMs: null,
  };
}

const slots = new Map<string, GnssLiveSlot>();

function getSlot(queueId: string): GnssLiveSlot {
  let slot = slots.get(queueId);
  if (!slot) {
    slot = {
      snapshot: emptySnapshot(),
      lastProcessedId: null,
      listeners: new Set(),
      timer: null,
      busy: false,
    };
    slots.set(queueId, slot);
  }
  return slot;
}

function notify(slot: GnssLiveSlot): void {
  for (const listener of slot.listeners) {
    listener();
  }
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
      markStaleTick(slot);
      return; // Queue empty or connection down; try again next tick.
    }

    if (detectQueueReset(slot.lastProcessedId, lastId)) {
      // Station data was wiped or the queue recreated: start over.
      slot.lastProcessedId = null;
      slot.snapshot = emptySnapshot();
      notify(slot);
    }

    const range = planCatchUp(slot.lastProcessedId, lastId);
    if (!range) {
      markStaleTick(slot);
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

    const next: GnssLiveSnapshot = { ...slot.snapshot };
    let changed = false;
    for (const entry of entries.sort((a, b) => a.id - b.id)) {
      let envelope: arduino_pro_4g_gnss.RxEnvelope;
      try {
        envelope = arduino_pro_4g_gnss.RxEnvelope.decode(entry.data);
      } catch {
        continue;
      }
      switch (envelope.signalType) {
        case SIGNAL.ARDUINO_PRO_4G_GNSS_NMEA_BATCH:
          next.values = mergeNmeaBatch(next.values, decodeBatchText(envelope.data));
          next.lastEpochAtMs = envelopeStampMs(envelope);
          next.lastMergeAtMs = Date.now();
          changed = true;
          break;
        case SIGNAL.ARDUINO_PRO_4G_GNSS_CONNECTED:
          next.connected = true;
          next.connectionError = null;
          changed = true;
          break;
        case SIGNAL.ARDUINO_PRO_4G_GNSS_DISCONNECTED:
          next.connected = false;
          next.connectionError = envelope.error || null;
          changed = true;
          break;
        case SIGNAL.ARDUINO_PRO_4G_GNSS_ERROR:
          next.connectionError = envelope.error || null;
          changed = true;
          break;
        case SIGNAL.ARDUINO_PRO_4G_GNSS_XTRA_INJECTED:
          next.xtraValidityMinutes = envelope.xtraValidityMinutes || null;
          next.xtraInjectedAtMs = envelopeStampMs(envelope);
          changed = true;
          break;
      }
    }
    slot.lastProcessedId = lastId;
    if (changed) {
      slot.snapshot = next;
      notify(slot);
    }
  } finally {
    slot.busy = false;
  }
}

/** While the stream is down the snapshot's age keeps growing; rebuild it
 * each tick so subscribers re-render the age readout. */
function markStaleTick(slot: GnssLiveSlot): void {
  const { lastMergeAtMs } = slot.snapshot;
  if (lastMergeAtMs === null) {
    return;
  }
  if (Date.now() - lastMergeAtMs > STREAM_STALE_AFTER_MS) {
    slot.snapshot = { ...slot.snapshot };
    notify(slot);
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

export function getGnssLiveSnapshot(queueId: string): GnssLiveSnapshot {
  return getSlot(queueId).snapshot;
}

export function useGnssLive(queueId: string): GnssLiveSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeGnssLive(queueId, listener),
    [queueId],
  );
  const getSnapshot = useCallback(() => getGnssLiveSnapshot(queueId), [queueId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

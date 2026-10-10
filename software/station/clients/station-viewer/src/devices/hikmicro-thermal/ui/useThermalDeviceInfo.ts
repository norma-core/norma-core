import { useEffect, useMemo, useState } from 'react';
import type { hikmicro } from '@/api/proto.js';
import { ErrEntryNotFound, ErrQueueNotFound } from '@/api/normfs';
import webSocketManager from '@/api/websocket';
import { DeviceInfoLoader, ThermalDeviceInfoCache } from '../live-stream';

const cache = new ThermalDeviceInfoCache();
/** The last session record loaded from a device-info queue. */
export const latestDeviceInfo = (queue: string) => cache.latestFor(queue);
const isMissing = (error: unknown) => error === ErrEntryNotFound || error === ErrQueueNotFound;

/** Fills in the session's device info for records that carry only a reference to it. */
export function useThermalDeviceInfo<T extends hikmicro.IRxEnvelope | null>(envelope: T): T {
  const ref = envelope && !envelope.deviceInfo ? envelope.deviceInfoRef : null;
  const queue = ref?.queue ?? '';
  const id = ref?.id?.length ? ref.id : null;
  const idKey = id ? id.join(',') : '';
  const exact = queue && id ? cache.get(queue, id) : undefined;
  const missing = Boolean(queue && id && !exact);
  const [, setLoaded] = useState(0);

  useEffect(() => {
    if (!missing || !id) return;
    const loader = new DeviceInfoLoader(cache, webSocketManager.normFs, queue, id, () => setLoaded(n => n + 1), isMissing);
    let connected = webSocketManager.getConnectionStats().status === 'connected';
    const unsubscribe = webSocketManager.subscribeConnectionStats(() => {
      const now = webSocketManager.getConnectionStats().status === 'connected';
      if (now && !connected) loader.retryNow();
      connected = now;
    });
    return () => {
      loader.dispose();
      unsubscribe();
    };
  // oxlint-disable-next-line react/exhaustive-deps -- `id` is a new array every frame; idKey is its value.
  }, [queue, idKey, missing]);

  // After a reconnect, the camera's previous record stands in until the new one loads.
  const info = exact ?? (queue ? cache.latestFor(queue) : undefined);
  return useMemo(() => (envelope && info ? { ...envelope, deviceInfo: info } : envelope) as T, [envelope, info]);
}

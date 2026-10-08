import { useEffect, useMemo, useState } from 'react';
import type { hikmicro } from '@/api/proto.js';
import { ErrEntryNotFound, ErrQueueNotFound } from '@/api/normfs';
import webSocketManager from '@/api/websocket';
import { ThermalDeviceInfoCache } from '../live-stream';

const cache = new ThermalDeviceInfoCache();
const RETRY_MS = 1000;

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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      cache.load(webSocketManager.normFs, queue, id).then(info => {
        if (!cancelled && info) setLoaded(n => n + 1);
      }, (error: unknown) => {
        if (cancelled || error === ErrEntryNotFound || error === ErrQueueNotFound) return;
        timer = setTimeout(attempt, RETRY_MS);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  // oxlint-disable-next-line react/exhaustive-deps -- `id` is a new array every frame; idKey is its value.
  }, [queue, idKey, missing]);

  // After a reconnect, the camera's previous record stands in until the new one loads.
  const info = exact ?? (queue ? cache.latestFor(queue) : undefined);
  return useMemo(() => (envelope && info ? { ...envelope, deviceInfo: info } : envelope) as T, [envelope, info]);
}

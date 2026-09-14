import { useEffect, useState } from 'react';
import type { hikmicro } from '@/api/proto.js';
import webSocketManager from '@/api/websocket';
import { ThermalLiveStream } from '../live-stream';

export function useThermalLiveStream(queueId?: string): hikmicro.IRxEnvelope | null {
  const [snapshot, setSnapshot] = useState<{ queueId: string; data: hikmicro.IRxEnvelope } | null>(null);
  useEffect(() => {
    if (!queueId) return;
    const stream = new ThermalLiveStream(webSocketManager.normFs, queueId, data => setSnapshot({ queueId, data }));
    const sync = () => {
      const connection = webSocketManager.getConnectionStats();
      stream.setEnabled(document.visibilityState !== 'hidden'
        && connection.status === 'connected' && connection.acquisitionMode === 'live');
    };
    const unsubscribe = webSocketManager.subscribeConnectionStats(sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      stream.dispose();
      unsubscribe();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [queueId]);
  return snapshot && snapshot.queueId === queueId ? snapshot.data : null;
}

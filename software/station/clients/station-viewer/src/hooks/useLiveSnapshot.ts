import { useSyncExternalStore } from 'react';
import webSocketManager, { type LiveSnapshot } from '@/api/websocket';

export function useLiveSnapshot(): LiveSnapshot {
  return useSyncExternalStore(
    webSocketManager.subscribeLive,
    webSocketManager.getLiveSnapshot,
    webSocketManager.getLiveSnapshot,
  );
}

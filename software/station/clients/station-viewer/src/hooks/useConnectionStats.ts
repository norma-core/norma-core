import { useSyncExternalStore } from 'react';
import webSocketManager, { type ConnectionStats } from '@/api/websocket';

export function useConnectionStats(): ConnectionStats {
  return useSyncExternalStore(
    webSocketManager.subscribeConnectionStats,
    webSocketManager.getConnectionStats,
    webSocketManager.getConnectionStats,
  );
}

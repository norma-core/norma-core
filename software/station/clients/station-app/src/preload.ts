import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('stationDesktop', {
  backendUrl: 'ws://127.0.0.1:8889/api',
  isDesktop: true,
} satisfies StationDesktopAPI);

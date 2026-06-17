/** Keep in sync with station-viewer/src/desktop.d.ts. */
/** Desktop API injected by Electron preload (contextBridge). */
interface StationDesktopAPI {
  backendUrl: string;
  isDesktop: true;
}

interface Window {
  stationDesktop?: StationDesktopAPI;
}

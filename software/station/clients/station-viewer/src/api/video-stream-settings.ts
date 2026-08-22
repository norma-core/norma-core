/** Client-side video pause: when on, the live pipeline skips fetching
 * camera frame payloads entirely (see parseFrame), so no camera bytes
 * cross the link and sensor entries arrive at full rate. Persisted per
 * browser; cameras on the station keep capturing and recording. */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'station-viewer.video-paused';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let paused = readStored();
const listeners = new Set<() => void>();

export function isVideoPaused(): boolean {
  return paused;
}

export function setVideoPaused(value: boolean): void {
  if (paused === value) {
    return;
  }
  paused = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Per-browser convenience only; the toggle still works for the session.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeVideoPaused(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVideoPaused(): boolean {
  return useSyncExternalStore(subscribeVideoPaused, isVideoPaused, isVideoPaused);
}

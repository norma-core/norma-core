/**
 * Detect if the app is running inside Electron (file:// protocol)
 * vs. a regular web browser (http:// or https://).
 */
export function isElectron(): boolean {
  return window.location.protocol === 'file:';
}

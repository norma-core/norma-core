// The wasm VP8 decoder is used only where WebCodecs is missing (plain-http
// pages); libav.js loads it by URL, so it is served from public/libav.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules/@libav.js/variant-webm/dist');
const notices = path.join(root, 'third-party/libav.js');
const to = path.join(root, 'public/libav');

mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  // The non-threaded wasm build only: threads need cross-origin isolation.
  if (/^libav-[\d.]+-webm\.wasm\.(mjs|wasm)$/.test(name)) {
    copyFileSync(path.join(from, name), path.join(to, name));
  }
}
// LGPL-2.1: the license and where the source is travel with the library.
for (const name of readdirSync(notices)) {
  copyFileSync(path.join(notices, name), path.join(to, name));
}

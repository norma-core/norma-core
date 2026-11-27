// The wasm VP8 decoder is used only where WebCodecs is missing (plain-http
// pages). libav.js and its loader are served from public/libav, not bundled,
// so they stay separate files that can be replaced (third-party/libav.js).
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules/@libav.js/variant-webm/dist');
const notices = path.join(root, 'third-party/libav.js');
const to = path.join(root, 'public/libav');

// A build output: cleared so files of another libav.js version do not linger.
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const copied = [];
for (const name of readdirSync(from)) {
  // The loader and the non-threaded wasm build only: threads need
  // cross-origin isolation.
  if (name === 'libav-webm.mjs' || /^libav-[\d.]+-webm\.wasm\.(mjs|wasm)$/.test(name)) {
    copyFileSync(path.join(from, name), path.join(to, name));
    copied.push(name);
  }
}
const kinds = ['libav-webm.mjs', '.wasm.mjs', '.wasm.wasm'];
const missing = kinds.filter((kind) => !copied.some((name) => name.endsWith(kind)));
if (missing.length > 0) {
  throw new Error(`libav.js files missing from ${from}: ${missing.join(', ')}`);
}
// LGPL-2.1: the license and where the source is travel with the library.
for (const name of readdirSync(notices)) {
  copyFileSync(path.join(notices, name), path.join(to, name));
}

# libav.js (VP8 decoder fallback)

Station Viewer decodes VP8 camera frames with the browser's WebCodecs. Where
WebCodecs is missing or cannot decode VP8 (a page opened over plain http), it
loads a WebAssembly build of FFmpeg's libraries instead:

- Package: `@libav.js/variant-webm` 6.10.9 (libav.js v6.10.9.0), unmodified
- License: LGPL-2.1 (FFmpeg) with BSD, MIT and other component licenses; the
  full texts as shipped in the package are in `LICENSES.txt`, the LGPL-2.1
  alone in `LGPL-2.1.txt`
- Source: https://github.com/Yahweasel/libav.js, tag `v6.10.9.0`
  (commit c80e885c3461f7bb7ea565c9631b34243ae0dbf1); its README describes
  building a variant
- Loaded through `libavjs-webcodecs-polyfill` 0.5.5 (0BSD)

No part of libav.js is bundled into Station Viewer's code. Its loader and its
library are separate files served from `/libav/` (`libav-webm.mjs`,
`libav-6.10.9.0-webm.wasm.mjs` and `libav-6.10.9.0-webm.wasm.wasm`) and
fetched only when needed.

## Replacing it

- In a running station: put the replacement files under the same names in
  `<dir>/libav/` and start station with `--static-path <dir>`; station then
  serves them in place of the ones built into it. Station serves its own
  versioned files (`libav-6.10.9.0-*`) as cacheable for a year, so a browser
  that already loaded them keeps them until its cache is cleared; a rebuilt
  library with its own version in the file names avoids that.
- In a build: point the `@libav.js/variant-webm` dependency in `package.json`
  at the modified or rebuilt package, then run `npm install` and
  `npm run build`, which copies the files from `node_modules` into
  `public/libav/` (replacing what was there), and rebuild station, which
  embeds the viewer's `dist/`. A version other than 6.10.9.0 also changes the
  wasm file names; the loader picks its own.

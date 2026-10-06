# libav.js (VP8 decoder fallback)

Station Viewer decodes VP8 camera frames with the browser's WebCodecs. Where
WebCodecs is missing (a page opened over plain http), it loads a WebAssembly
build of FFmpeg's libraries instead:

- Package: `@libav.js/variant-webm` 6.10.9 (libav.js v6.10.9.0), unmodified
- License: LGPL-2.1 (FFmpeg) with BSD, MIT and other component licenses; the
  full texts as shipped in the package are in `LICENSES.txt`, the LGPL-2.1
  alone in `LGPL-2.1.txt`
- Source: https://github.com/Yahweasel/libav.js, tag `v6.10.9.0`
  (commit c80e885c3461f7bb7ea565c9631b34243ae0dbf1); its README describes
  building a variant
- Loaded through `libavjs-webcodecs-polyfill` 0.5.5 (0BSD)

The library is not linked into Station Viewer's code. It is served as
separate files from `/libav/` (`libav-6.10.9.0-webm.wasm.mjs` and
`libav-6.10.9.0-webm.wasm.wasm`) and fetched only when needed.

## Replacing it

To use a modified or rebuilt libav.js webm variant, put its
`libav-<version>-webm.wasm.mjs` and `.wasm.wasm` in `public/libav/` under
the same names (or change the version in `package.json` and run
`npm run build:libav`), then rebuild the viewer with `npm run build` and the
station binary, which embeds the viewer's `dist/`.

# @normacore/station-app

Self-contained desktop app for NormaCore Station. Electron shell, bundled station-viewer UI, and bundled Rust station backend.

## Quick Start

```bash
# prereqs: node >=22, npm >=11, Rust toolchain, cargo, station backend dependencies
npm ci
npm run install:electron   # required: .npmrc sets ignore-scripts=true, so Electron's
                           # postinstall (which downloads the platform binary) is skipped
                           # during `npm ci` and must be run explicitly. Re-run after
                           # any change to the `electron` dependency version.

# dev mode — loads Vite dev server (start station-viewer and station manually)
cd ../station-viewer && npm run build && npm run dev          # terminal 1
cd ../../bin/station && RUST_LOG=info cargo run -- --tcp 8888 --web 8889  # terminal 2
cd software/station/clients/station-app && npm run dev        # terminal 3 (opens Electron → localhost:5173)
# or use `npm run dev:tools` in terminal 3 to open Electron with DevTools

# local production preview — builds station-viewer + station backend, then loads dist via file://
npm run start
```

## Build & Package

```bash
npm run build          # generate station version + tsc → dist/
npm run build:viewer   # builds ../station-viewer → ../station-viewer/dist
npm run build:station  # cargo build --release --package=station → ../../../../target/release/station
npm run package:mac    # builds viewer + station + app, then electron-builder → release/
npm run package        # same, all configured platforms
```

## Architecture

```
station-app (Electron)
  ├─ starts bundled station backend (resources/bin/station)
  └─ loads bundled station-viewer (resources/station-viewer-dist/index.html)
       ↓ connects
     ws://127.0.0.1:8889/api
```

- **Dev:** Electron → `http://localhost:5173` (Vite HMR). Backend is expected to be started separately. Because this path uses `http://`, it exercises the web router/assets path; use `npm run start` or packaged builds to exercise the Electron `file://` path.
- **Local production preview:** Electron starts `../../../../target/release/station` and loads `../station-viewer/dist/index.html` (`file://`) via `npm run start`.
- **Packaged app:** Electron starts `process.resourcesPath/bin/station` and loads `process.resourcesPath/station-viewer-dist/index.html` (`file://`).
- **Router:** Auto-detects `file://` → `HashRouter`, otherwise `BrowserRouter`.
- **Backend URL:** Injected via `window.stationDesktop.backendUrl` (preload bridge), currently `ws://127.0.0.1:8889/api`.
- **Data/config:** bundled backend runs with cwd at Electron `userData`; `station_data/` and `station.yaml` live there.

## Files

```
src/
  main.ts       # Electron main process; starts/stops station backend in production modes
  preload.ts    # contextBridge — exposes stationDesktop API
  types.d.ts    # TS declarations
build/
  icon.icns     # macOS icon
  icon.ico      # Windows icon
  icon.png      # Linux icon
scripts/
  generate-version.mjs  # mirrors station-viewer __STATION_VERSION__ generation
```

## Config

Backend defaults to `ws://127.0.0.1:8889/api` and NormFS TCP to `127.0.0.1:8888`. Override later via config persistence / free port selection (Phase 3).

## Stack

- Electron 41
- TypeScript 5.9
- electron-builder
- Rust station backend

# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Electron code: `main.ts` manages the app window and bundled backend process, `preload.ts` exposes the desktop bridge, and `types.d.ts` holds shared TS declarations. `scripts/generate-version.mjs` writes the generated version constant used at build time. `build/` stores platform icons, `dist/` is the TypeScript output, and `release/` is created by `electron-builder`. This package depends on sibling projects: `../station-viewer` for the UI bundle and the Rust `station` package at the repo root.

## Platform Support
Only macOS and Linux are supported for packaging and distribution. Windows is not currently supported.

- `npm run package:mac` and `npm run package:linux` are the only working packaging commands.
- `electron-builder.yml` defines no `win:` target and the `extraResources` filter only matches the `station` binary (not `station.exe`).
- While `main.ts` contains a `win32` branch for the backend binary name, no Windows packaging or signing configuration exists.

## Build, Test, and Development Commands
Use Node `>=22` and npm `>=11`.

- `npm ci` installs dependencies.
- `npm run install:electron` downloads the Electron binary because install scripts are skipped by default.
- `npm run dev` builds TS and launches Electron against the viewer dev server.
- `npm run dev:tools` does the same with DevTools enabled.
- `npm run build` regenerates version metadata and compiles TS into `dist/`.
- `npm run start` builds the viewer and Rust backend, then runs the local production-style app.
- `npm run package` or `npm run package:mac|linux` creates distributables in `release/`.
- `npm run lint` runs `oxlint src/`; `npm run type-check` runs `tsc --noEmit`.

## Coding Style & Naming Conventions
Follow the existing TypeScript style: 2-space indentation, semicolons, single quotes, and explicit `type` imports where useful. Keep Electron entry points small and split helper logic into named functions. Use `camelCase` for variables/functions, `PascalCase` for types, and `SCREAMING_SNAKE_CASE` for module-level constants such as `BACKEND_SHUTDOWN_TIMEOUT_MS`.

## Testing Guidelines
There is no dedicated automated test suite in this package yet. Treat `npm run lint` and `npm run type-check` as the minimum verification gate for every change. For runtime changes, also exercise `npm run dev` for the `localhost` path and `npm run start` for the bundled `file://` path.

## Commit & Pull Request Guidelines
Recent history uses conventional prefixes such as `feat:`, `chore(...)`, and `deps(...)`. Keep commit subjects imperative and scoped when helpful, for example `chore(station-app): update Electron packaging`. PRs should describe user-visible behavior, list verification commands, link the relevant issue, and include screenshots when window chrome, menus, or load flows change.

## Security & Configuration Tips
Do not hardcode secrets in Electron code or preload bridges. Keep the backend URL and spawned process behavior aligned with `station-viewer`, and re-check packaged-path assumptions before changing anything under `process.resourcesPath` or user data storage.

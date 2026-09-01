# AGENTS.md

Project-specific guidance for AI coding agents working on Station Viewer.

## Commands

```bash
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # Hashes, protobuf, type-check, and production build
npm run build:proto  # Regenerate bindings from ../../../../../protobufs
npm run lint         # oxlint
npm run type-check   # TypeScript without emit
npm test             # Vitest once
npm run test:watch   # Vitest watch mode
npm run preview      # Preview production output
```

## Verification

- Keep Vitest tests beside the implementation as `*.test.ts`; tests run in Node unless they declare another environment.
- Test plausible regressions through public interfaces. Prefer ownership, cleanup, async ordering, state transitions, and non-trivial domain rules over coverage targets.
- Mock only true system seams such as WebSocket, browser APIs, and time. Do not test private helpers, types, constants, CSS classes, static markup, or snapshots merely to detect change.
- For bug fixes, reproduce the failure before fixing it.
- For responsive UI changes, exercise mobile portrait, mobile landscape in a normal browser tab, and desktop. Interact with affected controls; screenshots alone are insufficient.
- Run tests, type-check, lint, and build in proportion to the change.

## Stack and Structure

The client uses React 19, strict TypeScript, Vite 7, Tailwind CSS 4, React Router 7, protobuf.js, Three.js, and Vitest. State is owned by React hooks and external stores; there is no general state-management library.

```text
src/
  api/          # Transport, protobuf, NormFS, commands, frame decoding
  components/   # Shared UI and history presentation
  hooks/        # React adapters and reusable UI state
  live/         # Live-module interface, discovery, composition, host surface
  modules/      # Product, hardware, protocol, and physical-model modules
  pages/        # Route components
  utils/        # Cross-module utilities
public/devices/ # URDF and STL assets keyed by physical-model ID
```

## Frontend Modules

Concrete product and hardware knowledge belongs in `src/modules/<module-id>/`. Use stable product names such as `rover` and `dogzilla`; do not name product modules after their current implementation combination.

`src/live/live-registry.ts` discovers `src/modules/*/live.ts`. The directory name is the module ID, so `live.ts` must not repeat it. Adapters load eagerly for validation; React views load lazily.

### Normal Live Adapter

Use `live()` when one `FrameEntry` field supplies `{ data }`:

```typescript
import { live } from '@/live/define-live-module';

export default live({
  label: 'New Sensor',
  layout: 'card',
  field: 'newSensor',
  loadView: () => import('./ui/NewSensorLiveView'),
});
```

Use `customLive()` only when the view needs custom props or multiple frame fields. Declare all presented fields with `frameFieldClaims(...)`; keep `select(frame)` pure and return only stable keys and props. See `src/modules/st3215/live.ts` for a concrete example.

### Layouts

- `card` — small block in the responsive grid.
- `section` — full-width normal-flow block; the default.
- `feature` — dominant content, optionally paired with a card sidebar.
- `screen` — complete operator interface with edge-to-edge mobile spacing.

Layout controls placement only. It does not determine ownership or conflict priority.

### Rules

- Module directories use kebab-case. `order` is optional and defaults to zero; ordering is `order`, module ID, then view key.
- Every `live.ts` must default-export `live(...)` or `customLive(...)`; the contract test discovers and verifies all current and future adapters.
- Do not edit a registration list or teach `HomePage` about concrete modules, frame fields, layouts, or claims.
- `live()` derives its frame claim. A custom adapter declares every presented field; it must not name competing module IDs. On overlap, the adapter with more claims wins, then lower `order`, then module ID.
- View keys are non-empty and unique within a module. Use `queueId` for repeated driver entries.
- `select(frame)` has no hooks, JSX, I/O, timers, mutation, subscriptions, or side effects.
- Use `when(data)` only to suppress an empty but valid entry. Use `customLive()` when props differ from `{ data }`.
- Add `LIVE_TRAIT_REALTIME` only when the module supplies the active realtime stream. Do not add product-specific booleans to `LiveModule` or `LivePlan`.
- Keep adapters small. Put UI in `ui/` and module-only commands, parsing, and formatting beside it. Do not add pass-through view wrappers.
- Selection and lazy-render failures are isolated by the live host; do not catch them in `HomePage`.

### Adding a Module

1. If the queue type is new, update backend/protobuf definitions and normalized `Frame` decoding first.
2. Add `src/modules/<module-id>/live.ts` and colocate its lazy UI and module-only implementation.
3. Add a physical-model adapter only when needed; keep it separate from live presentation.
4. Test live selection through `resolveLiveModules(frame)` and physical models through their registry interface.
5. Do not edit `HomePage`, `LiveSurface`, or a central registration list.

[ADR 0005](docs/adr/0005-live-device-modules-as-vertical-slices.md) records the live-module decision. [ADR 0006](docs/adr/0006-keep-live-and-physical-model-registries-separate.md) covers ST3215 physical-model resolution, and [ADR 0010](docs/adr/0010-centralize-frame-decoding-before-device-presentation.md) keeps frame decoding outside presentation.

### ST3215 Physical Models

`src/modules/st3215/model-registry.ts` discovers `src/modules/*/st3215-model.ts` independently of live adapters.

- Model `id` and `motorCount` are globally unique.
- `matchesBus` may narrow the motor-count match but cannot bypass it.
- Unsupported buses resolve explicitly; there is no first-model fallback.
- Shared ST3215 implementation may query the registry but must not import concrete models.
- Model-specific URDF paths, transforms, joints, materials, and kinematic quirks stay in the physical-model module.

## Code Conventions

### Imports and Formatting

- Prefer `@/*` aliases outside a module's own directory. Order imports as external, `@/api`, `@/components`, `@/hooks`, `@/live`, `@/modules`, then types.
- Some ESM imports require `.js`, notably generated protobuf imports; follow the surrounding file.
- Use 2-space indentation and semicolons. Generated `src/api/proto.*` files are excluded from linting.

### Naming

| Entity | Convention | Example |
| --- | --- | --- |
| Components | PascalCase | `BusViewer` |
| Pages | PascalCase + `Page` | `HistoryPage` |
| Hooks | `use` + camelCase | `useFrameData` |
| Utilities | kebab-case filename | `queue-utils.ts` |
| Functions and variables | camelCase | `selectFrame` |
| Constants | UPPER_SNAKE_CASE | `WS_EVENTS` |
| Interfaces and types | PascalCase | `LivePlan` |
| Props | PascalCase + `Props` | `BusViewerProps` |
| Error singletons | `Err` prefix | `ErrNotConnected` |
| Generated protobuf interfaces | `I` prefix | `st3215.IInferenceState` |

### React and State

- Use function components and default component exports. Define props directly above the component.
- Use `memo()` for expensive or frequently rerendered views and `forwardRef()` only for a real imperative interface.
- Route components use the `Page` suffix and load lazily.
- Complex hooks return separate `state` and `actions`; simple hooks return a value or flat object.
- Import hooks through `@/hooks`; hook implementations import sibling hooks directly to avoid barrel cycles.
- Use `useSyncExternalStore` for long-lived managers. Snapshot getters must preserve object identity until state changes and publish related values atomically.
- Clean up listeners, timers, subscriptions, animation frames, and browser resources in effects.
- Keep UI state in its owning page or module; do not turn transport snapshots into a general application store.

## Transport and Protobuf

- `frame-parser.ts` owns queue decoding into the normalized `Frame`; live selectors remain synchronous and pure.
- Use generated `I...` protobuf interfaces for plain values and generated classes for `create`, `encode`, and `decode`.
- Run `npm run build:proto` after changing protobuf definitions.
- Send commands through the shared command manager rather than creating transport clients in views.
- WebSocket live and connection-statistics snapshots are separate atomic stores. The manager initializes through the side-effect import in `main.tsx`.
- The dev server proxy target is configured in `vite.config.ts`.

## Assets and Build

- Put URDF/STL files in `public/devices/<model-id>/`.
- Run `node scripts/generate-asset-hashes.mjs` after changing public model assets.
- `npm run build:hashes` generates `src/assets-manifest.json` for cache busting.
- `__STATION_VERSION__` is defined at build time from the workspace version and git hash.
- Production output is gzip-compressed by Vite.

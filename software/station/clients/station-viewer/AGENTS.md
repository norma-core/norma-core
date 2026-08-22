# AGENTS.md

Guidelines for AI coding agents operating in this React/TypeScript project.

## Commands

```bash
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Full build: hashes, proto, type-check, and Vite build
npm run build:proto  # Regenerate protobuf bindings from ../../../../../protobufs
npm run lint         # Run oxlint (Rust-based linter)
npm run type-check   # Run TypeScript compiler without emitting
npm test             # Run Vitest once
npm run test:watch   # Run Vitest in watch mode
npm run preview      # Preview production build locally
```

## Testing

Vitest runs in the Node environment. Keep tests beside the module as `*.test.ts`.

Tests are regression guards, not a coverage target. Before adding a test, name the plausible bug it should catch. Prioritize behavior with a history of failure, async races, ownership or cleanup boundaries, atomic external-store updates, and non-trivial domain rules. A small set of tests around these risks is preferable to exhaustive coverage of trivial branches.

Exercise behavior through public interfaces and assert caller-visible outcomes. Tests must survive an internal refactor that preserves behavior. Mock only true system boundaries when necessary, such as WebSocket, browser APIs, or time; use real Station Viewer modules together whenever practical. Avoid tests that mirror implementation steps, test private helpers, merely restate types, or assert mock call counts unless the count itself is part of the public contract.

Do not add tests whose only purpose is to detect a change to an exported constant, lookup-table entry, CSS class, static markup fragment, or snapshot. In particular, do not pass an exported constant into a function and assert the same literal value, and do not render a component only to search its HTML for implementation classes. These tests are change detectors, not regression guards. When configuration data drives non-trivial behavior, test the public properties and boundaries that matter to a caller—such as clamping, monotonicity, safety limits, state transitions, or derived outputs—rather than copying every configured value into the test.

For a bug fix, first demonstrate that the test fails for the broken behavior, then make it pass. If a test cannot be connected to a realistic regression, do not add it.

For responsive UI changes, do not commit after checking only one viewport. Verify the affected flow in mobile portrait, mobile landscape, and desktop layouts. Mobile landscape must also be checked in a normal browser tab, not only in element fullscreen, because browser chrome reduces the available height. Exercise the changed controls at each relevant size; a screenshot alone is not sufficient for interactive behavior such as dragging, tapping, or pointer capture.

## Tech Stack

- **React 19** with function components only
- **TypeScript 5.9** with strict mode enabled
- **Vite 7** for bundling (supports top-level await, URDF/STL assets)
- **Tailwind CSS v4** with @tailwindcss/vite plugin
- **Three.js** for 3D rendering (URDF robot visualization)
- **Protobuf.js** for binary protocol communication
- **React Router v7** for routing with lazy-loaded pages
- **oxlint** for linting (fast Rust-based linter)
- **lucide-react** for icons
- **urdf-loader** for loading URDF robot models
- **nosleep.js** for screen wake lock

## Project Structure

```
src/
  api/            # WebSocket, protobuf, time sync, queue, normfs, commands, clipboard, frame parsing
  components/     # Shared UI components
    history/      # History page detail views (ExpandedView, HistoryElement, etc.)
  hooks/          # Custom React hooks (re-exported from index.ts)
  live/           # Live-module authoring interface, discovery, composition, and host surface
  modules/        # Product, hardware, protocol, and physical-model vertical modules
  pages/          # Route components (suffixed with Page)
  utils/          # Shared utilities (asset-hashes, format-bytes, tag-phrases)
public/
  devices/        # Device URDF models and STL assets, keyed by device id
```

## Frontend Modules

Concrete product, hardware, and protocol code lives under `src/modules/<module-id>/`. A frontend module is a vertical slice: its live adapter, module-only UI, protocol/formatting helpers, commands, and model-specific code live together. Use stable product names such as `rover` and `dogzilla` instead of implementation combinations such as `vesc-pwm-output-control`. `HomePage` must never import a concrete module.

The live mechanism and its concrete modules are separated deliberately:

```
src/live/
  define-live-module.ts   # live()/customLive(), layout profiles, claims, and traits
  live-registry.ts        # discovers live adapters and resolves a LivePlan
  LiveSurface.tsx         # layout composition, lazy rendering, and error isolation
src/modules/
  <module-id>/
    live.ts               # optional live adapter; module ID comes from the directory
    ui/                   # lazy device UI
    values.ts             # device-only parsers/formatters when needed
    commands.ts           # device-only commands when needed
    st3215-model.ts       # optional ST3215 robot-model manifest
  st3215/
    define-model.ts       # st3215Model() authoring factory and model contract
    model-registry.ts     # discovers and resolves ST3215 robot models
```

Do not recreate a general plugin framework. Live UI, ST3215 robot models, history, decoding, configuration, and actions are separate concerns. Introduce another seam only when it has a real caller and at least two concrete adapters.

### Live Modules

`live-registry.ts` discovers `src/modules/*/live.ts` using Vite's bundled `import.meta.glob`. The directory name is the module ID, so do not repeat `id` in `live.ts`. **Never edit a central registration list and never import a concrete module from `HomePage`.** An adapter is eagerly loaded, but its UI must be loaded lazily.

Use `live()` for the normal case: the data lives in one `Frame` field whose value is either one `FrameEntry` or an array of entries. The factory normalizes single/multiple entries, uses `queueId` as the stable key, supplies the typed `{ data }` prop, creates the lazy React element, and claims that frame field for presentation.

```typescript
import { live } from '@/live/define-live-module';

export default live({
  label: 'New Sensor',
  order: 40,
  layout: 'card',
  field: 'newSensor',
  when: (data) => data.readings?.length > 0,
  loadView: () => import('./ui/NewSensorLiveView'),
});
```

The UI prop must match the factory convention:

```typescript
export interface NewSensorLiveViewProps {
  data: new_sensor.IRxEnvelope;
}
```

Use `customLive()` only when `{ data }` is insufficient—for example, ST3215 also needs video and mirroring state. Declare every frame field presented by the module with `frameFieldClaims(...)`. Its `select(frame)` must be pure: no hooks, I/O, mutations, JSX, timers, or subscriptions. It returns only stable keys and typed props; the factory owns lazy rendering.

```typescript
import { customLive, frameFieldClaims } from '@/live/define-live-module';

export default customLive<NewViewerProps>({
  label: 'New Device',
  order: 40,
  claims: frameFieldClaims('newDevice', 'videoQueues'),
  select: (frame) => {
    const data = frame.newDevice?.data;
    return data ? [{ key: 'new-device', props: { data, videos: frame.videoQueues } }] : [];
  },
  loadView: () => import('./ui/NewDeviceViewer'),
});
```

Rules and invariants:

- The directory name is the stable module ID and must use kebab-case. `order` is an optional display hint; duplicates are valid and omitted values default to zero. Ordering is deterministic: `order`, then module ID, then entry key.
- A view key must be non-empty and unique within its module. Use `queueId` for multi-instance driver entries.
- Use one of the four host-owned layout profiles, ordered by visual scale: `card` for a small grid block, the default `section` for a full-width block in normal page flow, `feature` for the page's dominant content with an optional card sidebar, or `screen` for a complete edge-to-edge operator interface. Product names are not layout profiles.
- Claims describe the frame data a module presents. `live()` derives its claim. A custom module must use `frameFieldClaims(...)`; it must not name other module IDs. Layout does not determine claim ownership: the module with more claims wins an overlap, with `order` and then ID breaking ties.
- Use `when(data)` only to suppress an empty but valid entry. If the view needs different props or shared frame data, use `customLive()` instead.
- Add `traits: [LIVE_TRAIT_REALTIME]` only when the module supplies the active realtime stream. Traits are the extensible capability mechanism; do not add product-specific booleans to `LiveModule` or `LivePlan`.
- Selection and lazy-render failures are isolated to the affected module. Do not catch them in `HomePage`.
- Cameras are a normal module under `src/modules/usb-video/`. `HomePage` must not inspect concrete frame fields, import concrete views, or arbitrate ownership between products.
- Do not add wrappers that only render another component with identical props. They fail the deletion test; import the shared implementation directly from `live.ts`. In particular, do not add a `St3215LiveView` pass-through around `BusViewer`.
- Keep live adapters small. Heavy React UI belongs in `ui/`, and module-only formatting, commands, or parser code stays beside the adapter rather than in generic `src/utils/`.

### ST3215 Robot Models

`src/modules/st3215/model-registry.ts` is independent from the live registry. Shared ST3215 code stays under `src/modules/st3215/` and contains protocol handling and generic rendering. Concrete URDF paths, transforms, joint names, material mapping, and kinematic quirks belong to the physical model module.

Register a model through `st3215Model()`:

```typescript
import { st3215Model } from '@/modules/st3215/define-model';

export default st3215Model({
  id: 'new-model',
  label: 'New Model',
  motorCount: 7,
  kinematics: {
    urdfPath: 'devices/new-model/robot.urdf',
    basePos: [0, 0, 0],
    baseRpy: [0, 0, 0],
    jointNames: ['joint-1', 'joint-2'],
  },
  loadRenderer: () => import('./Renderer'),
});
```

Rules and invariants:

- `id` and `motorCount` are globally unique. The normalized-joint renderer has only joint count as its identity, so two models with the same count are ambiguous and rejected at startup.
- The factory owns the default motor-count match. Add `matchesBus` only for an additional discriminator; it cannot bypass the motor-count requirement.
- There is no implicit “first model” fallback. An unsupported bus or joint count must render the explicit unsupported state.
- Do not duplicate `id`, `label`, or `motorCount` inside `kinematics`.
- Shared ST3215 implementation may ask `model-registry.ts` whether a bus is supported, but must not import a concrete model.

### Adding or Extending a Module

1. Add the backend/protobuf queue type and `Frame` decoding when the driver itself is new. The current module system owns live presentation, not frame decoding.
2. Create `src/modules/<module-id>/live.ts`; use `live()` unless shared frame data makes `customLive()` necessary. Do not repeat the module ID in the adapter and do not edit `HomePage`, `LiveSurface`, or a registration list.
3. Put module-only UI under `ui/` and supporting implementation beside it.
4. For a physical ST3215 robot, add `st3215-model.ts`, `Renderer.tsx`, config, and public assets in the same model directory.
5. Put URDF/STL files in `public/devices/<device-id>/`, then run `node scripts/generate-asset-hashes.mjs` so `src/assets-manifest.json` includes them.
6. Test through the public seams: `resolveLiveModules(frame)` for live selection and `resolveSt3215Model(bus)` / `resolveSt3215Kinematics(count)` for robot models. Do not test factory internals or rendering past the module interface.

History rendering remains in `HistoryPage` / `HistoryElement` / `ExpandedView`. When history and decoding are deliberately migrated, introduce a real history/decoder seam with multiple module adapters; do not add speculative optional fields to live adapters now.

## Code Style

### Imports
Use `@/*` path aliases. Order: external deps → `@/api/*` → `@/components/*` → `@/hooks` → types.

Some internal imports use `.js` extensions (required for ESM module resolution):

```typescript
import { forwardRef, memo, useImperativeHandle, useRef } from 'react';
import Long from 'long';
import webSocketManager from '@/api/websocket';
import { serverToLocal } from '@/api/timestamp-utils';
import { st3215 } from '@/api/proto.js';
import Timeline from '@/components/Timeline';
import { useFrameData, useTimelineState } from '@/hooks';
```

### Formatting & Linting
- 2-space indentation, semicolons required
- `src/api/proto.*` files are auto-generated and excluded from linting
- oxlint enforces rules (see `.oxlintrc.json`)

### Naming Conventions

| Entity | Convention | Example |
|--------|------------|---------|
| Components | PascalCase | `TimelineControls`, `BusViewer` |
| Page components | PascalCase + Page suffix | `HomePage`, `HistoryPage` |
| Hooks | camelCase with `use` prefix | `useTimelineState`, `useFrameData` |
| Utilities | kebab-case filenames | `queue-utils.ts`, `time-sync.ts` |
| Variables/functions | camelCase | `currentFrame`, `selectFrame` |
| Constants | UPPER_SNAKE_CASE | `WS_EVENTS`, `DEFAULT_TIMEOUT` |
| Interfaces | PascalCase | `TimelineState`, `ConnectionStats` |
| Props interfaces | PascalCase + Props suffix | `TimelineProps`, `BusViewerProps` |
| Error singletons | Err prefix | `ErrNotConnected`, `ErrBufferFull` |
| Protobuf interfaces | I prefix (from codegen) | `web.IClientPacket`, `st3215.IInferenceState` |

## Component Patterns

### Function Components
Two accepted patterns:

**Pattern 1 — Explicit memo + forwardRef** (used for complex/re-rendered components):
```typescript
interface TimelineControlsProps {
  state: TimelineState;
  actions: TimelineActions;
  frameStep?: number;
}

const TimelineControlsComponent = forwardRef<TimelineControlsRef, TimelineControlsProps>(
  function TimelineControls({ state, actions, frameStep = 1 }: TimelineControlsProps, ref) {
    // ...
  }
);

const TimelineControls = memo(TimelineControlsComponent);
TimelineControls.displayName = 'TimelineControls';
export default TimelineControls;
```

**Pattern 2 — React.FC** (used for simpler components):
```typescript
const MainLayout: React.FC = () => {
  // ...
};
export default MainLayout;
```

**Pattern 3 — Inline memo** (alternative shorthand):
```typescript
const BusViewer = memo(function BusViewer({ ... }: BusViewerProps) {
  // ...
});
export default BusViewer;
```

Conventions:
- Use function components only
- All components use default exports
- Define props interfaces directly above the component
- Use `memo()` for components with complex props that re-render frequently (e.g., timeline components)
- Use `forwardRef` when exposing imperative handles
- Route components are lazy-loaded: `const HomePage = lazy(() => import('./pages/HomePage'));`

## Routes

```typescript
// MainLayout wraps Home and History pages
<Route path="/" element={<MainLayout><HomePage /></MainLayout>} />
<Route path="/history" element={<MainLayout><HistoryPage /></MainLayout>} />

// Standalone pages
<Route path="/st3215-bus-calibration" element={<St3215BusCalibrationPage />} />
<Route path="/st3215-bind-motors" element={<St3215MotorConfigPage />} />
```

## Hook Patterns

### State/Actions Pattern
Complex stateful hooks return separate state and actions objects:

```typescript
export interface UseTimelineStateReturn {
  state: TimelineState;
  actions: TimelineActions;
}

export function useTimelineState(): UseTimelineStateReturn {
  const [currentFrame, setCurrentFrame] = useState(0);
  // ...
  
  const state = useMemo(() => ({
    currentFrame,
    range,
    isLoading,
    error,
  }), [currentFrame, range, isLoading, error]);

  const actions = useMemo(() => ({
    selectFrame,
    nextFrame,
    prevFrame,
  }), [selectFrame, nextFrame, prevFrame]);

  return { state, actions };
}
```

Simpler hooks return plain values or flat objects. For example, `useInferenceState` returns `Frame | null`, while `useFrameData({ frameNumber, immediate })` returns `{ parsedFrame, isLoading, error }`; timeline state is the sole owner of the selected frame number.

### External Stores and Effect Cleanup

Use `useSyncExternalStore` for state owned by long-lived managers. Snapshot getters must return the same object reference until the underlying state changes, and related values must be published atomically. `WebSocketManager` exposes the canonical live and connection-statistics snapshots; do not mirror them into hook-local `useState`.

For component-owned effects, always clean up event listeners, timers, and subscriptions:

```typescript
useEffect(() => {
  const handler = () => setIsFullscreen(document.fullscreenElement === elementRef.current);
  document.addEventListener('fullscreenchange', handler);
  return () => document.removeEventListener('fullscreenchange', handler);
}, []);
```

### Hook Exports
All hooks are re-exported from `src/hooks/index.ts`:
```typescript
export { useInferenceState } from "./useInferenceState";
export { useLatestEntryId } from "./useLatestEntryId";
export { useLiveSnapshot } from "./useLiveSnapshot";
export { useConnectionStats } from "./useConnectionStats";
export { useElapsedSeconds } from "./useElapsedSeconds";
export { useFrameData } from "./useFrameData";
export { useQueueEntries } from "./useQueueEntries";
export { useTimelineState } from "./useTimelineState";
export { useStartupMarkers } from "./useStartupMarkers";
export { useInferenceTags, invalidateTagsCache } from "./useInferenceTags";
export { useKeyboardNavigation } from "./useKeyboardNavigation";
export { useWakeLock } from "./useWakeLock";
export { useBusMonitor } from "./useBusMonitor";
export { useElementFullscreen } from "./useElementFullscreen";
export { ThemeProvider, useTheme } from "./useTheme";
// Plus hook-owned type exports: Theme, TimelineControlsRef, UseWakeLockReturn, BusStatus, ErrorPacketDump
```

Modules outside `src/hooks/` import hooks through `@/hooks`. Hook implementations import sibling hooks directly rather than through the barrel, which avoids a cycle from `index.ts` back into the implementation being exported.

## Error Handling

### Module-Level Error Singletons
```typescript
export const ErrNotConnected = new Error("client not connected or setup not complete");
export const ErrBufferFull = new Error("client request buffer is full");
export const ErrRequestTimeout = new Error("request timed out waiting for server response");
```

### Async Error Handling
```typescript
try {
  const result = await fetchData();
  setError(null);
  return result;
} catch (err) {
  console.error('Failed to fetch data:', err);
  setError(err instanceof Error ? err.message : 'Unknown error');
  return null;
}
```

## Protobuf Patterns

- Use `IInterface` (with I prefix) for plain objects passed as parameters
- Use `Class` for static methods (create, encode, decode)

```typescript
public send(packet: web.IClientPacket) {
  const clientPacket = web.ClientPacket.create(packet);
  const buffer = web.ClientPacket.encode(clientPacket).finish();
  this.ws.send(buffer);
}
```

Run `npm run build:proto` after modifying .proto files.

## State Management

State is managed through custom hooks, not global state libraries. WebSocket events drive stable immutable snapshots exposed to React through `useSyncExternalStore`. Global managers are exported as default singletons:

```typescript
const webSocketManager = new WebSocketManager(`ws://${host}/api`);
export default webSocketManager;
```

The live snapshot contains the frame and latest entry ID as one atomic observation. Connection statistics use a separate snapshot. Keep local UI state in the owning page or device view; do not turn these transport snapshots into a general application store. See `docs/adr/README.md` for the accepted decisions and invariants.

The WebSocket manager is initialized at app startup via side-effect import in `main.tsx`:
```typescript
import './api/websocket.ts';
```

## WebSocket Configuration

The dev server proxies `/api` to the robot backend. Update `vite.config.ts` to change the target:

```typescript
proxy: {
  '/api': {
    target: 'ws://localhost:8889',
    ws: true,
    changeOrigin: false,
  }
}
```

## Build Notes

- `npm run build:hashes` generates `src/assets-manifest.json` for cache-busting (used by `src/utils/asset-hashes.ts`)
- `__STATION_VERSION__` global is defined at build time (workspace version + git hash) — declared in `vite-env.d.ts`, used in `Navigation.tsx`
- Vite is configured with `vite-plugin-compression` for gzip output

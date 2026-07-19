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

For a bug fix, first demonstrate that the test fails for the broken behavior, then make it pass. If a test cannot be connected to a realistic regression, do not add it.

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
  api/            # WebSocket, protobuf, time sync, normfs, commands, clipboard, generic frame parsing
  components/     # Shared UI components
    history/      # Generic history shells and byte/JSON presentation
  devices/        # Device queues, history/live adapters, UI, and ST3215 model manifests
  hooks/          # Custom React hooks (re-exported from index.ts)
  pages/          # Route components (suffixed with Page)
  st3215/         # Motor driver components, utilities, and robot renderers
    robot-rendering/ # Shared ST3215 URDF/Three.js rendering host and base renderer
  usbvideo/       # Camera/video stream components
  utils/          # Shared utilities (asset-hashes, format-bytes, tag-phrases)
public/
  devices/        # Device URDF models and STL assets, keyed by device id
```

## Device Modules

Concrete device code lives under `src/devices/<device-id>/`. A device directory is a vertical slice: protocol decoding, history/live adapters, device-only UI, formatting helpers, commands, and model-specific assets live together. Shared shells discover adapters; they do not enumerate concrete devices. `HomePage` may import queue declarations when it deliberately combines entries (currently `usbVideoQueue` for the shared standalone camera surface), but must not import concrete device UI or manifests.

The shared implementation is deliberately split into separate deep modules with different interfaces:

```
src/devices/
  live.ts                 # live()/customLive() authoring factories
  live-registry.ts        # discovers live manifests and resolves a LiveDevicePlan
  LiveDeviceSurface.tsx   # lazy rendering, slots, and error isolation
  queue-adapter.ts        # typed queue-adapter interface and identity-keyed Frame store
  queue-adapter-registry.ts # discovers queue declarations and resolves queue type/id
  history.tsx             # typed history-adapter authoring factory
  history-registry.ts     # discovers history adapters by queue identity
  st3215-model.ts         # st3215Model() authoring factory and model contract
  st3215-models.ts        # discovers and resolves ST3215 robot models
  <device-id>/
    queue.ts              # one queue declaration or a small queue array
    module.ts             # one live-module manifest
    history.tsx           # optional summary/expanded/JSON history adapter
    ui/                   # lazy device UI
    values.ts             # device-only parsers/formatters when needed
    commands.ts           # device-only commands when needed
    st3215-model.ts       # optional ST3215 robot-model manifest
```

Do not recreate a general plugin framework. Live UI, ST3215 robot models, history, decoding, configuration, and actions are separate concerns. Introduce another seam only when it has a real caller and at least two concrete adapters.

### Live Device Modules

`live-registry.ts` discovers `src/devices/*/module.ts` using Vite's bundled `import.meta.glob`. **Never edit a central registration list and never import a concrete module from `HomePage`.** A manifest is eagerly loaded, but its UI must be loaded lazily.

Use `live()` for the normal case. The factory selects entries through the typed queue identity, uses `queueId` as the stable key, supplies typed `{ data }`, and creates the lazy React element.

```typescript
import { live } from '@/devices/live';
import { newSensorQueue } from './queue';

export default live({
  id: 'new-sensor',
  label: 'New Sensor',
  order: 40,
  slot: 'summary',
  queue: newSensorQueue,
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

Use `customLive()` only when `{ data }` is insufficient—for example, ST3215 also needs video and mirroring state. Its `select(frame)` must be pure: no hooks, I/O, mutations, JSX, timers, or subscriptions. It returns only stable keys and typed props; the factory owns lazy rendering.

```typescript
import { customLive } from '@/devices/live';

export default customLive<NewViewerProps>({
  id: 'new-device',
  label: 'New Device',
  order: 40,
  embedsCameraFeed: true,
  select: (frame) => {
    const data = frame.devices.entryOf(newDeviceQueue)?.data;
    const videos = frame.devices.entriesOf(usbVideoQueue).map((entry) => entry.data);
    return data ? [{ key: 'new-device', props: { data, videos } }] : [];
  },
  loadView: () => import('./ui/NewDeviceViewer'),
});
```

Rules and invariants:

- `id` is globally unique across live manifests. Equal `order` values are allowed; display order is deterministic: `order`, then `id`, then entry key.
- A view key must be non-empty and unique within its module. Use `queueId` for multi-instance driver entries.
- `slot: 'summary'` renders compact cards in the shared sensor grid; the default `primary` slot renders full-width device UI. Do not add ad-hoc layout strings.
- Use `when(data)` only to suppress an empty but valid entry. If the view needs different props or shared frame data, use `customLive()` instead.
- Set `isRealtime: true` only for a device that actually supplies the active realtime stream. The resolved plan uses this capability to decide whether to show connection FPS.
- Set `embedsCameraFeed: true` when a selected primary view renders the current USB camera feed itself. The resolved plan then suppresses the shared standalone camera surface without teaching `HomePage` about that concrete device.
- Selection and lazy-render failures are isolated to the affected device. Render failures retry when the device receives new resolved content; do not catch them in `HomePage`.
- Do not add wrappers that only render another component with identical props. They fail the deletion test; import the shared implementation directly from the manifest. In particular, do not add a `St3215LiveView` pass-through around `BusViewer`.
- Keep module manifests small. Heavy React UI belongs in `ui/`, and device-only formatting, commands, or parser code stays beside that manifest rather than in generic `src/utils/`.

### ST3215 Robot Models

`st3215-models.ts` is independent from the live-device registry. Shared ST3215 code stays under `src/st3215/` and contains only protocol handling and generic rendering. Concrete URDF paths, transforms, joint names, material mapping, and kinematic quirks belong to the physical model directory.

Register a model through `st3215Model()`:

```typescript
import { st3215Model } from '@/devices/st3215-model';

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
- Shared ST3215 components may ask `st3215-models.ts` whether a bus is supported, but must not import a concrete model.

### Adding or Extending a Device

1. Add the `.proto` and append its `QueueDataType` in `protobufs/station/drivers.proto`, then run `npm run build:proto`.
2. Add `src/devices/<device-id>/queue.ts` with `defineQueueAdapter({ key, message, queueType, cardinality })`. Use `matchQueue` only to disambiguate adapters that share a queue type. Keep `decode` pure; device side effects belong in the explicit `afterDecode` hook.
3. Create `module.ts` with `live({ queue, ... })`; use `customLive()` only when the view needs inputs from multiple queues.
4. Add `history.tsx` with `defineHistory({ queue, Summary?, loadExpanded?, toJson? })`. Expanded UI is collapsed by default, lazy, and receives one typed `entry`; generic JSON/raw history works without an adapter. Use `defaultExpanded: true` only for a deliberately cheap view that should mount immediately.
5. Put device-only UI and helpers under the device directory. For a physical ST3215 robot, also add its model manifest and assets.
6. Test queue matching/parser behavior and selection through public seams. Run type-check, lint, tests, and the production build; the build validates both eager globs and lazy history imports.

Queue declarations are protocol adapters and may be imported by readers and composition code. Concrete UI, live manifests, and history adapters remain discoverable implementation details and must not be imported by shared shells.

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

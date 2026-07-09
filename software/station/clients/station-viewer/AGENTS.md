# AGENTS.md

Guidelines for AI coding agents operating in this React/TypeScript project.

## Commands

```bash
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Full build: hashes, proto, type-check, and Vite build
npm run build:proto  # Regenerate protobuf bindings from ../../../../../protobufs
npm run lint         # Run oxlint (Rust-based linter)
npm run type-check   # Run TypeScript compiler without emitting
npm run preview      # Preview production build locally
```

**Testing:** Not configured. No test runner exists in this project.

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
  devices/        # Concrete device modules, live registry, ST3215 model manifests
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

Concrete device code lives under `src/devices/<device-id>/`. The live page discovers bundled TypeScript device modules via `src/devices/registry.ts`; do not import concrete devices directly from `HomePage` or shared protocol layers.

### Live Device Modules

Add a `src/devices/<device-id>/module.ts` file for each live device family. Keep the manifest small and eager-loadable; put heavy React UI under `ui/` and load it lazily through `live.loadView`.

```typescript
import type { DeviceModule } from '@/devices/types';
import type { NewDeviceViewerProps } from './ui/NewDeviceViewer';

const newDeviceModule = {
  id: 'new-device',
  label: 'New Device',
  order: 30,
  live: {
    select: ({ frame, videoSources }) => {
      const data = frame.new_device?.data;
      if (!data) return [];

      return [{
        key: 'new-device',
        props: { data, videoSources },
      }];
    },
    loadView: () => import('./ui/NewDeviceViewer'),
  },
} satisfies DeviceModule<NewDeviceViewerProps>;

export default newDeviceModule;
```

`live.select(...)` is a pure selector: no hooks, no JSX, no side effects. It only maps the current `Frame` into `LiveDeviceView` descriptors. `DeviceLiveHost` handles lazy React rendering.

History rendering remains wired through the existing `HistoryPage` / `HistoryElement` / `ExpandedView` path. Add a history seam only when that path is migrated to real module adapters.

### ST3215 Robot Models

Shared ST3215 code stays under `src/st3215/`. Keep this layer about the bus/protocol and reusable UI/rendering shell:

- motor parsing and ST3215 command helpers
- bus cards, bus viewer, calibration page, mirroring controls
- generic motor tables and camera overlays
- generic robot rendering host/base renderer in `src/st3215/robot-rendering/`

Concrete ST3215 robot models live under `src/devices/<model-id>/` and export `st3215-model.ts`:

```typescript
import type { St3215RobotModelModule } from '@/devices/types';
import { NEW_MODEL_MOTOR_COUNT, newModelKinematics } from './config';

const newModel = {
  id: 'new-model',
  label: 'New Model',
  order: 30,
  motorCount: NEW_MODEL_MOTOR_COUNT,
  matches: (bus) => (bus.motors?.length ?? 0) === NEW_MODEL_MOTOR_COUNT,
  kinematics: newModelKinematics,
  loadRenderer: () => import('./Renderer'),
} satisfies St3215RobotModelModule;

export default newModel;
```

Do not import concrete ST3215 models from `src/st3215/`. Use the registry/model interfaces and keep concrete URDF paths, joint names, transforms, material mapping, and kinematic quirks beside the model.

When adding a new physical device or ST3215 model:

1. Create `src/devices/<device-id>/module.ts` for live device UI, or `src/devices/<model-id>/st3215-model.ts` for an ST3215 robot model.
2. Put device-only React UI under `src/devices/<device-id>/ui/`.
3. Put URDF/STL files in `public/devices/<device-id>/`.
4. Run `node scripts/generate-asset-hashes.mjs` from this package so `src/assets-manifest.json` includes new asset paths.

Avoid hard-coding concrete device names, motor counts, URDF paths, or joint mappings in shared ST3215 components. Use the registry or device module config instead.

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

Simpler hooks return plain values or flat objects (e.g., `useInferenceState` returns `Frame | null`, `useFrameData` returns `{ currentFrame, parsedFrame, isLoading, ... }`).

### useEffect Cleanup
Always clean up event listeners, timers, and subscriptions:

```typescript
useEffect(() => {
  const handler = () => setStats(webSocketManager.getConnectionStats());
  webSocketManager.addEventListener(WS_EVENTS.STATS, handler);
  return () => webSocketManager.removeEventListener(WS_EVENTS.STATS, handler);
}, []);
```

### Hook Exports
All hooks are re-exported from `src/hooks/index.ts` (11 hooks + 3 types):
```typescript
export { useInferenceState } from "./useInferenceState";
export { useLatestEntryId } from "./useLatestEntryId";
export { useConnectionStats, useConnectionStatsWithUptime } from "./useConnectionStats";
export { useFrameData } from "./useFrameData";
export { useQueueEntries } from "./useQueueEntries";
export { useTimelineState } from "./useTimelineState";
export { useStartupMarkers } from "./useStartupMarkers";
export { useInferenceTags, invalidateTagsCache } from "./useInferenceTags";
export { useKeyboardNavigation } from "./useKeyboardNavigation";
export { useWakeLock } from "./useWakeLock";
export { useBusMonitor } from "./useBusMonitor";
// Plus type exports: TimelineControlsRef, UseWakeLockReturn, BusStatus, ErrorPacketDump
```

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

State is managed through custom hooks, not global state libraries. WebSocket events drive state updates via EventTarget. Global managers are exported as default singletons:

```typescript
const webSocketManager = new WebSocketManager(`ws://${host}/api`);
export default webSocketManager;
```

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

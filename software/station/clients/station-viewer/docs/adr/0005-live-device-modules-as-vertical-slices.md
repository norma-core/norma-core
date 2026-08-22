# ADR 0005: Organize live presentation as composable vertical modules

- Date: 2026-07-12
- Amended: 2026-08-23

## Context

Station Viewer presents data from sensors, cameras, individual devices, and composite
operator experiences such as Rover. Adding each view directly to `HomePage` would make
the page depend on every protocol-specific implementation and require a central edit for
every extension.

The first live-module interface removed those imports, but composite views exposed a
second form of coupling. Rover needed `ownsCameras`, `isImmersive`, and `replaces`; each
new boolean widened the former `LiveDeviceAdapter` and `LiveDevicePlan`, the catalog,
and `HomePage`.
Dogzilla and ST3215 also had to opt into camera-specific host behavior. The module seam
was therefore still shallow: device growth changed the shared interface and the page.

Live presentation still needs deterministic ordering, stable React keys, lazy UI loading,
layout composition, realtime capability reporting, and isolation when one module fails
to select or render.

## Decision

The shared live mechanism lives under `src/live/`. Each concrete presentation is a
vertical module under `src/modules/<module-id>/`; its optional `live.ts` exports one
`LiveModule`. Module-only views, commands, parsers, formatting, and labels remain beside
that adapter. Product experiences use stable product names such as `rover` and
`dogzilla`, while hardware modules retain names such as `ina226` and `st3215`.

The catalog discovers `src/modules/*/live.ts` with Vite's bundled `import.meta.glob`.
The directory name is the module ID; it is derived during discovery rather than repeated
inside `live.ts`. Adapters are loaded eagerly so catalog validation happens at startup;
React views are loaded lazily.

Every adapter uses the same presentation interface:

- `resolve(frame)` selects zero or more keyed React views;
- `layout` chooses one closed host-owned layout profile;
- `claims` name the frame data whose presentation the module owns while active;
- `traits` report open-ended capabilities without widening the adapter or plan.

The normal authoring factory is `live()`. It selects one `FrameEntry` field, normalizes
single and repeated entries, uses `queueId` as the stable view key, supplies a typed
`{ data }` prop, and automatically claims that frame field. `customLive()` is reserved
for views whose props use multiple frame fields and therefore requires explicit claims.

Selection is pure. A selector does not use hooks, JSX, I/O, timers, mutation, or
subscriptions. It returns stable keys and props; the factory owns React element creation
and lazy loading.

### Layout profiles

The host understands four presentation profiles, ordered by visual scale:

- `card` — a small self-contained block in the shared responsive grid;
- `section` — a full-width block in the page's normal vertical flow;
- `feature` — the page's dominant content; cards may move into its desktop sidebar;
- `screen` — a complete operator interface that owns the content area and uses
  edge-to-edge mobile spacing.

These are layout primitives, not product names. A new product is implemented inside an
existing profile. Adding another profile changes the shared interface and requires at
least two concrete modules whose layout cannot be expressed by the existing profiles.

### Claim-based composition

Claims describe presented data, not other module IDs. `live()` derives a
`frame:<field>` claim. A custom module uses `frameFieldClaims(...)` for every frame field
it presents.

Layout does not determine claim ownership. When active modules overlap, the catalog
prefers the more comprehensive module: the adapter with more claims. Ties use the
optional module `order`, then module ID. Duplicate orders are valid; an omitted order
defaults to zero. All views selected by one module are arbitrated together, so repeated
sensor entries do not conflict with one another.

This lets Rover claim VESC, PWM, video, and power data and automatically suppress the
atomic views for those same sources. Dogzilla and ST3215 claim video and automatically
suppress the standalone camera module. Neither composite knows the IDs of the modules
it supersedes.

USB video is itself an auto-discovered `feature` module. `HomePage` depends only on
`resolveLiveModules(frame)` and `LiveSurface`; it does not import cameras or any
concrete device and does not interpret layout profiles or claims.

Traits are non-empty strings aggregated from visible modules. The current `realtime`
trait controls connection FPS visibility. Adding a trait does not change the adapter or
plan shape; shared behavior is added only where a real host consumer exists.

Module IDs are unique by filesystem construction. Claims and traits are non-empty and
unique within a module. View keys are non-empty and unique within a module. Selection
and lazy-render failures are isolated to the affected module.

## Consequences

- A live interface can be added without editing `HomePage`, `LiveSurface`, or a
  central registration list.
- The filesystem is the module catalog and the directory is its identity, removing one
  repeated field and preventing directory/ID drift.
- Cameras, sensors, atomic device views, and composite screens cross the same seam.
- Composite modules depend on data claims rather than the identities of competing
  modules, improving locality as products are added or renamed.
- Shared code owns discovery, ordering, validation, arbitration, layout, lazy loading,
  and error isolation once.
- New host behavior is expressed first through an existing layout profile or a trait;
  product-specific booleans are not added to the common interface.
- The interface remains limited to live presentation. Frame decoding, history-specific
  presentation, commands, and physical models have separate seams and may be colocated
  in the same module directory without becoming optional fields on this adapter.

## Rejected alternatives

### Add product-specific booleans to the adapter and plan

Fields such as `ownsCameras` and `isImmersive` force every new host behavior through the
adapter, catalog, plan, and page. An open set of traits plus closed layout profiles keeps
the common shape stable.

### Let a composite list module IDs that it replaces

An explicit `replaces` list couples Rover to the current atomic module catalog and can
silently become stale. Claims express the actual conflict: two active modules presenting
the same data.

### Keep cameras as a special case in `HomePage`

That makes the page inspect concrete frame fields and ask which products own cameras.
Treating standalone video as a normal module lets the catalog resolve that composition.

### Import every concrete module from `HomePage`

This couples shared layout to product growth and spreads device-selection conditions
through the page.

### Maintain a central registration list

That adds a second edit location for every module and permits the list to drift from the
filesystem.

### Put hooks or side effects in selectors

Selectors run during plan resolution and must remain deterministic, synchronous, and
testable through `resolveLiveModules(frame)`.

### Group modules by layout

Directories such as `cards/`, `sections/`, or `screens/` couple source ownership to a
presentation choice. Changing Dogzilla from a `section` to a `screen` should change one
adapter field, not move its implementation.

### Group modules by device category

Top-level groups such as `robots/`, `sensors/`, and `cameras/` are ambiguous for
composite products. Rover spans control, video, power, and telemetry. A flat module
catalog preserves stable identity without requiring category arbitration.

### Create one universal device plugin manifest

Live presentation, history rendering, decoding, configuration, actions, and physical
models vary independently. Combining them would produce a wide interface dominated by
optional fields. They remain separate interfaces colocated in one vertical module
directory.

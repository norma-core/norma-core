# ADR 0005: Organize live presentation as composable vertical modules

- Date: 2026-07-12
- Amended: 2026-08-23

## Context

Station Viewer presents sensors, cameras, individual devices, and composite operator interfaces such as Rover. Concrete imports and selection rules in `HomePage` made every new product a shared-page change.

The first module interface removed those imports but added product-specific fields such as `ownsCameras`, `isImmersive`, and `replaces`. Composite products still widened the common interface and knew which atomic modules they superseded.

We need one presentation seam that supports small sensors and complete operator screens without central registration or product-specific host logic.

## Decision

The shared live mechanism lives in `src/live/`. Concrete implementations are flat vertical modules under `src/modules/<module-id>/`; product modules use stable product names, while hardware modules retain their hardware names.

An optional `live.ts` exports one `LiveModule`. The registry discovers `src/modules/*/live.ts` with `import.meta.glob`; the directory name is the module ID. Adapters load eagerly for validation and React views load lazily.

The presentation interface contains four concepts:

- `resolve(frame)` selects keyed views;
- `layout` controls host placement;
- `claims` identify presented frame data;
- `traits` report host-consumed capabilities.

`live()` covers a single `FrameEntry` field and derives its claim. `customLive()` covers custom props or multiple fields and declares claims explicitly. Selection is synchronous and pure; the factory owns React element creation and lazy loading.

### Layout Profiles

Layouts express visual scale, not product identity:

- `card` — a small block in the responsive grid;
- `section` — a full-width normal-flow block and the default;
- `feature` — dominant content, optionally paired with a card sidebar;
- `screen` — a complete operator interface with edge-to-edge mobile spacing.

Adding a layout profile requires at least two real modules that cannot use the existing profiles.

### Claim-Based Composition

Claims name data, not competing module IDs. When active modules overlap, the adapter with more claims wins; ties use `order` and then module ID. All views from one adapter are arbitrated together.

This lets Rover claim VESC, PWM, video, and power data without naming their atomic modules. Dogzilla and ST3215 suppress standalone cameras by claiming video data, not by setting camera-specific host flags.

Layout does not affect claim priority. Traits are aggregated only from visible modules; the current `realtime` trait controls FPS visibility.

`HomePage` depends only on `resolveLiveModules(frame)` and `LiveSurface`. It does not import concrete modules or interpret frame fields, layouts, or claims.

## Consequences

- Adding live presentation requires one module-local adapter and no central registration edit.
- Product knowledge, UI, commands, parsing, and formatting remain local to the module.
- Shared code owns discovery, ordering, validation, arbitration, layout, lazy loading, and error isolation.
- Composite modules depend on presented data rather than the identities of other modules.
- Live presentation remains separate from frame decoding, history presentation, commands, and physical-model resolution.

## Rejected Alternatives

### Product-Specific Host Orchestration

Booleans such as `ownsCameras`, explicit `replaces` lists, and camera branches in `HomePage` couple the host and composite products to the current module catalog.

### Central Registration or Concrete Page Imports

A registry list creates a second edit location and can drift from the filesystem. Concrete imports spread product selection through shared page code.

### Group Modules by Layout or Device Category

Layout changes should not move an implementation. Categories such as robot, camera, or sensor are ambiguous for composite products such as Rover, which spans control, video, power, and telemetry.

### Universal Device Plugin

Live presentation, decoding, history, commands, and physical models vary independently. Combining them would produce a wide interface dominated by optional fields; their separate interfaces may instead be colocated in one vertical module.

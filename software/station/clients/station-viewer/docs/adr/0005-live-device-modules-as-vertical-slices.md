# ADR 0005: Organize live device presentation as vertical modules

- Date: 2026-07-12

## Context

Station Viewer presents data from multiple concrete devices. Adding each device directly to `HomePage` would make the page depend on every protocol-specific view, spread device knowledge across shared layout code, and require a central registration edit for every extension.

Live presentation also needs deterministic ordering, stable React keys, lazy UI loading, layout slots, realtime capability reporting, and isolation when one device fails to select or render.

## Decision

Each concrete live device is a vertical module under `src/devices/<device-id>/`. Its `module.ts` exports one `LiveDeviceAdapter`. Device-only views, commands, parsing helpers, formatting, and labels remain beside that manifest.

The live catalog discovers `src/devices/*/module.ts` with Vite's bundled `import.meta.glob`. Manifests are loaded eagerly so catalog validation happens at startup; their React views are loaded lazily.

The normal authoring interface is `live()`. It selects one `FrameEntry` field, normalizes single and repeated entries, uses `queueId` as the stable view key, and supplies a typed `{ data }` prop. `customLive()` is reserved for views whose props require more than one frame field.

Selection is pure. A selector does not use hooks, JSX, I/O, timers, mutation, or subscriptions. It returns stable keys and props; the factory owns React element creation and lazy loading.

Module IDs and display orders are globally unique. View keys are non-empty and unique within a module. Shared layout is expressed through the closed `summary` and `primary` slots rather than arbitrary layout strings. Selection failures are reported for the affected module without preventing other modules from resolving.

`HomePage` depends only on `resolveLiveDevices(frame)` and `LiveDeviceSurface`; it never imports a concrete device.

## Consequences

- A device can add or change live presentation without editing `HomePage` or a central registry.
- Device-specific knowledge has locality inside one vertical module.
- Shared code owns ordering, validation, lazy loading, layout slots, and error isolation once.
- The authoring interface deliberately covers live presentation only; it is not a general plugin contract.
- Adding a new layout slot changes the shared interface and requires evidence that multiple modules need it.

## Rejected alternatives

### Import every concrete device from `HomePage`

This couples shared layout to device growth and spreads device-selection conditions through the page.

### Maintain a central registration list

That adds a second edit location for every module and permits the list to drift from the filesystem.

### Put hooks or side effects in selectors

Selectors run during plan resolution and must remain deterministic, synchronous, and testable through `resolveLiveDevices(frame)`.

### Create a universal device plugin manifest

Live presentation, history rendering, decoding, configuration, actions, and physical models vary independently. Combining them would produce a wide interface dominated by optional fields.

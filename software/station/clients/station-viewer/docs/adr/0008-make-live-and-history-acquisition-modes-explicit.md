# ADR 0008: Make live and history acquisition modes explicit

- Date: 2026-07-12

## Context

Station Viewer has two data-acquisition modes with different behavior:

- live mode polls the latest `inference-states` entry at up to 50 Hz, reuses the previous parsed frame, publishes camera frames, and updates the live snapshot;
- history mode selects immutable NormFS entries, retains data needed for inspection, debounces navigation, and applies the latest-request-wins rule from ADR 0004.

`HistoryPage` enters history behavior by acquiring a disposable lease from `WebSocketManager` and releasing it on cleanup. The manager tracks leases by identity so nested or overlapping consumers cannot resume live polling prematurely.

## Decision

Expose acquisition intent rather than polling mechanics.

The transport module provides a disposable history lease whose public concepts are `live` and `history`. Acquiring the first history lease suspends latest-frame polling but keeps the WebSocket and NormFS client available for selected reads. Releasing the last history lease switches acquisition intent back to `live` immediately and schedules polling to resume on the next task if the connection is open.

Mode transitions must be idempotent and safe under React Strict Mode mount-cleanup-mount behavior. Reconnect must restore the active acquisition mode rather than always assuming live mode. Only live mode publishes camera payloads and advances `LiveSnapshot`; history reads return their results to their requesting history module.

The manager tracks active leases by identity and returns an idempotent release function. This makes acquisition reference-counted without exposing a mutable counter. A plain boolean controlled by unrelated callers is not part of the interface.

Station Viewer has one process-wide acquisition mode. Simultaneous live and historical panes are outside the current interface and require a new decision if that product requirement appears. Outstanding history requests do not delay live resumption; ADR 0004 prevents their obsolete results from replacing newer history state.

## Consequences

- Pages express intent without knowing polling implementation details.
- Nested history consumers cannot accidentally resume live polling while another consumer still needs it suspended.
- Reconnect behavior becomes a documented invariant.
- Mode transitions become testable through one transport interface.
- `HistoryPage` no longer calls polling-mechanism methods directly.
- Connection statistics expose `acquisitionMode`, making live polling intent observable.
- A deferred polling resume prevents React Strict Mode's cleanup-remount probe from starting an in-flight live poll between leases.

## Rejected alternatives

### Keep public `stopUpdating()` and `resumeUpdating()` methods

They expose mechanism, permit unbalanced calls, and cannot identify which caller owns suspension.

### Close the WebSocket in history mode

History reads use the same NormFS transport, so closing the connection would disable the requested mode.

### Run live polling and history parsing without coordination

This spends transport and decoding capacity on live data while the user has explicitly selected historical inspection, and it continues publishing camera frames that are not part of the historical view.

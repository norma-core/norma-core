# ADR 0001: Publish stable, atomic WebSocket snapshots

- Date: 2026-07-12

## Context

`WebSocketManager` owns the current inference frame, its entry ID, and connection statistics. React hooks previously copied those values into local state by listening to `EventTarget` events and calling separate getters.

The frame and entry ID describe one logical observation, but separate getters did not express that invariant. Connection statistics were also returned as a fresh object on every getter call. That makes the manager unsuitable as a React external store because a snapshot must retain object identity until the underlying state changes.

## Decision

`WebSocketManager` publishes two immutable snapshots:

- `LiveSnapshot`, containing the current `frame` and `latestEntryId`.
- `ConnectionStats`, containing the current connection and transport statistics.

Each snapshot has a stable getter and a matching subscription method. A getter returns the same object reference until its state changes. When state changes, the manager replaces the complete snapshot before dispatching exactly one corresponding event.

The live frame and entry ID are updated atomically after frame parsing succeeds. Failed or incomplete parsing does not publish a partial snapshot.

`WebSocketManager` remains the owner of transport, polling, NormFS access, decoding, and reconnect behavior. The snapshot interface does not move those responsibilities into React.

## Consequences

- Callers can observe a frame and its entry ID without a transient mismatch.
- React can consume manager state through the external-store seam.
- Snapshot updates require immutable replacement rather than field mutation.
- High-frequency frame data remains in the existing manager; this decision does not introduce a general application store.
- Compatibility getters may delegate to the snapshots while existing callers migrate.

## Rejected alternatives

### Add Zustand as the owner of WebSocket state

This would create a second owner for data already owned by `WebSocketManager` and would not remove the need to adapt transport events. The existing manager only needs a stronger interface.

### Keep independent mutable fields

This leaves atomicity as an ordering convention that every caller must understand and preserve.

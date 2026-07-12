# ADR 0002: Adapt WebSocket state to React with `useSyncExternalStore`

- Date: 2026-07-12

## Context

The live frame, latest entry ID, and connection statistics are external state owned by `WebSocketManager`. Hooks implemented with `useState` and `useEffect` duplicated external state inside React and repeated listener setup and cleanup.

React 19 provides `useSyncExternalStore` for this seam. It defines how React reads a snapshot, subscribes to changes, and avoids tearing during concurrent rendering.

## Decision

React hooks consume the stable snapshots from ADR 0001 with `useSyncExternalStore`.

`useLiveSnapshot()` is the primary interface for callers that need both the frame and entry ID. Narrow compatibility hooks may select `frame` or `latestEntryId` for callers that need only one value. A caller that needs both values uses one `useLiveSnapshot()` call rather than two independent subscriptions.

`useConnectionStats()` consumes the connection snapshot directly. Hooks do not copy external snapshots into local React state.

## Consequences

- Subscription behavior and cleanup are localized in the manager and external-store hooks.
- A single render observes a consistent snapshot.
- Snapshot getters must obey the referential-stability invariant from ADR 0001.
- Specialized hooks remain small interfaces for existing pages, while `HomePage` uses the combined live snapshot.
- This decision does not globalize local UI, form, timeline, drag, or camera-layout state.

## Rejected alternatives

### Continue using `useState` plus `useEffect`

That pattern mirrors external state into every consumer and relies on effect timing rather than React's external-store contract.

### Introduce a single application-wide state module

Most state in Station Viewer is local to a page or device view. A broad store would expose more interface than its implementation hides and reduce locality.

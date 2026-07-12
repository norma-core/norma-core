# ADR 0003: Isolate uptime ticking from connection statistics

- Date: 2026-07-12

## Context

Connection statistics change when transport events arrive. Uptime is derived from `connectedAt` and wall-clock time, so its displayed value changes once per second even when the connection snapshot does not.

The previous `useConnectionStatsWithUptime()` refreshed the complete statistics value every second. Large consumers such as `HomePage` and the Dogzilla dashboard therefore rendered on a timer for a change that affected one text value.

## Decision

Connection statistics update only in response to `WebSocketManager` events.

A dedicated `useElapsedSeconds(startedAt)` hook owns the timer and cleanup needed to derive elapsed seconds. Each large consumer places that hook inside a small local uptime-rendering module, so the one-second tick stops at that module's seam.

Formatting remains local to the view because Home and device dashboards intentionally use different presentation formats.

## Consequences

- A clock tick no longer fabricates a new connection snapshot.
- Only the small uptime-rendering subtree renders once per second.
- Timer lifecycle and non-negative elapsed-time behavior are implemented once.
- Connection events still replace `connectedAt`, which restarts the elapsed-time calculation.

## Rejected alternatives

### Store uptime in WebSocketManager

Uptime is presentation-derived wall-clock state, not transport state. Putting a timer in the transport manager would mix unrelated responsibilities.

### Use one shared uptime formatter

The views have different formatting requirements. Sharing timer behavior provides leverage without forcing presentation policy into the hook.

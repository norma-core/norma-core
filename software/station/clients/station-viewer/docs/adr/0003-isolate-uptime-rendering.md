# ADR 0003: Isolate uptime ticking from connection statistics

- Date: 2026-07-12

## Context

Connection statistics change when transport events arrive. Uptime is derived from `connectedAt` and wall-clock time, so its displayed value changes once per second even when the connection snapshot does not.

The previous `useConnectionStatsWithUptime()` refreshed the complete statistics value every second. Large consumers such as `HomePage` and the Dogzilla dashboard therefore rendered on a timer for a change that affected one text value.

## Decision

Connection statistics update only in response to `WebSocketManager` events.

A dedicated `useElapsedSeconds(startedAt)` hook owns the timer and cleanup needed to derive elapsed seconds. The shared `ConnectionUptime` leaf component uses that hook, so large consumers render a stable subtree and the one-second tick stops at the leaf module's seam.

`ConnectionUptime` also owns the shared `HH:MM:SS` presentation used by Home and device dashboards. A view that later needs a different presentation can use `useElapsedSeconds` directly without moving the timer back into connection statistics.

## Consequences

- A clock tick no longer fabricates a new connection snapshot.
- Only the small uptime-rendering subtree renders once per second.
- Timer lifecycle and non-negative elapsed-time behavior are implemented once.
- Connection events still replace `connectedAt`, which restarts the elapsed-time calculation.

## Rejected alternatives

### Store uptime in WebSocketManager

Uptime is presentation-derived wall-clock state, not transport state. Putting a timer in the transport manager would mix unrelated responsibilities.

### Keep separate uptime components and formatters in each view

This duplicates identical presentation code and makes future timer or formatting fixes easy to apply inconsistently. The shared leaf component keeps both the timer-driven render and common presentation isolated.

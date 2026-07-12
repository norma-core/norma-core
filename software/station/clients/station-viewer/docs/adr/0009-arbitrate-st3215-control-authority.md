# ADR 0009: Arbitrate ST3215 control authority explicitly

- Date: 2026-07-12

## Context

An ST3215 bus can receive goals from web controls while motor mirroring may also target the same physical bus. Concurrent writers can issue conflicting positions, create unexpected motion, and make the UI's displayed authority differ from the backend's effective authority.

`BusCard` currently treats a local web command as enabling web control, stores that preference in `sessionStorage` for 60 seconds, ignores observed mirroring briefly after a local request, and disables web control when mirroring remains visible for a confirmation period. These timings protect against transient observation lag, but they are UI-local policy rather than an explicit control-authority contract.

## Decision

Represent ST3215 control authority as an explicit state machine scoped by stable bus identity.

At most one authority may be active for a bus: `none`, `web`, or `mirroring`. The Station backend command path owns and enforces this state machine for every stable bus identity, including competing browser and non-browser clients. Authority is based on backend-observed state and acknowledged transitions, never solely on a browser preference. A web command may be sent only while web authority is active or as part of an explicit acquisition request that the backend acknowledges.

Loss of connection, loss of stable bus identity, expired authority, malformed persisted state, or conflicting observations must fail closed to `none` in the UI. Persisted browser state may remember recent user intent, but it must not by itself prove authority after reload or reconnect.

Web authority is a renewable lease with backend-enforced expiry. Disconnect, bus identity loss, lease expiry, explicit release, or conflicting backend state transitions the viewer to `none`. Page close and visibility loss trigger best-effort release, while expiry provides the fail-safe when release cannot be delivered. Commands received during an authority transition or without the matching active lease are rejected.

Transition grace periods and confirmation windows may remain adapter implementation details, but their purpose and bounds are defined by the backend authority state machine. `sessionStorage` may restore recent user intent for the same bus; the viewer must reacquire authority before enabling control.

## Consequences

- UI controls can be enabled from one explicit authority state rather than several timing conditions.
- Mirroring and web control cannot be presented as simultaneously authoritative.
- Reconnect, reload, and stale persistence behavior become fail-safe and testable.
- The backend command protocol requires authority acquisition, acknowledgement, renewal, expiry, and release operations.
- Existing `sessionStorage` TTL and mirror timing heuristics must be reviewed as adapters to the state machine, not treated as proof of ownership.
- Lease duration and whether release also stops motors are safety parameters owned by the backend/driver contract and must be validated against the physical system before rollout.

## Rejected alternatives

### Treat a recent `sessionStorage` value as authority

Browser storage records local intent and can outlive the connection or backend state that made it valid.

### Allow both writers and rely on last command wins

This makes motion depend on timing and transport latency rather than an explicit invariant.

### Hide the conflict only in the UI

Disabling controls in one browser does not prevent another client or backend path from issuing commands.

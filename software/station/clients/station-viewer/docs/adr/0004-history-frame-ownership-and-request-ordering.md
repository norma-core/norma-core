# ADR 0004: Give the timeline ownership of frame selection and make latest history requests win

- Date: 2026-07-12

## Context

`HistoryPage` previously had two owners for the selected frame number: `useTimelineState` and `useFrameData`. An effect copied selection from the timeline into the frame reader.

The frame reader also allowed multiple asynchronous NormFS reads to overlap. A slow response for an older selection could arrive after a newer response and replace the displayed frame, error, or loading state.

## Decision

`useTimelineState` is the only owner of the selected frame number.

`useFrameData` accepts the selected frame as input and owns only the derived asynchronous state: parsed frame, loading status, and error. A `null` frame means that timeline initialization is incomplete and no read should start.

The hook preserves debounced navigation and immediate navigation. Every selection receives a monotonically increasing request generation. Only the latest generation may publish a frame, error, or loading completion. Cleanup invalidates the active generation and cancels pending debounce timers.

Physical request cancellation is not required because `NormFsClient` has no cancellation interface. Obsolete results are ignored.

## Consequences

- History has one source of truth for selection.
- `HistoryPage` no longer contains a synchronization effect.
- Slow or failed obsolete requests cannot overwrite the latest selection.
- The previously parsed frame can remain visible while a new frame loads.
- The frame reader's interface hides debounce and request-ordering behavior from callers.

## Rejected alternatives

### Keep synchronized frame numbers in both hooks

This duplicates ownership and requires every caller to preserve ordering through an effect.

### Serialize all reads

Waiting for an obsolete read before starting the latest selection would make navigation unnecessarily slow.

### Add cancellation to NormFsClient in this change

Cancellation would expand the transport interface and is unnecessary to guarantee correct visible state. It can be considered separately if resource usage becomes a measured problem.

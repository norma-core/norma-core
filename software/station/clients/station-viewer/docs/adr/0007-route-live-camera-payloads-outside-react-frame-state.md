# ADR 0007: Route live camera payloads outside React frame state

- Date: 2026-07-12

## Context

USB camera envelopes can contain large encoded frame buffers and update independently at high frequency. The live inference snapshot is consumed by `HomePage` and all resolved device views. Retaining camera bytes in that snapshot would propagate large payloads through React and make unrelated live UI participate in camera-rate updates.

Camera consumers need the newest image for one source, while device selection and layout need only camera identity, format, timestamps, errors, and queue metadata.

## Decision

Live parsing separates camera payload delivery from the normalized React frame.

When `parseFrame` runs with `publishVideoFrames: true`, it publishes the encoded image bytes to `live-camera-store` under a stable source ID derived from camera `uniqueId`, falling back to `queueId`. The `Frame.videoQueues` entry receives a metadata-only envelope with the large image buffers removed.

`live-camera-store` retains the latest frame per source and maintains listeners per source. A subscriber immediately receives the retained current frame when one exists. Removing the last listener also removes the listener set, while the latest frame remains available for the next subscriber.

`CameraViewer` subscribes only to its selected source. It owns Blob URL creation and revocation, duplicate-index suppression, image load ordering, and display FPS. Camera bytes are not added to `LiveSnapshot`, React Context, or a general state manager.

Historical parsing may retain complete decoded camera envelopes because history reads are selected, lower-frequency operations and may need the original entry contents. Payload publication is explicitly controlled by `ParseFrameOptions`.

## Consequences

- Camera-rate payload updates do not force the full live device tree to carry image buffers.
- Each viewer receives only the source it displays.
- The normalized live frame remains useful for camera discovery and layout.
- The camera store is a specialized external module, not an application-wide state manager.
- Consumers must clean up subscriptions and Blob URLs.
- Retained latest frames consume memory per observed source; eviction policy can be added if measured source churn makes it necessary.

## Rejected alternatives

### Store encoded images in `LiveSnapshot`

Every live snapshot consumer would observe camera payload churn even when it does not render a camera.

### Pass image buffers through device-view props

This would couple camera delivery frequency to device plan resolution and create large prop graphs.

### Use one global camera listener

Consumers would need to filter unrelated frames and would lose per-source subscription locality.

### Put camera payloads in a general state library

The specialized store already provides the narrower source-keyed interface and avoids introducing a second owner for the same data.

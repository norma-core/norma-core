# Architecture Decision Records

This directory records accepted architecture decisions for Station Viewer.

## Index

| ADR | Decision |
| --- | --- |
| [0001](0001-stable-websocket-snapshots.md) | Publish stable, atomic WebSocket snapshots |
| [0002](0002-react-external-store-hooks.md) | Adapt WebSocket state to React with `useSyncExternalStore` |
| [0003](0003-isolate-uptime-rendering.md) | Isolate uptime ticking from connection statistics |
| [0004](0004-history-frame-ownership-and-request-ordering.md) | Give the timeline ownership of frame selection and make latest history requests win |
| [0005](0005-live-device-modules-as-vertical-slices.md) | Organize live device presentation as vertical modules |
| [0006](0006-keep-live-and-physical-model-registries-separate.md) | Keep live presentation and physical-model registries separate |
| [0007](0007-route-live-camera-payloads-outside-react-frame-state.md) | Route live camera payloads outside React frame state |
| [0008](0008-make-live-and-history-acquisition-modes-explicit.md) | Make live and history acquisition modes explicit |
| [0009](0009-arbitrate-st3215-control-authority.md) | Arbitrate ST3215 control authority explicitly |
| [0010](0010-centralize-frame-decoding-before-device-presentation.md) | Centralize frame decoding before device presentation |
| [0011](0011-discover-queue-and-history-adapters.md) | Discover queue and history adapters as vertical slices |

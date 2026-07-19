# ADR 0011: Discover device codecs and history adapters as vertical slices

- Date: 2026-07-13
- Status: Accepted

## Context

ADR 0010 gave live and history one parser, but its normalized `Frame` and both history components enumerated every protobuf type. Adding a device required coordinated edits to shared unions, parser branches, live readers, and history switches. Independent device changes consequently touched the same lines and produced frequent merge conflicts.

The viewer now has enough concrete devices to justify two narrow extension seams. Transport and partial-failure policy must remain centralized; protobuf knowledge and device presentation should be local to the device.

## Decision

Each supported queue declares a typed codec in `src/devices/<id>/codec.ts`. Vite eagerly discovers these files. A codec binds a stable key, protobuf message, `QueueDataType`, cardinality, and optional queue-ID matcher. The registry rejects duplicate keys and multiple bare codecs for one queue type. A matching specific codec wins over a bare fallback; multiple specific matches are an ambiguity and remain raw with a structured frame issue.

`frame-parser.ts` is a generic orchestration module. It reads entries in parallel, resolves codecs, decodes, retains raw bytes, applies codec-local post-decode behavior, and reuses entries by queue ID, pointer, codec identity, and representation requirements. Its output is an opaque identity-keyed `DeviceEntryStore`; typed readers recover data only by presenting the same codec object. Unknown queues remain raw without being treated as failures. Read, match, decode, and cardinality problems are reported separately.

History presentation is independently declared in optional `src/devices/<id>/history.tsx` adapters and discovered only by the lazy history surface. An adapter may provide an eager summary, lazy expanded view, curated order, explicit default expansion state, and an object-valued JSON projection. Expanded views are collapsed by default. The shared shell derives tabs from capabilities, owns JSON/raw rendering and fullscreen images, and isolates lazy views with Suspense and an error boundary. Codecs without an adapter receive generic JSON/raw history.

The two heterogeneous registries erase the protobuf generic only at their identity-keyed storage boundaries. The store and history shell restore it using the exact codec object that produced the decoded value. Those are deliberate, localized casts; string keys never recover a type.

USB video keeps its exceptional publication behavior in explicit codec hooks: decoding is pure, `afterDecode` evaluates the live predicate immediately before publishing and projects metadata, and `reusable` distinguishes full-payload from metadata representations.

## Consequences

- Adding a device requires protobuf/backend work plus files in its device directory, but no edit to shared viewer TypeScript registries, parser unions, or history switches.
- Live, history, calibration, and composition readers use the same typed codec identity.
- Parser policy remains deep and centralized while protocol choices are local.
- History expanded views are collapsed by default and load on demand; the first visual expansion can briefly suspend.
- Codec files are eagerly bundled and create an intentional `api -> devices` runtime dependency. They must remain small and side-effect-free except for explicitly named post-decode hooks.
- Live adapters that embed USB cameras declare `embedsCameraFeed`; the resolved live plan suppresses the standalone camera surface without exposing concrete robot knowledge to `HomePage`.

## Rejected alternatives

### Keep extending the normalized Frame interface

This preserves compile-time named fields but makes every device PR modify the same shared union and parser code.

### Key decoded data only by codec strings

A string lookup cannot prove the relationship between a protobuf type and its decoded value. Object identity keeps the unsafe boundary small and auditable.

### Put decoding on live or history adapters

That would duplicate transport, reuse, raw-retention, and failure semantics and could make live and history interpret the same queue differently.

### One general-purpose device plugin contract

Live rendering, decoding, history, physical models, and commands have different consumers and lifecycles. Separate narrow seams keep each interface smaller.

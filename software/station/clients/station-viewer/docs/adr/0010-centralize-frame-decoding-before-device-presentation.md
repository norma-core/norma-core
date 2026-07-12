# ADR 0010: Centralize frame decoding before device presentation

- Date: 2026-07-12

## Context

An inference entry references multiple typed NormFS queues. Presenters need decoded values, queue identity, pointers, timestamps, raw bytes for history, reuse of unchanged entries, and consistent error handling. If every live device module decoded its own queue, transport knowledge would leak into React modules and live and history paths could interpret the same entry differently.

The live-device interface from ADR 0005 is intentionally a presentation seam. It receives a normalized `Frame`; it does not own protobuf or NormFS decoding.

## Decision

`frame-parser.ts` owns conversion from an inference entry and referenced NormFS entries into the normalized `Frame` model.

The parser:

- reads changed queue entries in parallel;
- reuses a previous decoded entry when queue and pointer are unchanged;
- decodes known `QueueDataType` values with the corresponding protobuf type;
- preserves queue ID, pointer, queue type, timestamps, and optional raw bytes;
- stores unknown entries as raw bytes when raw-data retention is enabled;
- applies the camera payload routing decision from ADR 0007;
- returns partial frame data when individual referenced entries fail, while reporting those failures.

Live and history callers select parsing options appropriate to their mode. Device manifests select from the resulting `Frame` and remain pure. A new device queue type is added to protobuf/backend definitions and the shared parser before its live presentation module is registered.

History rendering remains separate from live manifests. A future decoder or history extension seam requires a deliberate migration with multiple concrete adapters; it is not added as speculative optional fields to `LiveDeviceAdapter`.

## Consequences

- Live and history use one interpretation of queue data.
- React device modules do not depend on NormFS request ordering or protobuf decoding mechanics.
- Previous-frame reuse and parallel fetching are implemented once.
- Adding a new queue type currently requires editing the central normalized `Frame` and parser.
- The parser is a substantial module and should be deepened internally as its implementation grows without widening the presentation interface.

## Rejected alternatives

### Decode inside each live device module

This would mix I/O and presentation, make selectors asynchronous or effectful, and duplicate behavior in history.

### Add decoder callbacks to `LiveDeviceAdapter`

The live interface would gain transport responsibilities and optional methods unrelated to many adapters.

### Pass raw inference entries directly to React views

Every view would need to understand pointers, queue types, protobuf decoding, reuse, and partial failures.

### Build a general decoder plugin framework now

There is one shared parser implementation today. A new seam is justified only when multiple real decoder adapters or independently deployable decoders exist.

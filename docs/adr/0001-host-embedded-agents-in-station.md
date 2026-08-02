# ADR 0001: Host embedded agents in Station

- Date: 2026-07-24
- Status: Accepted
- Source design: [`AGENT_INTEGRATION_DESIGN.md`](../../AGENT_INTEGRATION_DESIGN.md)

## Context

Station already owns the local NormFS instance, hardware drivers, command
queues, static web server, and the station-viewer connection. Users should be
able to inspect and operate a robotics station through a conversational coding
agent without sending NormaCore data or API keys through a NormaCore cloud
service.

An agent is a materially different trust boundary from the existing viewer.
LLM output is untrusted and may request arbitrary code execution. Physical
commands can also move motors and cause damage. The host integration therefore
has to separate:

- the trusted Station process, NormFS, keys, and hardware;
- the semi-trusted agent runtime and its extensions;
- untrusted model output and generated code.

The full design includes session management, a streamed chat UI, raw terminal
access, BYOK credentials, Station tools, persistence, and multi-platform
sandboxing. Implementing these as unrelated frontend and backend features would
create duplicated lifecycle rules and unsafe direct access paths.

## Decision

### Station owns agent lifecycle

The Rust Station binary is the agent host and the authoritative owner of session
metadata. It starts, stops, resumes, and observes agent processes. A session uses
one explicit state machine:

```text
starting -> running | errored
running  -> stopped | errored
stopped  -> starting
errored  -> starting
```

Station restart reconciles `starting` and `running` records to `stopped`.
Sessions never resume implicitly. A prompt to a stopped session returns a typed
conflict response.

The same lifecycle will cover headless RPC and PTY sessions, while capabilities
remain mode-specific.

### pi-compatible JSONL RPC is the primary process boundary

Headless agents communicate over newline-delimited JSON on stdin and stdout.
Station sends commands such as `prompt`, `steer`, and `abort`, consumes streamed
events, records them, and forwards them to subscribed viewers. Raw PTY mode is a
secondary capability for terminal emulation, not the chat protocol.

Station does not execute model-generated code in the host process.

### Production agent execution is sandboxed with srt

Production agent processes and their extensions run inside an srt sandbox.
Station constructs the sandbox policy for each session:

- the selected workspace and session directory are writable;
- sensitive host paths such as SSH and agent credential files are masked;
- inherited cloud credentials are removed;
- network egress is restricted to the selected LLM provider and the local
  Station tool gateway;
- the process has isolated PID/user namespaces and no Linux capabilities where
  supported;
- the child dies with Station.

The first integration may shell out to the srt CLI or a Node sidecar. A native
Rust port can replace that adapter later without changing the Station lifecycle
or viewer contracts. An unsupported platform must show a clear warning; an
unsandboxed runtime must not silently claim production isolation.

### Station tools cross a narrow authenticated gateway

Agent access to queues and hardware is provided by pi extensions registered as
LLM-callable tools. Extensions call a loopback-only Station gateway using a
random per-session token. They do not receive general access to Station
internals.

The default extension will expose focused tools such as queue listing/reading,
bus state inspection, inference frame inspection, and motor commands. Tools
that can cause physical motion require an explicit user confirmation surfaced
through the viewer. The gateway also owns validation, rate limits, and emergency
stop policy.

### BYOK secrets stay on the Station

Provider keys are entered in station-viewer and stored encrypted at rest by
Station, reusing the existing local encryption infrastructure. The viewer never
stores keys in local storage and list APIs never return secret values.

Station decrypts a key only when starting its selected provider runtime. The
first implementation may inject it into the sandbox environment. A sandbox
credential file is preferred once the adapter supports it, because it reduces
environment visibility. Provider egress allowlists remain mandatory in either
case.

### Shared contracts are generated from TypeBox specifications

Agent RPC events, session records, lifecycle capabilities, terminal messages,
REST requests, tool parameters, and multiplexed transport frames will have one
TypeBox source of truth. Code generation emits TypeScript client types and Rust
Serde types/handler interfaces. CI will reject generated output that is out of
sync.

Existing Protobuf/NormFS data transport remains unchanged. Serde JSON is used at
the agent boundary because pi is a JSONL protocol.

### Viewer streaming shares the existing connection

The target transport multiplexes NormFS, agent, terminal, and control frames on
Station's existing WebSocket. Agent and terminal delivery is subscription-based
per session. Multiplexing must be negotiated so existing NormFS-only clients
remain compatible.

The byte-prefix proposal from the source design is not final until the current
NormFS wire protocol has been checked for collisions. A separate WebSocket path
is an acceptable outcome if it provides a safer compatibility boundary.

### Session history is persisted on the host

pi-native JSONL session files are the durable conversation representation.
Station stores the metadata index and reconciles it with those files at boot.
The viewer may cache metadata for display, but Station remains authoritative.

## Prototype slice

The first vertical prototype proves the ownership boundaries and the complete
browser-to-runtime loop without claiming production security:

| Area | Prototype | Target |
| --- | --- | --- |
| Runtime | Pinned `@earendil-works/pi-coding-agent@0.82.1`, launched as `pi --mode rpc`; mock is explicit via `STATION_AGENT_MOCK=1` | pi RPC process inside srt |
| Lifecycle | Persistent four-state Station FSM with explicit stop/resume | Same |
| Native session | `get_state` handshake persists `sessionFile`/`sessionId`; resume passes the exact `--session` path | Same, with reconciliation and migration tooling |
| Events | Strict LF/CRLF JSONL framing, request correlation by `id`, cursor-based REST polling from a persisted event log | Subscription-based multiplexed WebSocket |
| Viewer | Session list, exact pi event rendering, prompt, steer, follow-up, abort, stop/resume/delete | Full sessions, dialogs, attachments, terminal |
| Credentials | No Station credential API; pi uses its existing local auth/environment | Encrypted BYOK store |
| Station tools | Not exposed to pi | Authenticated gateway and confirmation-gated hardware tools |
| Types | Handwritten Rust/TypeScript boundary types | TypeBox-generated Rust and TypeScript |
| Sandboxing | Not present | Mandatory srt policy and UI capability signal |

The real pi process is the default. Station resolves it from `STATION_PI_BIN`,
then from the pinned local runtime under `software/station/agent-runtime`, and
finally from `pi` on `PATH`. Missing or invalid pi is a typed startup error; it
must not silently fall back to a mock. `STATION_AGENT_MOCK=1` opts into the
deterministic development backend explicitly.

Station constructs pi arguments directly rather than parsing a shell command.
New sessions receive `--mode rpc`, `--session-dir`, and `--name`, plus optional
provider/model arguments. Resumed sessions additionally receive the
`sessionFile` returned by pi's `get_state` response through `--session`.

The process adapter uses strict newline framing with an 8 MiB record limit,
correlates responses with Station-generated request IDs, rejects mismatched or
unknown responses, places a timeout on every command, captures stderr
separately, and terminates the child on protocol failure or Station shutdown.
Station does not mark a session `running` until a real `get_state` handshake
succeeds.

Prototype files:

- `software/station/bin/station/src/agent/mod.rs`
- `software/station/bin/station/src/agent/pi_rpc.rs`
- `software/station/bin/station/tests/fixtures/fake-pi.mjs`
- `software/station/agent-runtime/package.json`
- `software/station/bin/station/src/web/server.rs`
- `software/station/clients/station-viewer/src/api/agent-api.ts`
- `software/station/clients/station-viewer/src/pages/AgentPage.tsx`

The pinned pi 0.82.1 package currently publishes an npm shrinkwrap containing
`brace-expansion` 5.0.7, affected by GHSA-mh99-v99m-4gvg. Root npm overrides do
not replace that shrinkwrapped copy. Shipping is blocked until the upstream
package updates it or Station owns a reproducible patched package.

## Security and safety invariants

The following are release gates, not optional hardening:

1. Production UI must distinguish sandboxed, degraded, and mock runtimes.
2. Provider secrets must never be logged, returned by read APIs, or persisted in
   plaintext.
3. Agent code must not execute in the Station host process.
4. Hardware access must pass through typed Station-owned validation.
5. Commands capable of motion must require explicit user confirmation and
   preserve an accessible emergency stop.
6. Network and filesystem restrictions must be tested as denied capabilities,
   not inferred from configuration alone.
7. Station restart must not implicitly restart an agent or repeat a hardware
   action.

## Consequences

### Positive

- Station is the single authority for processes, sessions, secrets, and
  hardware access.
- The viewer remains a client and cannot bypass host safety policy.
- JSONL keeps the process adapter compatible with pi and makes event logs easy
  to inspect.
- Extensions provide a user-replaceable tool boundary without building a
  general plugin framework into Station.
- Generated contracts can keep Rust and TypeScript structurally aligned.
- A mock runtime supports deterministic local development and UI testing.

### Costs and constraints

- Station gains subprocess supervision, persistence, HTTP/WS APIs, and
  platform-specific sandbox responsibilities.
- Multiplexing must preserve existing NormFS clients and cannot be introduced by
  assuming unused prefix bytes.
- srt behavior and dependencies differ across Linux, macOS, and Windows.
- Multiple concurrent sessions require explicit CPU, memory, and event-log
  limits.
- Environment-based key injection still exposes the key to the sandboxed
  process and should be replaced when feasible.
- Cursor polling in the prototype adds latency and requests; it must not become
  the final streaming architecture by accident.

## Rejected alternatives

### Run the agent in the browser

The browser cannot safely own local subprocesses, sandbox policy, persistent
sessions, or hardware access. It would also make secret storage dependent on
browser state.

### Let the agent call NormFS or drivers directly

This bypasses command validation, confirmation, rate limiting, and auditability,
and exposes a much wider trusted surface to model output.

### Execute generated code directly in Station

This collapses the trust boundary and gives untrusted code Station's filesystem,
credentials, and hardware privileges.

### Use Docker as the primary sandbox

Docker provides reproducible environments but adds a daemon, image lifecycle,
startup cost, and embedded-system footprint that are not required for a
single-user local station. srt better matches the selected threat model.

### Store BYOK keys in the viewer

Browser storage complicates recovery and exposes secrets to frontend code and
origins. Station already owns durable local storage and process creation.

### Auto-resume sessions after Station restart

Automatic resume can repeat model or hardware actions without current user
intent. Resume remains explicit.

### Introduce terminal mode as the chat protocol

PTY output is difficult to type, resume, audit, and render as structured tool
events. JSONL RPC is the primary integration; PTY remains a separate capability.

## Delivery sequence

1. Stabilize lifecycle persistence, process supervision, REST semantics, and
   the browser chat loop demonstrated by the prototype.
2. Introduce shared TypeBox specifications and generated Rust/TypeScript
   contracts.
3. Add negotiated WebSocket streaming after verifying the NormFS protocol.
4. Integrate srt and expose verified sandbox capability state.
5. Add encrypted BYOK storage and provider/model selection.
6. Add the authenticated Station tool gateway, read-only tools first.
7. Add confirmation-gated motion commands and safety/rate-limit tests.
8. Add PTY sessions and terminal reconnect/scrollback.

## Open follow-up decisions

- srt CLI/sidecar versus the Rust port after Phase 1.
- Negotiated byte-prefix multiplexing versus a separate WebSocket endpoint.
- JSON metadata index versus a NormFS queue.
- Environment key injection versus a temporary sandbox credential file.
- Per-station concurrent session and event-retention limits.
- The terminal renderer (`@wterm` versus xterm.js).

These questions select adapters or operational limits; they do not change the
ownership and trust-boundary decisions in this ADR.

# Station agent runtime

This directory pins the exact pi package used by Station:
`@earendil-works/pi-coding-agent@0.82.1`.

Install it with:

```bash
cd software/station/agent-runtime
npm install --ignore-scripts
```

The lockfile is committed, so CI and release builds should use
`npm ci --ignore-scripts`.

Station resolves the executable in this order:

1. `STATION_PI_BIN`
2. this directory's `node_modules/.bin/pi`
3. `pi` on `PATH`

The normal runtime is real pi RPC. For deterministic UI development only, set
`STATION_AGENT_MOCK=1` before starting Station.

## Verification

From the repository root:

```bash
cargo test --package station agent::
STATION_REAL_PI="$PWD/software/station/agent-runtime/node_modules/.bin/pi" \
  cargo test --package station handshakes_with_the_installed_pi_rpc -- --ignored
```

The first command exercises the protocol against a deterministic fake process.
The second launches the installed official pi package and verifies its real
`get_state` handshake without sending a model prompt.

## Known release blocker

The pi 0.82.1 npm package publishes a shrinkwrap that pins
`brace-expansion` 5.0.7 (GHSA-mh99-v99m-4gvg). A root npm override cannot replace
that nested copy. Do not ship this runtime until upstream publishes the fixed
dependency or Station owns a reproducible patched package.

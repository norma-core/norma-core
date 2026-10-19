# elrobot-ik

HTTP API that solves inverse kinematics for the ElRobot follower arm and drives it through a NormaCore station.

It serves a JSON API under `/api/v1`, the same operations as MCP tools at `/mcp`, the robot URDF at `/urdf`, and Swagger at `/docs`. There is no web UI; the station's own page at `http://localhost:8889/` shows the arm.

## Requirements

- Python 3.12 (placo wheels; 3.13 is not supported yet) and [uv](https://docs.astral.sh/uv/). placo ships wheels for macOS (Intel and Apple silicon) and Linux (x86_64, aarch64) only; on Windows use WSL.
- A running station with `--web` (WebSocket on port 8889) and a calibrated ElRobot bus. Calibrate in the station UI: Calibration page, Auto Calibrate, then Freeze. Until every motor has a frozen range, this API answers 409 `not_calibrated` on any request that would move the arm. Solving without moving still works.

## Run

```bash
uv sync
STATION_URL=ws://localhost:8889/api IK_PORT=8020 uv run elrobot-ik
# Swagger UI: http://localhost:8020/docs
```

The default port is 8010. On a Mac with OrbStack, 8010 and 8011 may already be forwarded to containers, hence `IK_PORT` above.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `STATION_URL` | `ws://localhost:8889/api` | Station WebSocket endpoint |
| `IK_HOST` / `IK_PORT` | `0.0.0.0` / `8010` | Where this API listens |
| `MOTION_SPEED` / `MOTION_ACCEL` | `600` / `30` | Default servo speed and acceleration |
| `STALE_AFTER_MS` | `500` | Reject requests when motor state is older than this |

## Arm id

Every arm route takes the arm's bus serial from `GET /api/v1/arms`. That one call returns every arm with its `role` (`follower`, 12 V, the one to drive; `leader`, the teleoperation handle), torque state, joints and the current tool point pose. There is no default arm.

## Coordinates

World frame: origin on the base yaw axis (the center of the base motor) at table level, X forward (the way the arm faces at its zero pose), Y left, Z up. Measure table coordinates from the base motor's rotation axis. The URDF base link origin is 0.0425 behind this point.

The tool point is the center of the closed jaws' tip edge, 0.104 beyond the wrist frame. The jaws are parallel: `gripper` 0 is closed (0 mm), 1 is open (50 mm), and the fingers are about 45 mm deep from the tip edge to the palm. With the gripper vertical, the shoulder-to-wrist links span 0.26, so a vertical gripper reaches about 0.20 from the base at z 0.05-0.08, less when higher. Farther targets come back 422 `unreachable`.

## API documentation

- Swagger UI (try requests): `http://localhost:8020/docs`; ReDoc: `http://localhost:8020/redoc`; schema: `http://localhost:8020/openapi.json`
- Agent guide: `AGENTS.md` (also served as the MCP resource `elrobot://guide`)

## Endpoints (`/api/v1`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Station connection and frame age |
| GET | `/arms` | Every arm: `id`, `role`, `calibrated`, `torque_enabled`, tool point `pose` (position, rpy, jaw rotation), `gripper` opening, `joints` (angle, steps) |
| POST | `/arms/{id}/move-to` | `{position, orientation: {rpy | quaternion}, gripper?, execute=false, speed?, accel?}` full pose |
| POST | `/arms/{id}/gripper` | `{open, speed?, accel?}` open (1) or close (0) the jaws |
| POST | `/arms/{id}/torque` | `{enabled}` hold or release all motors |
| GET | `/cameras` | Cameras with `id`, name and frame size |
| GET | `/cameras/{id}/image` | Newest frame as JPEG |
| GET | `/urdf` | The robot's URDF XML (`?variant=model` adds the tool frame and table box); meshes under `/urdf/assets/` |

Executing a move first releases the arm from the station's leader→follower mirroring, so the leader stops overriding it.

`gripper` is 0 (closed) to 1 (open); omitted keeps the current opening. A close that returns `stalled` has met an object and leaves the servo straining against it: re-send the gripper about 0.05 wider than the opening it stopped at to hold without overloading. A close to 0 that returns `reached` gripped nothing. Orientation in `move-to` is the tcp frame in world coordinates; the gripper approach axis is the frame's +Y, so `rpy: {roll: -1.5708, pitch: 0, yaw: 0}` points it down, and `yaw` turns the jaws about the vertical.

Example, solve only:

```bash
curl -s localhost:8020/api/v1/arms/5AB9067054/move-to -H 'content-type: application/json' \
  -d '{"position": {"x": 0.20, "y": 0.05, "z": 0.05}, "orientation": {"rpy": {"roll": -1.5708, "pitch": 0, "yaw": 0}}}' | jq .
```

Add `"execute": true` to move; `motor_steps` in the solve-only response is exactly what an execute would write (motor 8, the gripper, is only written when `gripper` is given). The call returns when every commanded motor is within 15 steps of its goal (`motion.status = "reached"`). The servos run P-only and stop a little short under load, so when they settle outside tolerance the goals are re-sent corrected by the residual, up to twice; if the arm still stops short the status is `"stalled"`. `"timeout"` means the arm was still moving after 8 s. If the station disconnects, stops publishing state, or loses the arm's bus after the goal was sent, or a newer command for the arm takes over, the status is `"unknown"`: the service stopped watching before the move ended. Every solution is checked for self-collision and table collision at the target and along the way before anything is sent. One command drives an arm at a time, and the newest wins: an `execute`, gripper or torque request that arrives while the arm is moving stops the motion in flight and runs instead. Solve-only requests are always allowed.

## Errors

404 unknown arm or camera (`context.candidates` lists the known ids); 409 `not_calibrated`, `motor_error`; 422 `unreachable`, `collision`, `invalid_gripper`, or `invalid_request` for a malformed body; 415 `unsupported_codec` (camera frame is not JPEG); 500 `limit_violation` (solver inconsistency, nothing is sent); 503 `station_disconnected`, `no_frame`, `stale_frame`. Bodies are `{"error", "detail", "context"}`.

## For AI agents: AGENTS.md and the MCP endpoint

`AGENTS.md` is the operating guide for agents: coordinate frame, safety rules, reach limits, endpoint semantics, a pick sequence, and repository conventions. The same operations are exposed as MCP tools at `http://localhost:8020/mcp` (Streamable HTTP, stateless): `health`, `list_arms`, `move_to`, `set_gripper`, `set_torque`, `list_cameras`, `get_camera_image`, and the resource `elrobot://guide` (AGENTS.md). Register in Claude Code:

```bash
claude mcp add --transport http elrobot http://localhost:8020/mcp
```

## Development

```bash
uv run pytest       # no hardware needed
uv run ruff check   # lint (config in pyproject.toml)
```

The robot model is not kept here: `hatch_build.py` copies `hardware/elrobot/simulation/` (URDF and meshes) into `src/elrobot_ik/urdf/` when `uv sync` builds the package, so this example must be built from inside a norma-core checkout. The protobuf stubs under `src/elrobot_ik/station/proto/` are generated with `protoc` from the repo's `protobufs/` and checked in.

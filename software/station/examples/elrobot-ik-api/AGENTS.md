# AGENTS.md — ElRobot IK API

Guidance for AI agents (and people) operating the ElRobot arm through this service, and for agents editing this repository. Read it fully before sending any motion command.

## What this is

`elrobot-ik` is an HTTP service that drives one ElRobot follower arm (8 Feetech ST3215 servos) through a NormaCore **station**. It solves inverse kinematics against the ElRobot URDF, checks collisions, and executes moves. The same operations are exposed as MCP tools.

| Thing | Where |
|---|---|
| HTTP API | `http://localhost:8020/api/v1/...` (port from `IK_PORT`); Swagger at `/docs` |
| Swagger | `http://localhost:8020/docs` |
| MCP endpoint (Streamable HTTP) | `http://localhost:8020/mcp` |
| Station (robot driver, separate process) | `ws://localhost:8889/api`, web UI at `http://localhost:8889/` |

Start it with `IK_PORT=8020 uv run elrobot-ik` from this directory. The station must already be running with `--web`.

## Safety rules for agents

1. **Never send `execute: true` without a reason the user gave.** Solve first (`execute: false`, the default), inspect `motor_steps`, `collision` and `reachable`, then execute.
2. **Keep speeds low** on first moves: `speed: 200, accel: 10` (defaults are 600 / 30, clamped to 100..1500 and 5..100).
3. **Read the pose before moving** (`GET /arms` carries every arm's current tool point pose). A move from an unknown pose is a move you cannot predict.
4. **The arm can hit the table and itself.** The service checks both at the target and along a straight joint-space path, but a cluttered table, cables or objects in the jaws are invisible to it.
5. **Plan the path yourself.** The collision check knows the robot and the table, not the objects, so never send one straight move through where objects may stand. The usual shape is a pre-pose a few cm short of the target along the gripper's approach axis, a short straight move in, and the same short move out before going elsewhere. The approach direction is yours to choose for the scene: from above with a vertical gripper (pre-pose 0.03–0.05 higher, straight down, lift before any lateral move) is the common case; from the side with a horizontal gripper suits a tall object or a bin edge.
6. **Stop conditions are honest.** `motion.status` is `reached`, `stalled` (servos stopped short, often the gripper closing on something, or a blocked arm), `timeout` (still moving after 8 s) or `unknown` (the service stopped watching before the move ended: station data or the arm's bus lost, or a newer command for this arm took over). Treat `stalled` on an arm move as a problem (stop, look at a camera image); `timeout` and `unknown` mean read `GET /arms` before doing anything else. On a gripper close, `stalled` means the jaws met an object and `reached` after `open: 0` means they closed fully: nothing was gripped. A stalled close means the servo is still pushing against the object (overload, it heats up): right away send the gripper again about 0.05 wider than the opening it stopped at (`gripper` in `GET /arms`), which keeps the hold without the strain.
7. **Releasing torque drops the arm.** `POST /torque {"enabled": false}` lets the arm fall under gravity. Only do it when the user asks and the arm is low or supported.
8. **The newest command wins.** An execute, gripper or torque request sent while the arm is moving is not rejected: it stops the motion in flight (that earlier call returns `motion.status: unknown`) and runs instead. Do not fire commands in a loop; send one, wait for it to return, then decide.
9. **Drive the follower, never the leader.** `GET /arms` gives each arm's `role`. If the station is mirroring a leader onto that arm (teleoperation), executing a move stops that mirroring; re-enable it in the station UI afterwards if the user wants it back.
10. **Do not calibrate, write EEPROM, or change station settings from here.** Calibration is done in the station UI (Calibration page, Auto Calibrate, Freeze). This service only reads the result.

## Coordinate frame

World frame: origin on the **base motor's rotation axis at table level**, **X forward** (the direction the arm faces at its zero pose), **Y left**, **Z up**. Angles about the vertical are positive counter-clockwise seen from above.

The **tool point** is the center of the closed jaws' tip edge. `position` in every response and `x, y, z` in every request refer to it. `z` is its height above the table.

**Jaws**: parallel, `gripper` 0 = closed (0 mm) to 1 = open (50 mm). The fingers are about 45 mm deep from the tip edge to the palm, so an object up to 50 mm wide can be gripped at most 45 mm below its top: set `z` to the object's top minus the grip depth.

Gripper orientation in `rpy` (radians, roll about X then pitch about Y then yaw about Z): the gripper's approach axis points from the wrist out through the jaw tips. `roll: -1.5708, pitch: 0` means that axis points straight down (gripper vertical); `yaw` then turns the jaws about the vertical: 0 = they open fore-and-aft along X, 1.5708 = sideways. Responses report that jaw direction as `rotation_deg` (degrees).

## Reach (vertical gripper)

The wrist pitch limit (101°) bounds how far a vertical gripper reaches: about **0.20 out at z 0.05–0.08**, less when higher; close to the base only about z 0.08 before the gripper hits the base. Out-of-reach targets return 422 `unreachable`; the response context carries the residual error. Accuracy is about 0.01–0.02 (calibrated arcs vs the URDF, ST3215 gear play, printed-part tolerances), so do not plan on finer placement than that.

## Endpoints (`/api/v1`)

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/health` | — | `station_connected`, `last_frame_age_ms` |
| GET | `/arms` | — | every arm: `{id, role, calibrated, torque_enabled, pose: {position, rpy, rotation_deg}, gripper, joints: [{motor, angle_rad, steps}]}`; `role` is `follower` or `leader` |
| POST | `/arms/{id}/move-to` | `{position:{x,y,z}, orientation:{rpy:{roll,pitch,yaw}} or {quaternion:{x,y,z,w}}, gripper?, execute=false, speed?, accel?}` | full 6-DOF pose; `rpy {roll: -1.5708, pitch: 0, yaw}` is a vertical gripper |
| POST | `/arms/{id}/gripper` | `{open: 0..1, speed?, accel?}` | jaws only, arm stays |
| POST | `/arms/{id}/torque` | `{enabled}` | hold / release all motors |
| GET | `/cameras` | — | `[{id, name, unique_id, width, height}]` |
| GET | `/cameras/{camera_id}/image` | — | newest frame as `image/jpeg` |
| GET | `/urdf` (alias `/api/v1/urdf`) | `?variant=raw\|model` | the robot's URDF XML; meshes under `/urdf/assets/` |

`{id}` is the bus serial from `GET /arms`; there is no default arm. An uncalibrated arm is listed with `calibrated: false` and null `pose`, `gripper` and `angle_rad`. Omitting `gripper` keeps the current opening: the gripper servo is not written at all, so a grip on an object survives the move. Solve responses are `{reachable, executed, pose: {position, rpy, rotation_deg}, joint_angles_rad, motor_steps, motion: {status, duration_ms}}`; `motor_steps` are the servo goals an execute writes.

Errors are `{"error", "detail", "context"}`: 404 unknown arm or camera (`context.candidates`); 409 `not_calibrated`, `motor_error`; 422 `invalid_request` (malformed body),  `unreachable`, `collision`, `invalid_gripper`; 415 `unsupported_codec` (the station stores frames in a codec other than VP8 or JPEG); 500 `limit_violation` (nothing sent); 503 `station_disconnected`, `no_frame`, `stale_frame`.

What to do with them: `not_calibrated`: ask the user to calibrate in the station UI (Calibration page, Auto Calibrate, Freeze). `station_disconnected`, `stale_frame`, `no_frame`: wait a moment, check `/health`, retry. `unreachable`: bring the target closer, lower, or change `yaw`. `collision`: raise `z` or turn the jaws. `motor_error`: stop and tell the user which motors (`context.motors`). `limit_violation`: a solver bug, report it.

## Typical sequence

```bash
curl -s localhost:8020/api/v1/health
curl -s localhost:8020/api/v1/arms                                      # pick the follower's id; its pose is where the tool point is now
ARM=5AB9067054
curl -s -X POST localhost:8020/api/v1/arms/$ARM/move-to -H 'content-type: application/json' \
  -d '{"position": {"x": 0.16, "y": 0.0, "z": 0.05}, "orientation": {"rpy": {"roll": -1.5708, "pitch": 0, "yaw": 0}}}'   # solve only
curl -s -X POST localhost:8020/api/v1/arms/$ARM/move-to -H 'content-type: application/json' \
  -d '{"position": {"x": 0.16, "y": 0.0, "z": 0.05}, "orientation": {"rpy": {"roll": -1.5708, "pitch": 0, "yaw": 0}}, "execute": true, "speed": 200, "accel": 10}'
curl -s -X POST localhost:8020/api/v1/arms/$ARM/gripper -H 'content-type: application/json' -d '{"open": 0.0}'
curl -s localhost:8020/api/v1/cameras                                   # then /cameras/{id}/image for a JPEG
```

A pick: open the gripper (`open: 1`), `move-to` a point 0.03–0.05 above the object with the gripper vertical and the jaws turned to straddle it (`yaw`), lower to grip height (object top minus up to 45 mm), close (`open: 0`; `stalled` means the jaws met the object, `reached` means they missed it), then re-send the gripper about 0.05 wider than where it stopped to relieve the overload, lift straight up, then move sideways. The tool point is the jaw tip edge, so set `z` so the jaws reach around the object, not onto it. Use a camera image to check the result.

## MCP

The same operations are exposed as MCP tools at `http://localhost:8020/mcp` (Streamable HTTP, stateless): `health`, `list_arms`, `move_to`, `set_gripper`, `set_torque`, `list_cameras`, `get_camera_image` (returns the newest frame as JPEG image content, decoded from the station's VP8 stream), plus a resource `elrobot://guide` that returns this file. Every arm tool takes `arm_id`. Errors come back as tool errors with the same `error` codes. Register it in Claude Code with:

```bash
claude mcp add --transport http elrobot http://localhost:8020/mcp
```

## Working in this repository

- Python 3.12, `uv`. Tests: `uv run pytest` (no hardware needed; they use a fake station). Run them before claiming anything works.
- Layout: `src/elrobot_ik/station/` (NormFS protobuf over WebSocket, register parsing), `calibration/mapper.py` (steps ↔ radians), `kinematics/` (placo model, IK), `service.py` (preconditions, collision checks, execution), `api/` (FastAPI routes, MCP), `hatch_build.py` (at build time copies the URDF and meshes from `hardware/elrobot/simulation` and generates the protobuf stubs from `protobufs/`).
- Conventions baked in and verified on hardware (do not change casually): joint directions `1,1,1,1,1,1,1,-1`; URDF gripper angle 0 = jaws open; world origin on the base yaw axis; tool point = jaw tip edge center.
- The API has no calibration endpoints; the station's frozen servo arcs are mapped linearly onto the URDF joint ranges.
- First contact with real hardware: calibrate in the station UI, then solve-only moves, then slow executes (`speed: 200, accel: 10`) near the home pose.

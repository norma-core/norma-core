"""MCP endpoint: the robot operations as tools for AI agents, served next to the HTTP API.

Mounted at /mcp (Streamable HTTP, stateless). Tool arguments mirror the HTTP bodies;
ServiceError becomes a tool error whose text carries the same error code and detail.
"""
from __future__ import annotations

import base64
import functools
import json
from collections.abc import Callable
from typing import Any

from mcp import types
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from elrobot_ik import GUIDE_PATH, VERSION
from elrobot_ik.api.routes import solve_response
from elrobot_ik.api.schemas import ErrorBody, Orientation, Vec3
from elrobot_ik.kinematics.transforms import make_transform
from elrobot_ik.service import ArmService, ServiceError

INSTRUCTIONS = """You control ElRobot arms through these tools. Call list_arms first: it returns every arm with its
arm_id (the bus serial, needed by every arm tool), role, torque, joints and current tool point pose; drive the
arm whose role is 'follower'.
Every executed move or gripper command stops active mirroring onto that follower. The current station
temporarily releases the whole follower during this stop; the service waits and restores previously
enabled motors, then enables the commanded motors. Untouched motors retain their torque state and goals.
There is no session: the next movement command stops mirroring again if it was re-enabled.
Read-only and solve-only calls do not stop mirroring. Explicit torque requests apply to all eight motors.
A failed handoff can leave torque released: check the arm before retrying. Do not use another controller
or restart the service during a handoff. Completing a move does not release torque.
World frame: origin on the base motor's rotation axis at table level, X forward, Y left, Z up.
The tool point is the center of the closed jaws' tip edge; z is its height above the table.
move_to with orientation rpy {roll: -1.5708, pitch: 0, yaw: θ} points the gripper straight down with the jaws
turned by θ radians (0 = fore-and-aft, 1.5708 = sideways).
Execute slowly (speed 200, accel 10).
Plan the path yourself: the collision check knows only the robot and the table, not the objects on it, so never
send one straight move through where objects may stand. The usual shape is a pre-pose a few cm short of the target
along the gripper's approach axis, then a short straight move in, and the same short move out before going
elsewhere. Pick the approach direction that suits the scene: for example, from above with a vertical gripper
(pre-pose 0.03-0.05 higher, then straight down, lift before moving sideways), or from the side with a horizontal
gripper for a tall object or a bin edge.
Gripper: parallel jaws, 0 = closed (0 mm) .. 1 = open (50 mm); the fingers are about 45 mm deep from the tip edge
to the palm, so set z to grip at most 45 mm below the object's top. A vertical gripper reaches about 0.20 out at
z 0.05-0.08.
Closing (open: 0) and getting status 'reached' means the jaws closed fully: nothing was gripped. 'stalled' means
they met an object and the servo is straining against it (overload): immediately call set_gripper again with the
opening about 0.05 wider than where it stopped, so it holds the object without overloading.
motion.status: 'reached' = at the goal; 'stalled' = servos stopped short (on an arm move: blocked, stop and check
a camera image); 'timeout' = still moving after 8 s (check list_arms before anything else); 'unknown' = the
service stopped watching the move before it ended: station data or the arm's bus was lost, or a newer command for
this arm took over (check health and list_arms, do not resend blindly).
A new command for an arm stops the one in flight and runs instead, so send one, wait for it to return, then
decide; never fire commands in a loop.
Errors (tool error text is JSON with 'error'): not_calibrated = ask the user to calibrate in the station UI;
station_disconnected / stale_frame / no_frame = wait a moment, check health, retry; unreachable = target closer,
lower or with a different yaw; collision = raise z or turn the jaws (yaw); motor_error = stop and tell the user.
list_cameras / get_camera_image show the table. Read elrobot://guide for the full rules."""


class RobotToolError(ToolError):
    """Tool error whose text is the HTTP API's {status, error, detail, context} JSON."""

    def __init__(self, status: int, code: str, detail: str, context: dict | None = None):
        super().__init__(json.dumps({"status": status, **ErrorBody(error=code, detail=detail, context=context or {}).model_dump()}))


def _service_errors(fn):
    """Convert ServiceError raised inside a tool into a RobotToolError carrying the same code."""
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except ServiceError as e:
            raise RobotToolError(e.status, e.code, e.detail, e.extra) from e
    return wrapper


def build_mcp(get_service: Callable[[], ArmService]) -> MCPServer:
    mcp = MCPServer("elrobot-ik", instructions=INSTRUCTIONS, version=VERSION)

    def tool(**kw):
        """@mcp.tool with structured output and service-error conversion."""
        kw.setdefault("structured_output", True)
        return lambda fn: mcp.tool(**kw)(_service_errors(fn))

    @tool(description="Service and station health: is the station connected, how old is the latest motor state.")
    async def health() -> dict[str, Any]:
        return get_service().health()

    @tool(description=(
        "Every arm on the station with its state: id (bus serial, needed by every arm tool), role ('follower' = the one to drive, "
        "'leader' = teleoperation handle), calibrated, torque_enabled, pose of the tool point in the world frame (position, rpy, "
        "rotation_deg = jaw direction), gripper 0..1, and per motor the joint angle (rad) and servo steps. "
        "Pose, gripper and angles are null for an uncalibrated arm."))
    async def list_arms() -> dict[str, Any]:
        return {"arms": await get_service().list_arms()}

    @tool(description=(
        "Move the tool point (jaw tip edge center) to a full 6-DOF pose: position {x,y,z} in m and orientation with exactly one of "
        "rpy {roll,pitch,yaw} radians (roll=-1.5708, pitch=0 = gripper vertical, yaw = jaw direction, 0 = forward, 1.5708 = sideways) "
        "or quaternion {x,y,z,w}. gripper 0..1 (0 closed, 1 open); omit to keep. execute=false only solves (motor_steps shows what "
        "would be written). speed 100..1500, accel 5..100. A new command for the same arm stops the one in flight and runs instead. "
        "Plan the path around objects yourself (the collision check knows only the robot and the table): a pre-pose a few cm short "
        "of the target along the approach axis, a short straight move in, and the same move out; e.g. from above with a vertical gripper."))
    async def move_to(arm_id: str, position: Vec3, orientation: Orientation, gripper: float | None = None,
                      execute: bool = False, speed: int | None = None, accel: int | None = None) -> dict[str, Any]:
        T = make_transform(orientation.to_rotation(), (position.x, position.y, position.z))
        out = await get_service().move_to(arm_id, T, gripper=gripper, execute=execute, speed=speed, accel=accel)
        return solve_response(out).model_dump()

    @tool(description=(
        "Open or close the jaws without moving the arm. open: 0 = closed, 1 = fully open. motion.status 'stalled' on closing means "
        "the jaws met an object and the servo is straining against it: re-send with 'open' about 0.05 wider than the current gripper "
        "value from list_arms, so it holds the object without overloading the gripper servo. 'reached' after open: 0 means the jaws "
        "closed fully: nothing was gripped. Parallel jaws, 0 = 0 mm, 1 = 50 mm."))
    async def set_gripper(arm_id: str, open: float, speed: int | None = None, accel: int | None = None) -> dict[str, Any]:
        return await get_service().set_gripper(arm_id, open, speed=speed, accel=accel)

    @tool(description="Enable (hold) or release torque on all motors. Releasing lets the arm fall under gravity; only on the user's request.")
    async def set_torque(arm_id: str, enabled: bool) -> dict[str, Any]:
        return await get_service().set_torque(arm_id, enabled)

    @tool(description="Cameras on the station: id (for get_camera_image), name and frame size.")
    async def list_cameras() -> dict[str, Any]:
        return {"cameras": await get_service().list_cameras()}

    @tool(structured_output=False, description="The newest frame from one camera as a JPEG image (decoded from the station's VP8 stream).")
    async def get_camera_image(camera_id: str) -> list[types.ImageContent]:
        jpeg, _meta = await get_service().camera_image(camera_id)
        return [types.ImageContent(type="image", data=base64.b64encode(jpeg).decode(), mime_type="image/jpeg")]

    @mcp.resource("elrobot://guide", name="ElRobot operating guide", mime_type="text/markdown",
                  description="Coordinate frame, safety rules, reach limits, endpoint semantics and a pick sequence (AGENTS.md).")
    def guide() -> str:
        return GUIDE_PATH.read_text() if GUIDE_PATH.exists() else INSTRUCTIONS

    return mcp

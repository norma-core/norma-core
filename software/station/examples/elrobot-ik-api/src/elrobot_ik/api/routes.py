"""HTTP routes. Thin: validate, call ArmService, shape the response.

Every route is async on purpose: a sync route would run in a threadpool and
touch the shared placo model outside the service's model lock.
"""
from __future__ import annotations

import functools
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from elrobot_ik import URDF_PATH
from elrobot_ik.api.schemas import (
    ArmOut,
    CameraInfo,
    GripperRequest,
    GripperResponse,
    MotionOut,
    MoveToRequest,
    PoseOut,
    SolveResponse,
    TorqueRequest,
    TorqueResponse,
)
from elrobot_ik.kinematics.model import urdf_xml
from elrobot_ik.kinematics.transforms import make_transform
from elrobot_ik.service import ArmService, SolveOutcome, pose_dict

router = APIRouter(prefix="/api/v1")


def get_service(request: Request) -> ArmService:
    return request.app.state.service


def solve_response(out: SolveOutcome) -> SolveResponse:
    """The public shape of a solve/execute outcome, shared by HTTP and MCP."""
    return SolveResponse(
        reachable=True,
        executed=out.executed,
        pose=PoseOut(**pose_dict(out.tcp_pose)),
        joint_angles_rad=out.joint_angles_rad,
        motor_steps=out.motor_steps,
        motion=MotionOut(**out.motion.public()),
    )


@router.get("/health", tags=["service"], summary="Service and station health")
async def health(request: Request) -> dict:
    """Whether the station WebSocket is connected and how old the latest motor state is.
    Requests that need an arm answer 503 when the station is disconnected or the state is
    older than 500 ms.
    """
    return get_service(request).health()


@router.get("/arms", tags=["arms"], summary="Arms on the station, with their state", response_model=list[ArmOut])
async def list_arms(request: Request) -> list[dict]:
    """Every ElRobot arm the station sees, in one record each: `id` (bus serial, used in every
    other arm route), `role` (`follower`, 12 V supply, the one you drive; `leader`, the
    teleoperation handle), `calibrated`, `torque_enabled`, `pose` of the tool point (center of
    the closed jaws' tip edge: `position` in m, world frame; `rpy` in rad; `rotation_deg`, the
    jaw-opening direction about the vertical, 0 = forward), `gripper` (0 closed .. 1 open) and
    `joints` (per motor: angle in radians, URDF convention, and raw servo steps). An arm that is
    not calibrated in the station UI is listed with `calibrated: false` and null pose, gripper
    and angles.
    """
    return await get_service(request).list_arms()


@router.post("/arms/{arm_id}/move-to", response_model=SolveResponse, tags=["motion"],
             summary="Full 6-DOF tool pose")
async def move_to(arm_id: str, body: MoveToRequest, request: Request) -> SolveResponse:
    """Move the tool point (center of the closed jaws' tip edge) to `position` with the tool
    frame oriented by `orientation` (exactly one of `rpy` in radians or `quaternion` xyzw). The
    gripper approach axis is the tool frame's +Y: `rpy {roll: -1.5708, pitch: 0, yaw: θ}` points
    it straight down with the jaws turned by θ (0 = fore-and-aft, 1.5708 = sideways). `gripper`
    0..1 also opens/closes (omit = keep).

    `execute: false` (default) only solves; `motor_steps` is what an execute would write.
    `execute: true` releases the arm from leader mirroring, drives it and waits.
    `motion.status`: `reached`, `stalled` (servos stopped short, or the jaws met something),
    `timeout` (still moving after 8 s), `unknown` (station data lost, or a newer command for
    this arm took over), `not_executed`. Errors: 422 `unreachable` / `collision`,
    409 `not_calibrated` / `motor_error`, 503 station problems.
    """
    T = make_transform(body.orientation.to_rotation(), (body.position.x, body.position.y, body.position.z))
    out = await get_service(request).move_to(
        arm_id, T, gripper=body.gripper, execute=body.execute, speed=body.speed, accel=body.accel,
    )
    return solve_response(out)


@router.post("/arms/{arm_id}/gripper", tags=["motion"], summary="Open or close the jaws", response_model=GripperResponse)
async def gripper(arm_id: str, body: GripperRequest, request: Request) -> dict:
    """Moves the gripper motor only; the arm stays where it is. `open` 0 = closed, 1 = fully
    open. `motion.status` `stalled` on closing means the jaws met an object (or the stop).
    """
    return await get_service(request).set_gripper(arm_id, body.open, speed=body.speed, accel=body.accel)


@router.post("/arms/{arm_id}/torque", tags=["motion"], summary="Hold or release all motors", response_model=TorqueResponse)
async def torque(arm_id: str, body: TorqueRequest, request: Request) -> dict:
    """`enabled: false` releases every motor so the arm can be moved by hand (it sags under
    gravity). `enabled: true` holds the arm where it is and releases it from leader mirroring.
    """
    return await get_service(request).set_torque(arm_id, body.enabled)


@router.get("/cameras", tags=["cameras"], summary="Cameras on the station", response_model=list[CameraInfo])
async def list_cameras(request: Request) -> list[dict]:
    """USB cameras the station is streaming, with the `id` for `/cameras/{camera_id}/image`
    and the frame size.
    """
    return await get_service(request).list_cameras()


@router.get("/cameras/{camera_id}/image", tags=["cameras"], summary="Latest camera image (JPEG)",
            responses={200: {"content": {"image/jpeg": {}}, "description": "the newest frame"}})
async def camera_image(camera_id: str, request: Request) -> Response:
    """The newest frame from one camera as `image/jpeg`; `X-Camera-Width`, `X-Camera-Height`
    and `X-Camera-Stamp-Ns` headers describe it. With the station's default `codec: vp8` the
    frame is decoded from its VP8 keyframe chain; with `codec: jpeg` it is served as stored.
    404 for an unknown camera, 503 while the camera has not published a decodable frame,
    415 if the station stores another codec.
    """
    jpeg, meta = await get_service(request).camera_image(camera_id)
    headers = {"X-Camera-Width": str(meta["width"]), "X-Camera-Height": str(meta["height"]),
               "X-Camera-Stamp-Ns": str(meta["stamp_ns"]), "Cache-Control": "no-store"}
    return Response(jpeg, media_type="image/jpeg", headers=headers)


MESH_BASE = "/urdf/"  # where app.py mounts the URDF directory


@functools.cache
def _urdf_text(with_frames: bool) -> str:
    return urdf_xml(URDF_PATH, with_frames=with_frames, mesh_base=MESH_BASE)


@router.get("/urdf", tags=["arms"], summary="Robot URDF (XML)")
async def urdf(variant: Literal["raw", "model"] = Query("raw", description="raw: the ElRobot follower URDF as shipped; model: with the injected `tcp` tool frame and `table_surface` collision box used by this service")) -> Response:
    """The kinematic model this service uses. Mesh paths are absolute on this server
    (`/urdf/assets/*.stl`), so the XML loads straight into a URDF viewer from any URL.
    """
    return Response(_urdf_text(variant == "model"), media_type="application/xml")

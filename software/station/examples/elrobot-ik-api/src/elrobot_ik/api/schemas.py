"""Pydantic models for the HTTP API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from elrobot_ik.config import ACCEL_RANGE, SPEED_RANGE


class Vec3(BaseModel):
    x: float
    y: float
    z: float


class Quaternion(BaseModel):
    x: float
    y: float
    z: float
    w: float


class RPY(BaseModel):
    roll: float
    pitch: float
    yaw: float


class Orientation(BaseModel):
    quaternion: Quaternion | None = None
    rpy: RPY | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> Orientation:
        if (self.quaternion is None) == (self.rpy is None):
            raise ValueError("orientation needs exactly one of 'quaternion' or 'rpy'")
        return self

    def to_rotation(self):
        """3x3 rotation matrix of the tool frame in the world frame."""
        from elrobot_ik.kinematics.transforms import quaternion_to_rotation, rpy_to_rotation

        if self.quaternion is not None:
            q = self.quaternion
            return quaternion_to_rotation(q.x, q.y, q.z, q.w)
        r = self.rpy
        return rpy_to_rotation(r.roll, r.pitch, r.yaw)


class ServoOptions(BaseModel):
    speed: int | None = Field(default=None, description=f"servo goal speed, clamped to {SPEED_RANGE[0]}..{SPEED_RANGE[1]} (default 600)")
    accel: int | None = Field(default=None, description=f"servo acceleration, clamped to {ACCEL_RANGE[0]}..{ACCEL_RANGE[1]} (default 30)")


class MotionOptions(ServoOptions):
    gripper: float | None = Field(default=None, ge=0.0, le=1.0, description="0 = closed, 1 = open; omitted keeps the current opening")
    execute: bool = Field(default=False, description="false: solve only; true: also move the arm")


class MoveToRequest(MotionOptions):
    model_config = ConfigDict(json_schema_extra={"example": {"position": {"x": 0.16, "y": 0.0, "z": 0.05}, "orientation": {"rpy": {"roll": -1.5708, "pitch": 0, "yaw": 0}}, "execute": False}})

    position: Vec3
    orientation: Orientation


class GripperRequest(ServoOptions):
    model_config = ConfigDict(json_schema_extra={"example": {"open": 0.0}})

    open: float = Field(ge=0.0, le=1.0, description="0 = closed, 1 = fully open")


class TorqueRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"enabled": False}})

    enabled: bool


class PoseOut(BaseModel):
    position: Vec3
    rpy: RPY
    rotation_deg: float


class MotionOut(BaseModel):
    status: str = Field(description="reached | stalled | timeout | unknown | not_executed")
    duration_ms: int


class SolveResponse(BaseModel):
    reachable: bool = Field(description="always true in a 200 response; an unreachable target is a 422")
    executed: bool
    pose: PoseOut = Field(description="tool point pose of the solution (where the arm is after a successful execute)")
    joint_angles_rad: list[float]
    motor_steps: list[int] = Field(description="servo goal steps per motor 1..8 (what execute writes); empty on an uncalibrated arm")
    motion: MotionOut


class JointOut(BaseModel):
    motor: int = Field(description="servo id 1..8")
    angle_rad: float | None = Field(description="joint angle, URDF convention; null until the arm is calibrated")
    steps: int = Field(description="raw servo position")


class ArmOut(BaseModel):
    id: str = Field(description="bus serial; use it as {arm_id}")
    role: str = Field(description="follower (12 V, the one to drive) or leader (teleoperation handle)")
    calibrated: bool = Field(description="every motor has a frozen arc; pose, gripper and angles are null otherwise")
    torque_enabled: bool = Field(description="every motor holds torque")
    pose: PoseOut | None = Field(description="tool point (jaw tip edge center) in the world frame")
    gripper: float | None = Field(description="0 = closed .. 1 = open")
    joints: list[JointOut]


class GripperResponse(BaseModel):
    id: str
    gripper: float
    motion: MotionOut


class TorqueResponse(BaseModel):
    id: str
    torque_enabled: bool


class CameraInfo(BaseModel):
    id: str = Field(description="use it in /cameras/{camera_id}/image")
    name: str
    unique_id: str
    width: int
    height: int


class ErrorBody(BaseModel):
    error: str
    detail: str
    context: dict[str, Any] = Field(default_factory=dict)

"""Rotation helpers and the fixed world <-> URDF frame change."""
from __future__ import annotations

import math

import numpy as np


def rpy_to_rotation(roll: float, pitch: float, yaw: float) -> np.ndarray:
    cr, sr = math.cos(roll), math.sin(roll)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw), math.sin(yaw)
    Rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    Ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    Rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def rotation_to_rpy(R: np.ndarray) -> tuple[float, float, float]:
    sy = -R[2, 0]
    sy = max(-1.0, min(1.0, sy))
    pitch = math.asin(sy)
    if abs(sy) < 1.0 - 1e-9:
        roll = math.atan2(R[2, 1], R[2, 2])
        yaw = math.atan2(R[1, 0], R[0, 0])
    else:  # gimbal lock: put everything into yaw
        roll = 0.0
        yaw = math.atan2(-R[0, 1], R[1, 1])
    return (roll, pitch, yaw)


def quaternion_to_rotation(x: float, y: float, z: float, w: float) -> np.ndarray:
    n = math.sqrt(x * x + y * y + z * z + w * w)
    if n == 0:
        raise ValueError("zero quaternion")
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def rotation_angle(R: np.ndarray) -> float:
    c = (float(np.trace(R)) - 1.0) / 2.0
    return math.acos(max(-1.0, min(1.0, c)))


def make_transform(R: np.ndarray, p) -> np.ndarray:
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = np.asarray(p, dtype=float)
    return T


# API world frame: origin on the base yaw axis (joint 1) at table level, X forward,
# Y left, Z up. In the URDF the yaw axis passes through (0, 0.042489, z), so the world
# frame is the URDF frame shifted there and rotated by -90 deg about Z.
BASE_YAW_AXIS_URDF_Y = 0.042489  # Rigid 1 (0.007585) + rev_motor_01 origin (0.034904)
_R_WORLD_URDF = rpy_to_rotation(0.0, 0.0, -math.pi / 2)
T_WORLD_URDF = make_transform(_R_WORLD_URDF, _R_WORLD_URDF @ np.array([0.0, -BASE_YAW_AXIS_URDF_Y, 0.0]))
T_URDF_WORLD = np.linalg.inv(T_WORLD_URDF)


def urdf_to_world(T_urdf: np.ndarray) -> np.ndarray:
    return T_WORLD_URDF @ T_urdf


def world_to_urdf(T_world: np.ndarray) -> np.ndarray:
    return T_URDF_WORLD @ T_world


def point_urdf_to_world(p) -> np.ndarray:
    return T_WORLD_URDF[:3, :3] @ np.asarray(p, dtype=float) + T_WORLD_URDF[:3, 3]


def point_world_to_urdf(p) -> np.ndarray:
    return T_URDF_WORLD[:3, :3] @ np.asarray(p, dtype=float) + T_URDF_WORLD[:3, 3]

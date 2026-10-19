
import numpy as np
import pytest

from elrobot_ik.kinematics import transforms as T


def test_rpy_round_trip():
    R = T.rpy_to_rotation(0.3, -0.5, 1.2)
    assert np.allclose(R @ R.T, np.eye(3))
    assert T.rotation_to_rpy(R) == pytest.approx((0.3, -0.5, 1.2))


def test_quaternion_to_rotation():
    assert np.allclose(T.quaternion_to_rotation(0, 0, 0, 1), np.eye(3))
    s, w = np.sin(0.2), np.cos(0.2)  # rotation of 0.4 rad about Z
    assert np.allclose(T.quaternion_to_rotation(0, 0, s, w), T.rpy_to_rotation(0, 0, 0.4))


def test_rotation_angle():
    assert T.rotation_angle(np.eye(3)) == pytest.approx(0.0)
    assert T.rotation_angle(T.rpy_to_rotation(0, 0, 0.4)) == pytest.approx(0.4)


def test_world_urdf_axes():
    # URDF +Y (arm forward at zero config) is world +X; URDF +X is world -Y.
    R = T.T_WORLD_URDF[:3, :3]
    assert R @ np.array([0.0, 1.0, 0.0]) == pytest.approx([1.0, 0.0, 0.0])
    assert R @ np.array([1.0, 0.0, 0.0]) == pytest.approx([0.0, -1.0, 0.0])
    p = np.array([0.1, 0.2, 0.3])
    assert T.point_world_to_urdf(T.point_urdf_to_world(p)) == pytest.approx(p)
    Tw = T.make_transform(T.rpy_to_rotation(0.1, 0.2, 0.3), p)
    assert np.allclose(T.urdf_to_world(T.world_to_urdf(Tw)), Tw)


def test_world_origin_is_on_base_yaw_axis():
    # Joint 1 (base yaw) sits at URDF (0, 0.0425, z); the world origin is that axis at table level.
    assert T.point_urdf_to_world(np.array([0.0, T.BASE_YAW_AXIS_URDF_Y, 0.049])) == pytest.approx([0.0, 0.0, 0.049], abs=1e-9)
    assert T.point_world_to_urdf(np.array([0.0, 0.0, 0.0])) == pytest.approx([0.0, T.BASE_YAW_AXIS_URDF_Y, 0.0])
    assert T.urdf_to_world(np.eye(4))[:3, 3] == pytest.approx([-T.BASE_YAW_AXIS_URDF_Y, 0.0, 0.0])

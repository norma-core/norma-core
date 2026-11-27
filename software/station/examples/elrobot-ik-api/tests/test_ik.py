import math

import numpy as np
import pytest

from elrobot_ik.kinematics.ik import ANG_TOL_RAD, POS_TOL_M, IKSolver
from elrobot_ik.kinematics.model import HOME_ANGLES
from elrobot_ik.kinematics.transforms import make_transform, rpy_to_rotation


@pytest.fixture(scope="module")
def solver(model):
    return IKSolver(model)


def down(x, y, z, yaw=0.0):
    """Tool pose with the gripper vertical (tcp +Y -> world -Z) and the jaws turned by yaw."""
    return make_transform(rpy_to_rotation(-math.pi / 2, 0.0, yaw), (x, y, z))


def test_vertical_pose_reaches_table_point(model, solver):
    res = solver.solve_pose(down(0.21, 0.05, 0.05), HOME_ANGLES)
    assert res.reachable, res
    T = model.fk(res.angles)
    assert T[:3, 3] == pytest.approx([0.21, 0.05, 0.05], abs=POS_TOL_M)
    assert T[:3, 1] == pytest.approx([0.0, 0.0, -1.0], abs=math.sin(ANG_TOL_RAD))
    assert res.angles[7] == pytest.approx(HOME_ANGLES[7])


def test_solve_keeps_gripper_angle_from_seed(solver):
    seed = list(HOME_ANGLES)
    seed[7] = 1.1
    res = solver.solve_pose(down(0.16, -0.05, 0.05), seed)
    assert res.reachable
    assert res.angles[7] == pytest.approx(1.1)


def test_solve_respects_joint_limits(model, solver):
    res = solver.solve_pose(down(0.16, 0.10, 0.03), HOME_ANGLES)
    assert res.reachable
    for a, lim in zip(res.angles, model.joint_limits):
        assert lim.lower - 1e-6 <= a <= lim.upper + 1e-6


def test_far_target_is_unreachable(solver):
    res = solver.solve_pose(down(1.0, 0.0, 0.05), HOME_ANGLES)
    assert res.reachable is False
    assert res.position_error > 0.3


def test_pose_round_trip_from_fk(model, solver):
    rng = np.random.default_rng(1)
    for _ in range(5):
        q = [rng.uniform(l.lower * 0.4, l.upper * 0.4) for l in model.joint_limits[:7]] + [0.5]
        T = model.fk(q)
        res = solver.solve_pose(T, HOME_ANGLES)
        assert res.reachable, (q, res)
        T2 = model.fk(res.angles)
        assert np.allclose(T2[:3, 3], T[:3, 3], atol=POS_TOL_M)
        assert res.angle_error <= ANG_TOL_RAD


def test_pose_explicit_orientation(model, solver):
    # Gripper pointing down (tcp +Y -> world -Z): Rx(-90) maps y to -z.
    R = rpy_to_rotation(-math.pi / 2, 0.0, 0.0)
    T = make_transform(R, (0.18, 0.0, 0.06))
    res = solver.solve_pose(T, HOME_ANGLES)
    assert res.reachable, res
    assert model.fk(res.angles)[:3, 1] == pytest.approx([0.0, 0.0, -1.0], abs=0.05)


def _pointing_down_pose(model, rng):
    """Build a joint configuration whose gripper axis points down, by tuning motor 6.

    Returns (angles, tcp_position_world) or None when no motor-6 angle within limits
    gets the axis within 1.5 degrees of vertical.
    """
    lims = model.joint_limits
    q = [rng.uniform(l.lower * 0.5, l.upper * 0.5) for l in lims[:7]] + [0.0]
    q[4] = 0.0  # keep the forearm roll neutral so pitch alone can point the gripper down
    q[6] = 0.0

    def axis_error(q6):
        q[5] = q6
        T = model.fk(q)
        return math.acos(max(-1.0, min(1.0, float(T[:3, 1] @ np.array([0.0, 0.0, -1.0])))))

    # golden-section search over motor 6's range
    lo, hi = lims[5].lower, lims[5].upper
    g = (math.sqrt(5) - 1) / 2
    a, b = hi - g * (hi - lo), lo + g * (hi - lo)
    fa, fb = axis_error(a), axis_error(b)
    for _ in range(60):
        if fa < fb:
            hi, b, fb = b, a, fa
            a = hi - g * (hi - lo)
            fa = axis_error(a)
        else:
            lo, a, fa = a, b, fb
            b = lo + g * (hi - lo)
            fb = axis_error(b)
    q6 = (lo + hi) / 2
    # The URDF joint axes are tilted by about a degree, so pitch alone cannot make the
    # gripper exactly vertical; accept poses within the solver's own angular tolerance.
    if axis_error(q6) > math.radians(1.5):
        return None
    return list(q), model.fk(q)[:3, 3].copy()


def test_vertical_pose_round_trip_from_constructed_poses(model, solver):
    rng = np.random.default_rng(7)
    checked = 0
    for _ in range(300):
        if checked >= 6:
            break
        built = _pointing_down_pose(model, rng)
        if built is None or built[1][2] < 0.0:
            continue
        angles, target = built
        res = solver.solve_pose(model.fk(angles), HOME_ANGLES)
        assert res.reachable, (target, angles, res)
        T = model.fk(res.angles)
        assert T[:3, 3] == pytest.approx(target, abs=POS_TOL_M)
        checked += 1
    assert checked == 6, "could not construct enough pointing-down poses"


# Joint angles read from the real arm in its folded rest pose (2026-10-16): elbow behind
# the base, forearm forward, gripper 10 cm up. From here the first QP restart points the
# gripper down by folding the wrist to its 101 deg limit, where the wrist link hits the
# forearm link.
FOLDED_REST = [math.radians(a) for a in (1.9, -82.9, -8.3, 94.4, 7.4, 10.4, 2.7, 104.8)]


def test_vertical_pose_from_folded_rest_is_collision_free(model, solver):
    # (0.20, 0, 0.06) is near the edge of the vertical-gripper workspace: seeds end with the
    # wrist close to its 101 deg limit, where some variants collide. The accepted one must not.
    target = np.array([0.20, 0.0, 0.06])
    ok = solver.solve_pose(down(*target), FOLDED_REST, accept=lambda q: not model.collisions(q).any)
    assert ok.reachable
    assert not model.collisions(ok.angles).any
    assert model.fk(ok.angles)[:3, 3] == pytest.approx(target, abs=POS_TOL_M)


def test_solver_prefers_solutions_away_from_joint_limits(model, solver):
    res = solver.solve_pose(down(0.18, 0.0, 0.05), FOLDED_REST, accept=lambda q: not model.collisions(q).any)
    assert res.reachable
    margin = min(min(a - l.lower, l.upper - a) for a, l in zip(res.angles[:7], model.joint_limits[:7]))
    assert margin >= math.radians(10), f"margin {math.degrees(margin):.1f} deg"
    assert abs(res.angles[5]) < math.radians(90)


def test_accept_callback_never_satisfied_returns_best_unaccepted(solver):
    res = solver.solve_pose(down(0.20, 0.0, 0.08), FOLDED_REST, accept=lambda q: False)
    assert res.reachable  # caller decides what to do with it (the service answers 422 collision)

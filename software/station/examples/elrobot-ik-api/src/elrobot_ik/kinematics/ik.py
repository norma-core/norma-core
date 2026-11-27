"""Inverse kinematics on top of placo's QP KinematicsSolver."""
from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np
import placo

from elrobot_ik.kinematics.model import HOME_ANGLES, MIMIC_JOINTS, MOTOR_JOINTS, TCP_FRAME, ElrobotModel
from elrobot_ik.kinematics.transforms import rotation_angle, world_to_urdf

POS_TOL_M = 0.003
ANG_TOL_RAD = math.radians(2)
MAX_ITERS = 200
_CONVERGED_STEP = 1e-5  # m-equivalent: an error change below this does not count as progress
_REGULARIZATION = 1e-3  # damping; weaker values overshoot into joint limits on the first step
_STALL_ITERS = 15  # stop an attempt when the error has not improved for this many iterations
_RESTARTS = 8  # deterministic random seeds tried after the caller's seed and home
_SEED_SPAN = 0.6  # random seeds stay within this fraction of each joint's limits
# A posture with the gripper already pointing down (from a converged solve); a good third seed.
_READY_DOWN = [0.0, 0.48, -0.12, -0.05, 0.0, 1.26, 0.0]
_MARGIN_CAP_RAD = math.radians(15)  # beyond this distance from a joint limit, margins are all "good enough"


@dataclass
class IKResult:
    angles: list[float]
    position_error: float
    angle_error: float
    reachable: bool
    iterations: int
    accepted: bool = False  # reachable and passed the caller's accept filter (e.g. collision-free)


class IKSolver:
    def __init__(self, model: ElrobotModel):
        self.model = model

    # -- public ------------------------------------------------------------

    def solve_pose(
        self, T_world_tcp: np.ndarray, seed_angles: Sequence[float], accept: Callable[[list[float]], bool] | None = None
    ) -> IKResult:
        T_urdf = world_to_urdf(np.asarray(T_world_tcp, dtype=float))

        def add_tasks(solver: placo.KinematicsSolver) -> None:
            frame = solver.add_frame_task(TCP_FRAME, T_urdf)
            frame.configure("tcp_frame", "soft", 1.0, 1.0)

        def errors() -> tuple[float, float]:
            T = self.model.frame_urdf(TCP_FRAME)
            pos_err = float(np.linalg.norm(T[:3, 3] - T_urdf[:3, 3]))
            return pos_err, rotation_angle(T[:3, :3].T @ T_urdf[:3, :3])

        return self._solve(add_tasks, errors, seed_angles, accept)

    # -- internals ---------------------------------------------------------

    def _solve(
        self,
        add_tasks: Callable[[placo.KinematicsSolver], None],
        errors: Callable[[], tuple[float, float]],
        seed_angles: Sequence[float],
        accept: Callable[[list[float]], bool] | None = None,
    ) -> IKResult:
        """Solve from every restart seed, then pick the best solution that passes `accept`.

        Solving is cheap (about 1 ms for all seeds); `accept` may be expensive (a collision
        check), so candidates are ranked first, deduplicated, and accepted lazily in rank order:
        farthest from any joint limit (capped at 15 deg, so a comfortable margin is not traded
        for a huge swing), then closest to the caller's seed. Without an accepted solution the
        best reachable one is returned with `accepted=False`, so the caller can report why.
        """
        seed = [float(a) for a in seed_angles]
        if len(seed) != 8:
            raise ValueError("expected 8 seed angles")
        gripper = seed[7]
        results = [self._solve_from(add_tasks, errors, [*start, gripper], gripper) for start in self._starts(seed[:7])]
        reachable = sorted(
            (r for r in results if r.reachable),
            key=lambda r: (-min(self._limit_margin(r.angles), _MARGIN_CAP_RAD), self._distance(r.angles, seed)),
        )
        seen: set[tuple[float, ...]] = set()
        for res in reachable:
            key = tuple(round(a, 3) for a in res.angles)
            if key in seen:
                continue
            seen.add(key)
            if accept is None or accept(list(res.angles)):
                res.accepted = True
                return res
        if reachable:
            return reachable[0]
        return min(results, key=self._score)

    def _limit_margin(self, angles: Sequence[float]) -> float:
        return min(min(a - lim.lower, lim.upper - a) for a, lim in zip(angles[:7], self.model.joint_limits[:7]))

    @staticmethod
    def _distance(a: Sequence[float], b: Sequence[float]) -> float:
        return float(np.linalg.norm(np.asarray(a[:7]) - np.asarray(b[:7])))

    def _starts(self, seed7: list[float]):
        """Yield arm seeds: caller's, home, ready-down, then deterministic random restarts.

        The QP solver is local: from some seeds it parks a joint at its limit short of the
        target. Restarts from diverse postures get around that; a fixed RNG keeps results
        reproducible for the same request.
        """
        yield list(seed7)
        yield list(HOME_ANGLES[:7])
        yield list(_READY_DOWN)
        rng = np.random.default_rng(0)
        lims = self.model.joint_limits[:7]
        for _ in range(_RESTARTS):
            yield [float(rng.uniform(l.lower * _SEED_SPAN, l.upper * _SEED_SPAN)) for l in lims]

    @staticmethod
    def _score(res: IKResult) -> float:
        return res.position_error + 0.05 * res.angle_error

    def _solve_from(self, add_tasks, errors, start: list[float], gripper: float) -> IKResult:
        robot = self.model.robot
        start = [
            min(max(a, lim.lower), lim.upper) for a, lim in zip(start, self.model.joint_limits)
        ]  # a seed read from hardware can sit a few steps past a limit
        self.model.set_angles(start)
        solver = placo.KinematicsSolver(robot)
        solver.mask_fbase(True)
        solver.enable_joint_limits(True)
        # Motor 8 and the mimic jaw joints are not part of the arm IK.
        for name in [MOTOR_JOINTS[7], *MIMIC_JOINTS]:
            solver.mask_dof(name)
        add_tasks(solver)
        solver.add_regularization_task(_REGULARIZATION)

        iterations = 0
        best_err = math.inf
        since_improved = 0
        for iterations in range(1, MAX_ITERS + 1):
            solver.solve(True)
            robot.update_kinematics()
            pos_err, ang_err = errors()
            if pos_err <= POS_TOL_M * 0.3 and ang_err <= ANG_TOL_RAD * 0.3:
                break
            err = pos_err + 0.05 * ang_err
            if err < best_err - _CONVERGED_STEP:
                best_err = err
                since_improved = 0
            else:
                since_improved += 1
                if since_improved >= _STALL_ITERS:
                    break

        angles = self.model.angles()
        angles[7] = gripper
        self.model.set_angles(angles)  # restore mimic joints consistently
        pos_err, ang_err = errors()
        return IKResult(
            angles=angles,
            position_error=pos_err,
            angle_error=ang_err,
            reachable=pos_err <= POS_TOL_M and ang_err <= ANG_TOL_RAD,
            iterations=iterations,
        )

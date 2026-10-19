"""Map calibrated servo steps onto URDF joint angles and back.

The station's calibration freezes each motor's physical arc as
[range_min, range_max] (wrap-aware when range_min > range_max). The URDF
limits were measured from the same physical stops, so the arc maps
linearly onto [lower, upper]. Direction +1 means increasing steps
increases the URDF angle; -1 is the opposite. JOINT_DIRECTIONS was verified
on an ElRobot follower on 2026-10-16: +1 for motors 1-7, -1 for the gripper
(motor 8), whose URDF angle 0 is jaws open while fewer steps close them.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from elrobot_ik.station.arms import ELROBOT_MOTOR_IDS, BusSnapshot, MotorSnapshot
from elrobot_ik.station.registers import STEPS_PER_REV

MIN_CALIBRATED_RANGE = 100
JOINT_DIRECTIONS = (1, 1, 1, 1, 1, 1, 1, -1)


@dataclass(frozen=True)
class JointLimits:
    name: str
    lower: float
    upper: float

    @property
    def span(self) -> float:
        return self.upper - self.lower


def arc_length(range_min: int, range_max: int) -> int:
    if range_min <= range_max:
        return range_max - range_min
    return (STEPS_PER_REV - range_min) + range_max


def arc_fraction(steps: int, range_min: int, range_max: int) -> float:
    """Position of `steps` along the arc: 0 at range_min, 1 at range_max.

    Steps outside the arc (encoder jitter at a physical stop, or a motor pushed
    past its calibrated range) extrapolate linearly from the nearer end, so a
    few steps past the arc read as a few steps past the limit rather than as a
    wild angle from the far side of the circle.
    """
    length = arc_length(range_min, range_max)
    if length == 0:
        return 0.0
    offset = (steps - range_min) % STEPS_PER_REV
    if offset > length:
        past_max = offset - length
        before_min = STEPS_PER_REV - offset
        if before_min < past_max:
            return -before_min / length
        return 1.0 + past_max / length
    return offset / length


def arc_steps(fraction: float, range_min: int, range_max: int) -> int:
    fraction = min(1.0, max(0.0, fraction))
    length = arc_length(range_min, range_max)
    return int(range_min + round(fraction * length)) % STEPS_PER_REV


def clamp_to_arc(steps: int, range_min: int, range_max: int) -> int:
    """Nearest step inside the calibrated arc (wrap-aware)."""
    return arc_steps(arc_fraction(steps, range_min, range_max), range_min, range_max)


def step_distance(a: int, b: int) -> int:
    """Shortest distance between two encoder positions on the circle."""
    d = abs(a - b) % STEPS_PER_REV
    return min(d, STEPS_PER_REV - d)


class MotorMapper:
    def __init__(self, limits: list[JointLimits], directions: Sequence[int] = JOINT_DIRECTIONS):
        if len(limits) != 8 or len(directions) != 8:
            raise ValueError("MotorMapper needs 8 joint limits and 8 directions")
        if any(d not in (1, -1) for d in directions):
            raise ValueError("directions must be +1 or -1")
        self.limits = list(limits)
        self.directions = list(directions)

    # -- calibration -------------------------------------------------------

    def uncalibrated_motors(self, bus: BusSnapshot) -> list[int]:
        bad: list[int] = []
        for motor_id in ELROBOT_MOTOR_IDS:
            m = bus.motor(motor_id)
            if m is None or not m.range_frozen or arc_length(m.range_min, m.range_max) < MIN_CALIBRATED_RANGE:
                bad.append(motor_id)
        return bad

    def is_calibrated(self, bus: BusSnapshot) -> bool:
        return not self.uncalibrated_motors(bus)

    # -- single joint ------------------------------------------------------

    def steps_to_angle(self, index: int, steps: int, motor: MotorSnapshot) -> float:
        lim = self.limits[index]
        p = arc_fraction(steps, motor.range_min, motor.range_max)
        return lim.upper - p * lim.span if self.directions[index] < 0 else lim.lower + p * lim.span

    def angle_to_steps(self, index: int, angle: float, motor: MotorSnapshot) -> int:
        lim = self.limits[index]
        if lim.span == 0:
            return motor.range_min
        if self.directions[index] < 0:
            p = (lim.upper - angle) / lim.span
        else:
            p = (angle - lim.lower) / lim.span
        return arc_steps(p, motor.range_min, motor.range_max)

    def arc_mismatch_deg(self, index: int, motor: MotorSnapshot) -> float:
        physical_deg = arc_length(motor.range_min, motor.range_max) * 360.0 / STEPS_PER_REV
        return physical_deg - math.degrees(self.limits[index].span)

    # -- whole bus ---------------------------------------------------------

    @staticmethod
    def _motors(bus: BusSnapshot) -> list[MotorSnapshot]:
        motors = [bus.motor(i) for i in ELROBOT_MOTOR_IDS]
        missing = [i for i, m in zip(ELROBOT_MOTOR_IDS, motors) if m is None]
        if missing:
            raise ValueError(f"motors {missing} missing from bus {bus.serial}")
        return motors

    def bus_angles(self, bus: BusSnapshot) -> list[float]:
        return [self.steps_to_angle(i, m.steps, m) for i, m in enumerate(self._motors(bus))]

    def angles_to_steps(self, angles: list[float], bus: BusSnapshot) -> list[int]:
        if len(angles) != 8:
            raise ValueError("expected 8 joint angles")
        return [self.angle_to_steps(i, a, m) for i, (a, m) in enumerate(zip(angles, self._motors(bus)))]

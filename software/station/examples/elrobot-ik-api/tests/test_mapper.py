import math

import pytest

from elrobot_ik.calibration.mapper import (
    JointLimits,
    MotorMapper,
    arc_fraction,
    arc_length,
    arc_steps,
)
from elrobot_ik.station.arms import parse_frame
from tests.helpers import make_bus_state, make_elrobot_bus, make_frame, make_motor_state

LIMITS = [
    JointLimits("rev_motor_01", -1.5509, 1.5509),
    JointLimits("rev_motor_02", -1.6122, 1.6122),
    JointLimits("rev_motor_03", -1.7610, 1.7610),
    JointLimits("rev_motor_04", -1.7533, 1.7533),
    JointLimits("rev_motor_05", -2.62, 3.252),
    JointLimits("rev_motor_06", -1.3775, 1.7641),
    JointLimits("rev_motor_07", -3.2014, 2.7336),
    JointLimits("rev_motor_08", 0.0, 2.2028),
]


def mapper(directions=None):
    return MotorMapper(LIMITS, directions or [-1] * 8)


def test_default_directions_are_the_hardware_verified_ones():
    assert MotorMapper(LIMITS).directions == [1, 1, 1, 1, 1, 1, 1, -1]


def bus(**kw):
    return parse_frame(make_frame(make_elrobot_bus("B", **kw)))[0]


def test_arc_length_plain_and_wrapped():
    assert arc_length(1024, 3072) == 2048
    assert arc_length(3500, 500) == 1096  # 3500..4095 (596) + 0..500 (500)


def test_arc_fraction_and_steps_plain():
    assert arc_fraction(1024, 1024, 3072) == 0.0
    assert arc_fraction(3072, 1024, 3072) == 1.0
    assert arc_fraction(2048, 1024, 3072) == 0.5
    assert arc_steps(0.5, 1024, 3072) == 2048
    assert arc_steps(-0.2, 1024, 3072) == 1024  # clamped
    assert arc_steps(1.7, 1024, 3072) == 3072  # clamped


def test_wraparound_arc_round_trip():
    lo, hi = 3500, 500
    for steps in (3500, 4000, 4095, 0, 250, 500):
        f = arc_fraction(steps, lo, hi)
        assert 0.0 <= f <= 1.0
        back = arc_steps(f, lo, hi)
        assert 0 <= back <= 4095
        assert back == steps
    assert arc_fraction(0, lo, hi) == pytest.approx(596 / 1096)


def test_reversed_direction_maps_min_to_upper():
    m = mapper()
    b = bus()
    mot = b.motor(1)
    assert m.steps_to_angle(0, 1024, mot) == pytest.approx(1.5509)
    assert m.steps_to_angle(0, 3072, mot) == pytest.approx(-1.5509)
    assert m.steps_to_angle(0, 2048, mot) == pytest.approx(0.0)


def test_forward_direction_maps_min_to_lower():
    m = mapper([1] * 8)
    mot = bus().motor(1)
    assert m.steps_to_angle(0, 1024, mot) == pytest.approx(-1.5509)


def test_angle_round_trip_all_joints():
    m = mapper()
    b = bus()
    for i in range(8):
        lo, hi = LIMITS[i].lower, LIMITS[i].upper
        for angle in (lo, (lo + hi) / 2, hi, lo + 0.3 * (hi - lo)):
            steps = m.angle_to_steps(i, angle, b.motor(i + 1))
            assert 1024 <= steps <= 3072
            back = m.steps_to_angle(i, steps, b.motor(i + 1))
            # one step = (hi-lo)/2048 rad on this arc
            assert back == pytest.approx(angle, abs=(hi - lo) / 2048 + 1e-9)


def test_angle_to_steps_clamps_to_arc():
    m = mapper()
    mot = bus().motor(1)
    assert m.angle_to_steps(0, 5.0, mot) == 1024  # beyond upper -> arc min (reversed)
    assert m.angle_to_steps(0, -5.0, mot) == 3072


def test_bus_angles_and_angles_to_steps():
    m = mapper()
    b = bus(positions=[2048] * 8)
    angles = m.bus_angles(b)
    assert len(angles) == 8
    assert angles[0] == pytest.approx(0.0)
    assert angles[7] == pytest.approx(2.2028 / 2)  # motor 8 arc center = mid of 0..2.2
    assert m.angles_to_steps(angles, b) == [2048] * 8


def test_uncalibrated_detection():
    m = mapper()
    assert m.uncalibrated_motors(bus()) == []
    assert m.is_calibrated(bus())
    assert m.uncalibrated_motors(bus(calibrated=False)) == [1, 2, 3, 4, 5, 6, 7, 8]
    # frozen but too narrow
    narrow = make_bus_state(
        "N",
        [make_motor_state(i, 2048, range_min=2000, range_max=2050, frozen=True) for i in range(1, 9)],
    )
    nb = parse_frame(make_frame(narrow))[0]
    assert m.uncalibrated_motors(nb) == [1, 2, 3, 4, 5, 6, 7, 8]
    assert not m.is_calibrated(nb)


def test_missing_motor_counts_as_uncalibrated():
    seven = make_bus_state("S", [make_motor_state(i, 2048, range_min=1024, range_max=3072, frozen=True) for i in range(1, 8)])
    sb = parse_frame(make_frame(seven))[0]
    assert mapper().uncalibrated_motors(sb) == [8]


def test_arc_mismatch_deg():
    m = mapper()
    mot = bus().motor(1)  # arc 2048 steps = 180 deg; urdf range 2*1.5509 rad = 177.7 deg
    assert m.arc_mismatch_deg(0, mot) == pytest.approx(180.0 - math.degrees(2 * 1.5509), abs=1e-6)


def test_steps_just_outside_arc_extrapolate_toward_nearer_end():
    # plain arc 1024..3072: 4 steps below min -> small negative fraction; 4 above max -> just over 1
    assert arc_fraction(1020, 1024, 3072) == pytest.approx(-4 / 2048)
    assert arc_fraction(3076, 1024, 3072) == pytest.approx(1 + 4 / 2048)
    # wrapped arc 3500..500 (length 1096): 10 below min, 5 above max
    assert arc_fraction(3490, 3500, 500) == pytest.approx(-10 / 1096)
    assert arc_fraction(505, 3500, 500) == pytest.approx(1 + 5 / 1096)
    # far side of the circle extrapolates from the nearer end (1452 steps before min), never from
    # the far end (1548 past max)
    assert arc_fraction(2048, 3500, 500) == pytest.approx(-1452 / 1096)


def test_angle_outside_arc_lands_within_overshoot_of_limit():
    m = mapper()
    b = bus()
    for i in (0, 4, 7):
        lim = LIMITS[i]
        mot = b.motor(i + 1)
        step_rad = lim.span / 2048
        for k in (1, 5, 20):
            # below arc min -> (direction -1) just past the upper limit, by about k steps
            a = m.steps_to_angle(i, 1024 - k, mot)
            assert lim.upper < a <= lim.upper + (k + 1) * step_rad
            a = m.steps_to_angle(i, 3072 + k, mot)
            assert lim.lower - (k + 1) * step_rad <= a < lim.lower
    # a wrapped arc below its min
    wrapped = parse_frame(make_frame(make_bus_state(
        "W", [make_motor_state(j, 3490, range_min=3500, range_max=500, frozen=True) for j in range(1, 9)]
    )))[0]
    a = m.steps_to_angle(0, 3490, wrapped.motor(1))
    assert LIMITS[0].upper < a <= LIMITS[0].upper + 11 * (LIMITS[0].span / 1096)

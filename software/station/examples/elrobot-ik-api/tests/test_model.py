import math
import xml.etree.ElementTree as ET

import numpy as np
import pytest

from elrobot_ik import URDF_PATH
from elrobot_ik.kinematics.model import (
    HOME_ANGLES,
    MOTOR_JOINTS,
    TABLE_FRAME,
    TCP_FRAME,
    inject_frames,
)


def test_inject_frames_adds_tcp_and_table(tmp_path):
    out = inject_frames(URDF_PATH, tmp_path)
    root = ET.parse(out).getroot()
    links = {l.get("name") for l in root.findall("link")}
    joints = {j.get("name"): j for j in root.findall("joint")}
    assert TCP_FRAME in links and TABLE_FRAME in links
    assert joints["tcp_joint"].find("parent").get("link") == "Gripper_Base_v1_1"
    assert joints["tcp_joint"].find("origin").get("xyz") == "0.0018 0.104 0.0003"
    assert joints["table_surface_joint"].find("parent").get("link") == "base_link"
    # mesh paths were made absolute so the temp file can live anywhere
    mesh = root.find(".//mesh")
    assert mesh.get("filename").startswith("/")


def test_joint_limits_in_motor_order(model):
    names = [jl.name for jl in model.joint_limits]
    assert names == MOTOR_JOINTS
    assert model.joint_limits[4].lower == pytest.approx(-2.62)
    assert model.joint_limits[4].upper == pytest.approx(3.252)
    assert model.joint_limits[7].lower == pytest.approx(0.0)


def test_fk_home_puts_tcp_in_front_of_base(model):
    T = model.fk(HOME_ANGLES)
    # jaw tip center URDF (0.0047, 0.3636, 0.2192), shifted so the base yaw axis (URDF y=0.0425) is
    # the origin and rotated by -90 deg about Z -> world (0.3211, -0.0047, 0.2192)
    assert T[:3, 3] == pytest.approx([0.3211, -0.0047, 0.2192], abs=0.002)
    # gripper approach axis (tcp +Y) points forward (+X world) at home
    assert T[:3, 1] == pytest.approx([1.0, 0.0, 0.0], abs=1e-6)


def test_set_and_get_angles_with_mimic(model):
    angles = [0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, 1.0]
    model.set_angles(angles)
    assert model.angles() == pytest.approx(angles)
    assert model.robot.get_joint("rev_motor_08_1") == pytest.approx(-0.0115)
    assert model.robot.get_joint("rev_motor_08_2") == pytest.approx(0.0115)


def test_base_yaw_rotates_tcp_about_joint1_axis(model):
    from elrobot_ik.kinematics.transforms import urdf_to_world

    T0 = model.fk(HOME_ANGLES)
    pivot = urdf_to_world(model.frame_urdf("rev_motor_01"))[:3, 3]
    assert pivot[:2] == pytest.approx([0.0, 0.0], abs=1e-6)  # world origin sits on the yaw axis
    T1 = model.fk([math.pi / 2] + [0.0] * 7)
    d0 = T0[:2, 3] - pivot[:2]
    d1 = T1[:2, 3] - pivot[:2]
    assert np.hypot(*d1) == pytest.approx(np.hypot(*d0), abs=0.003)  # axis is tilted 0.5 deg in the URDF
    assert T1[2, 3] == pytest.approx(T0[2, 3], abs=0.005)
    turned = math.atan2(d1[1], d1[0]) - math.atan2(d0[1], d0[0])
    assert turned == pytest.approx(math.pi / 2, abs=0.02)  # positive motor-1 angle turns the arm left


def test_home_has_no_collisions(model):
    rep = model.collisions(HOME_ANGLES)
    assert rep.self_pairs == []
    assert rep.table_pairs == []
    assert rep.any is False


def test_configuration_below_table_reports_table_collision(model):
    # Pitch the shoulder forward until the tcp dips under the table, then expect a table hit.
    hit = None
    for a in np.linspace(0.0, model.joint_limits[1].upper, 40):
        angles = [0.0, a, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        if model.fk(angles)[2, 3] < -0.02:
            hit = angles
            break
    assert hit is not None, "could not find a below-table pose by pitching motor 2"
    rep = model.collisions(hit)
    assert rep.table_pairs, "expected a table collision"
    assert rep.any is True

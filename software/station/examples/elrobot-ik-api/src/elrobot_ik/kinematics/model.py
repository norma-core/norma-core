"""placo model of the ElRobot with an injected tcp frame and table surface."""
from __future__ import annotations

import os
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import placo

from elrobot_ik import URDF_PATH
from elrobot_ik.calibration.mapper import JointLimits
from elrobot_ik.kinematics.transforms import urdf_to_world

MOTOR_JOINTS = [f"rev_motor_0{i}" for i in range(1, 9)]
MIMIC_JOINTS = {"rev_motor_08_1": -0.0115, "rev_motor_08_2": 0.0115}
HOME_ANGLES = [0.0] * 8

TCP_FRAME = "tcp"
TABLE_FRAME = "table_surface"
GRIPPER_PARENT = "Gripper_Base_v1_1"
# Tool point = center of the closed jaws' tip edge, from the meshes (the edge spans 0.020 across).
TCP_OFFSET = (0.0018, 0.104, 0.0003)

# Collision bodies ignored, matching robots-lab: servo housings always touch
# their bracket, and these bracket pairs touch by design.
IGNORED_PREFIXES = ("ST3215",)
IGNORED_PAIRS = {
    frozenset(p)
    for p in [
        ("Joint_04_v1_1", "Joint_05_v1_1"),
        ("Gripper_Base_v1_1", "Gripper_Jaw_02_v1_1"),
        ("Gripper_Base_v1_1", "Gripper_Jaw_01_v1_1"),
        ("Joint_06_v1_1", "Gripper_Base_v1_1"),
        ("Gripper_Gear_v1_1", "Gripper_Jaw_02_v1_1"),
        ("Gripper_Gear_v1_1", "Gripper_Jaw_01_v1_1"),
    ]
}


def _body_link(name: str) -> str:
    """placo names collision bodies '<link>_<n>'; strip the geometry index."""
    head, _, tail = name.rpartition("_")
    return head if tail.isdigit() else name


def inject_frames(urdf_path: Path, out_dir: Path) -> Path:
    tree = ET.parse(urdf_path)
    root = tree.getroot()
    _rebase_meshes(root, f"{urdf_path.parent.resolve()}/")
    _inject_tcp_and_table(root)
    out = Path(out_dir) / "elrobot_ik_model.urdf"
    tree.write(out, xml_declaration=True, encoding="unicode")
    return out


def _rebase_meshes(root: ET.Element, base: str) -> None:
    """Prefix relative mesh paths (`assets/x.stl`) with `base` so the XML resolves from anywhere."""
    for mesh in root.iter("mesh"):
        fn = mesh.get("filename", "")
        if fn and not fn.startswith(("/", "package://", "file://")):
            mesh.set("filename", base + fn)


def _inject_tcp_and_table(root: ET.Element) -> None:
    ET.SubElement(root, "link", name=TCP_FRAME)
    j = ET.SubElement(root, "joint", name="tcp_joint", type="fixed")
    ET.SubElement(j, "parent", link=GRIPPER_PARENT)
    ET.SubElement(j, "child", link=TCP_FRAME)
    ET.SubElement(j, "origin", xyz=" ".join(f"{v:g}" for v in TCP_OFFSET), rpy="0 0 0")

    table = ET.SubElement(root, "link", name=TABLE_FRAME)
    col = ET.SubElement(table, "collision")
    ET.SubElement(col, "origin", xyz="0 0 -0.005", rpy="0 0 0")
    geo = ET.SubElement(col, "geometry")
    ET.SubElement(geo, "box", size="10 10 0.01")
    tj = ET.SubElement(root, "joint", name="table_surface_joint", type="fixed")
    ET.SubElement(tj, "parent", link="base_link")
    ET.SubElement(tj, "child", link=TABLE_FRAME)
    ET.SubElement(tj, "origin", xyz="0 0 0", rpy="0 0 0")


def urdf_xml(urdf_path: Path, with_frames: bool, mesh_base: str | None = None) -> str:
    """URDF text, optionally with the tcp frame and table surface injected, and with relative
    mesh paths rebased onto `mesh_base` (a URL prefix such as `/urdf/`) when given."""
    root = ET.parse(urdf_path).getroot()
    if mesh_base:
        _rebase_meshes(root, mesh_base)
    if with_frames:
        _inject_tcp_and_table(root)
    return '<?xml version="1.0" ?>\n' + ET.tostring(root, encoding="unicode")


def _quiet_stdout(fn):
    """Run fn with C-level stdout silenced (placo prints collision warnings)."""
    try:
        fd = sys.stdout.fileno()
    except (AttributeError, OSError, ValueError):
        return fn()  # stdout is captured or not a real file; just run
    saved = os.dup(fd)
    devnull = os.open(os.devnull, os.O_WRONLY)
    try:
        sys.stdout.flush()
        os.dup2(devnull, fd)
        return fn()
    finally:
        os.dup2(saved, fd)
        os.close(saved)
        os.close(devnull)


@dataclass
class CollisionReport:
    self_pairs: list[tuple[str, str]] = field(default_factory=list)
    table_pairs: list[tuple[str, str]] = field(default_factory=list)

    @property
    def any(self) -> bool:
        return bool(self.self_pairs or self.table_pairs)


class ElrobotModel:
    def __init__(self, urdf_path: Path = URDF_PATH):
        if not Path(urdf_path).is_file():
            raise FileNotFoundError(f"{urdf_path} is missing: the build copies it from hardware/elrobot/simulation; "
                                    "run `uv sync --reinstall-package elrobot-ik`")
        self._tmpdir = tempfile.TemporaryDirectory(prefix="elrobot_ik_")
        self.urdf_path = inject_frames(Path(urdf_path), Path(self._tmpdir.name))
        self.robot: placo.RobotWrapper = _quiet_stdout(lambda: placo.RobotWrapper(str(self.urdf_path)))
        self._prune_ignored_collision_pairs()
        self.joint_limits = [
            JointLimits(name, *map(float, self.robot.get_joint_limits(name))) for name in MOTOR_JOINTS
        ]
        self.set_angles(HOME_ANGLES)

    def close(self) -> None:
        self._tmpdir.cleanup()

    @staticmethod
    def _is_ignored_pair(a: str, b: str) -> bool:
        if TABLE_FRAME in (a, b):
            return "base_link" in (a, b)
        return a.startswith(IGNORED_PREFIXES) or b.startswith(IGNORED_PREFIXES) or frozenset((a, b)) in IGNORED_PAIRS

    def _prune_ignored_collision_pairs(self) -> None:
        """Drop the always-touching pairs from the collision model so each check costs ~3x less.

        collisions() still filters by name, so a model where pruning is unavailable behaves the same.
        """
        try:
            gm = self.robot.collision_model
            names = [g.name for g in gm.geometryObjects]
            doomed = [cp for cp in gm.collisionPairs if self._is_ignored_pair(_body_link(names[cp.first]), _body_link(names[cp.second]))]
            for cp in doomed:
                gm.removeCollisionPair(cp)
        except AttributeError:  # older placo/pinocchio without these bindings
            return

    # -- state -------------------------------------------------------------

    def set_angles(self, angles: Sequence[float]) -> None:
        if len(angles) != 8:
            raise ValueError("expected 8 joint angles")
        for name, a in zip(MOTOR_JOINTS, angles):
            self.robot.set_joint(name, float(a))
        for name, ratio in MIMIC_JOINTS.items():
            self.robot.set_joint(name, ratio * float(angles[7]))
        self.robot.update_kinematics()

    def angles(self) -> list[float]:
        return [float(self.robot.get_joint(n)) for n in MOTOR_JOINTS]

    # -- kinematics --------------------------------------------------------

    def frame_urdf(self, name: str) -> np.ndarray:
        return np.array(self.robot.get_T_world_frame(name))

    def fk(self, angles: Sequence[float]) -> np.ndarray:
        self.set_angles(angles)
        return urdf_to_world(self.frame_urdf(TCP_FRAME))

    def collisions(self, angles: Sequence[float]) -> CollisionReport:
        self.set_angles(angles)
        report = CollisionReport()
        seen: set[frozenset[str]] = set()
        for c in self.robot.self_collisions(False):
            a, b = _body_link(c.bodyA), _body_link(c.bodyB)
            key = frozenset((a, b))
            if key in seen:
                continue
            if self._is_ignored_pair(a, b):
                continue
            seen.add(key)
            (report.table_pairs if TABLE_FRAME in (a, b) else report.self_pairs).append((a, b))
        return report

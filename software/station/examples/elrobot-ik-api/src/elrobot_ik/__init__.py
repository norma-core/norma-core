"""ElRobot inverse kinematics API."""
from pathlib import Path

URDF_PATH = Path(__file__).parent / "urdf" / "elrobot_follower.urdf"
GUIDE_PATH = Path(__file__).resolve().parents[2] / "AGENTS.md"  # repo checkout; absent in a bare wheel

try:
    from importlib.metadata import version as _version

    VERSION = _version("elrobot-ik")
except Exception:  # noqa: BLE001 - not installed as a distribution
    VERSION = "0.0.0"

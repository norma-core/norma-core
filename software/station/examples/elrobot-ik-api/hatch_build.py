"""Hatch build hook: copy the ElRobot model into the package instead of keeping a second copy.

The URDF and meshes live in the norma-core repo at hardware/elrobot/simulation. This runs for
editable installs (`uv sync`) and wheels alike; the copied files are gitignored.
"""
import shutil
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

MODEL_DIR = Path("hardware") / "elrobot" / "simulation"
URDF = "elrobot_follower.urdf"


class UrdfCopyHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict) -> None:
        root = Path(self.root)
        src = root.parents[3] / MODEL_DIR  # examples/ -> station/ -> software/ -> norma-core/
        dst = root / "src" / "elrobot_ik" / "urdf"
        if not (src / URDF).is_file():
            raise FileNotFoundError(f"ElRobot model not found at {src}; this example builds from inside a norma-core checkout")
        shutil.rmtree(dst, ignore_errors=True)
        dst.mkdir(parents=True)
        shutil.copy2(src / URDF, dst / URDF)
        shutil.copytree(src / "assets", dst / "assets")
        self.app.display_info(f"copied ElRobot URDF and meshes from {src}")

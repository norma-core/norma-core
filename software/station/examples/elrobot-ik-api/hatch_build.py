"""Hatch build hook: bring in the files this package needs from the norma-core checkout.

Instead of keeping second copies in git, at build time this
  - copies the ElRobot model (URDF and meshes) from hardware/elrobot/simulation into
    src/elrobot_ik/urdf/, and
  - generates the protobuf stubs from protobufs/ into src/elrobot_ik/station/proto/ with the
    protoc bundled in grpcio-tools (a build dependency, see pyproject.toml).
It runs for editable installs (`uv sync`) and wheels alike; the produced files are gitignored.
"""
import re
import shutil
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

MODEL_DIR = Path("hardware") / "elrobot" / "simulation"
URDF = "elrobot_follower.urdf"
PROTO_DIR = Path("protobufs")
# (include paths, proto files) per protoc run; usbvideo imports "usbvideo/frame.proto" so it is a subpackage.
PROTO_SETS = [
    (["station", "normfs", "drivers/st3215", "drivers/motors-mirroring"],
     ["normfs.proto", "drivers.proto", "commands.proto", "st3215.proto", "inference.proto", "mirroring.proto"]),
    (["drivers"], ["usbvideo/usbvideo.proto", "usbvideo/frame.proto"]),
]


class NormaCoreFilesHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict) -> None:
        root = Path(self.root)
        repo = root.parents[3]  # examples/ -> station/ -> software/ -> norma-core/
        if not (repo / MODEL_DIR / URDF).is_file() or not (repo / PROTO_DIR).is_dir():
            raise FileNotFoundError(f"norma-core checkout not found above {root}; this example builds from inside one")
        self._copy_model(repo / MODEL_DIR, root / "src" / "elrobot_ik" / "urdf")
        self._generate_protos(repo / PROTO_DIR, root / "src" / "elrobot_ik" / "station" / "proto")

    def _copy_model(self, src: Path, dst: Path) -> None:
        shutil.rmtree(dst, ignore_errors=True)
        dst.mkdir(parents=True)
        shutil.copy2(src / URDF, dst / URDF)
        shutil.copytree(src / "assets", dst / "assets")
        self.app.display_info(f"copied ElRobot URDF and meshes from {src}")

    def _generate_protos(self, src: Path, dst: Path) -> None:
        from grpc_tools import protoc

        for stale in dst.rglob("*_pb2.py"):
            stale.unlink()
        (dst / "usbvideo").mkdir(parents=True, exist_ok=True)
        for sub in ("", "usbvideo"):
            (dst / sub / "__init__.py").touch()
        for includes, files in PROTO_SETS:
            args = ["protoc", *(f"-I{src / inc}" for inc in includes), f"--python_out={dst}", *files]
            if protoc.main(args) != 0:
                raise RuntimeError(f"protoc failed for {files}")
        # protoc emits absolute imports between stubs (`import drivers_pb2`); make them package-relative.
        for stub in dst.rglob("*_pb2.py"):
            text = stub.read_text()
            text = re.sub(r"^import ([a-z0-9_]+_pb2) as ", r"from . import \1 as ", text, flags=re.MULTILINE)
            text = re.sub(r"^from usbvideo import ([a-z0-9_]+_pb2) as ", r"from . import \1 as ", text, flags=re.MULTILINE)
            stub.write_text(text)
        self.app.display_info(f"generated protobuf stubs from {src}")

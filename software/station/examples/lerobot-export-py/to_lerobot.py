"""Convert parquet files from export_fullres.py into a LeRobot dataset (v3.0).

Per frame:
  observation.state          follower position_norm (0-1 of the calibrated range), float32[n]
  action                     follower goal_norm, the mirrored leader pose (0-1), float32[n]
  observation.images.<name>  the camera, full resolution, stored as video
  task                       the parquet's task text

Frames are resampled onto an exact --fps grid with zero-order hold (each tick
takes the latest frame at or before it), since LeRobot assumes a fixed frame
rate and the recorder's rate jitters around its update-interval.
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import os
import shutil
import sys

import numpy as np
import pyarrow.parquet as pq
from PIL import Image

log = logging.getLogger("to_lerobot")


def episodes_of(path):
    """Tables of one episode each, in recording order."""
    t = pq.read_table(path)
    starts = t.column("episode_start_ns").to_pylist()
    for ep in sorted(set(starts)):
        yield t.take([i for i, s in enumerate(starts) if s == ep])


def resample(ts_ns, fps: int) -> np.ndarray:
    """Source frame index for each tick of a uniform fps grid from 0 to the last timestamp."""
    ts = np.asarray(ts_ns, dtype=np.int64)
    step = 1e9 / fps
    n = int(ts[-1] // step) + 1
    grid = (np.arange(n) * step).astype(np.int64)
    return np.clip(np.searchsorted(ts, grid, side="right") - 1, 0, len(ts) - 1)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("inputs", nargs="+", help="parquet files from export_fullres.py")
    p.add_argument("--repo-id", required=True, help="dataset id, e.g. <user>/<dataset>")
    p.add_argument("--root", required=True, help="output dataset folder")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--camera-name", default="wrist", help="feature name: observation.images.<name>")
    p.add_argument("--robot-type", default="elrobot")
    p.add_argument("--overwrite", action="store_true", help="replace --root if it exists")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    if os.path.exists(a.root):
        if not a.overwrite:
            sys.exit(f"{a.root} exists (use --overwrite)")
        shutil.rmtree(a.root)

    first = pq.read_table(a.inputs[0], columns=["joints", "image_width", "image_height"]).slice(0, 1).to_pylist()[0]
    nj, w, h = len(first["joints"]), first["image_width"], first["image_height"]
    names = [f"joint_{i + 1}" for i in range(nj)]
    image_key = f"observation.images.{a.camera_name}"
    features = {
        "observation.state": {"dtype": "float32", "shape": (nj,), "names": names},
        "action": {"dtype": "float32", "shape": (nj,), "names": names},
        image_key: {"dtype": "video", "shape": (h, w, 3), "names": ["height", "width", "channels"]},
    }
    ds = LeRobotDataset.create(repo_id=a.repo_id, fps=a.fps, root=a.root, robot_type=a.robot_type,
                               features=features, use_videos=True, image_writer_threads=2)

    report = []
    for path in a.inputs:
        for ep in episodes_of(path):
            rows = ep.to_pylist()
            if (rows[0]["image_width"], rows[0]["image_height"], len(rows[0]["joints"])) != (w, h, nj):
                sys.exit(f"{path}: image size or joint count differs from {a.inputs[0]}")
            ts = [r["timestamp_ns_since_episode_start"] for r in rows]
            src = resample(ts, a.fps)
            task = rows[0]["task"]
            for k in src:
                r = rows[k]
                ds.add_frame({
                    "observation.state": np.array([j["position_norm"] for j in r["joints"]], np.float32),
                    "action": np.array([j["goal_norm"] for j in r["joints"]], np.float32),
                    image_key: np.asarray(Image.open(io.BytesIO(r["images"][0]["jpeg"])).convert("RGB")),
                    "task": task,
                })
            ds.save_episode()
            used = len(set(src.tolist()))
            report.append(dict(source=os.path.basename(path), task=task, recorded_frames=len(rows),
                               duration_s=round(ts[-1] / 1e9, 2), output_frames=len(src),
                               repeated_frames=len(src) - used, dropped_frames=len(rows) - used))
            log.info("episode %d: %s", len(report) - 1, report[-1])
    ds.finalize()

    # LeRobot stages frames as PNGs under images/ while encoding; only the videos are kept.
    staging = os.path.join(a.root, "images")
    if os.path.isdir(staging) and not any(f for _, _, fs in os.walk(staging) for f in fs):
        shutil.rmtree(staging)

    with open(os.path.join(a.root, "normacore_conversion.json"), "w") as f:
        json.dump(dict(fps=a.fps, state="follower position_norm (0-1 of the calibrated range)",
                       action="follower goal_norm: the mirrored leader pose (0-1 of the calibrated range)",
                       image=f"{image_key} {w}x{h}", episodes=report), f, indent=2)
    log.info("done: %s, %d episode(s)", a.root, len(report))


if __name__ == "__main__":
    main()

"""Export a tagged recording as a parquet dataset at full camera resolution.

Runs the station's dataset-generator for episode segmentation (same rules,
same schema), then swaps each 224x224 image for the camera frame it was made
from, found in the raw usbvideo queue by its capture stamp.

Output: the dataset-generator schema with full-resolution JPEGs in `images`,
plus image_monotonic_stamp_ns, image_width and image_height columns.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import re
import shutil
import sys
import tempfile

import pyarrow as pa
import pyarrow.parquet as pq

import station_export as se
from software.station.shared.station_py import new_station_client

log = logging.getLogger("export_fullres")


def find_generator(path: str | None) -> str:
    for cand in (path, shutil.which("dataset-generator"),
                 os.path.expanduser("~/normacore/current/dataset-generator")):
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    sys.exit("dataset-generator not found; pass --generator")


async def run_generator(generator, station, frm, to, duration, min_commands, task, workdir):
    out = os.path.join(workdir, "episodes")
    cmd = [generator, "-no-tui", "-robot", station, "-from", str(frm), "-to", str(to),
           "-episode.duration", str(duration), "-episode.min-commands", str(min_commands),
           "-output", out, "-task", task]
    # Not subprocess.run: blocking the event loop starves the station client's
    # keep-alive, and the connection is gone by the time the generator ends.
    p = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE,
                                             stderr=asyncio.subprocess.STDOUT)
    raw, _ = await p.communicate()
    text = re.sub(r"\x1b\[[0-9;]*m", "", raw.decode("utf-8", "replace"))
    for line in text.splitlines():
        if re.search(r"saved|discarded", line, re.I):
            log.info("dataset-generator: %s", line.strip())
    m = re.search(r"Target queue inference/normvla bounds: \[(\d+) -> (\d+)\]", text)
    if p.returncode != 0 or not m or not os.path.exists(out + ".parquet"):
        sys.exit("dataset-generator failed or saved no episodes:\n" + text[-3000:])
    return out + ".parquet", int(m.group(1)), int(m.group(2))


async def export(args):
    client = await new_station_client(args.station, logging.getLogger("station_py"))

    if args.from_tag:
        tags = await se.list_tags(client)
        frm = se.resolve_tag(tags, args.from_tag, "last")
        to = se.resolve_tag(tags, args.to_tag, "first")
        log.info("tags: %r=%d, %r=%d", args.from_tag, frm, args.to_tag, to)
    else:
        frm, to = args.from_ptr, args.to_ptr
    if to <= frm:
        sys.exit(f"end pointer {to} is not after start pointer {frm}")

    cams = await se.video_queues_at(client, frm)
    if len(cams) <= args.camera:
        sys.exit(f"camera {args.camera} not recorded at {frm}; cameras: {[q for q, _ in cams]}")
    video_queue, video_start = cams[args.camera]
    log.info("camera %d: %s from entry %d", args.camera, video_queue, video_start)
    if not await se.read_entries(client, video_queue, video_start, 1):
        sys.exit(f"{video_queue} no longer holds entry {video_start}: the raw video of this range"
                 " was evicted (the queue keeps only the newest frames, up to the station's disk limit)")

    with tempfile.TemporaryDirectory() as tmp:
        seg_path, first, last = await run_generator(find_generator(args.generator), args.station, frm, to,
                                              args.episode_duration, args.min_commands, args.task, tmp)
        seg = pq.read_table(seg_path)

    stamp_of = await se.normvla_image_stamps(client, first, last, args.camera)
    want = [stamp_of.get(bytes(g)) for g in seg.column("global_frame_id").to_pylist()]
    if any(w is None for w in want):
        sys.exit(f"{sum(w is None for w in want)} exported frames have no camera {args.camera} image")

    col = await se.collect_frames(client, video_queue, video_start, set(want), args.jpeg_quality)
    missing = [w for w in want if w not in col.found]
    if missing:
        sys.exit(f"{len(missing)} of {len(want)} frames not found in {video_queue}"
                 f" (VP8 chains broken: {col.broken_vp8}); the raw video may have been"
                 f" evicted or recorded at 224 (resize_target)")
    frames = [col.found[w] for w in want]
    log.info("found all %d frames at %dx%d", len(frames), frames[0].width, frames[0].height)

    cols = {n: seg.column(n) for n in seg.column_names if n != "images"}
    table = pa.table({
        **cols,
        "images": pa.array([[{"jpeg": f.jpeg}] for f in frames],
                           type=pa.list_(pa.struct([pa.field("jpeg", pa.binary(), nullable=False)]))),
        "image_monotonic_stamp_ns": pa.array(want, pa.uint64()),
        "image_width": pa.array([f.width for f in frames], pa.uint32()),
        "image_height": pa.array([f.height for f in frames], pa.uint32()),
    })
    pq.write_table(table, args.output, compression="zstd")
    log.info("wrote %s: %d frames, %d episode(s)", args.output, table.num_rows,
             len(set(table.column("episode_start_ns").to_pylist())))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--from-tag", help="start tag (the latest one if repeated)")
    g.add_argument("--from", dest="from_ptr", type=int, help="start inference-states pointer")
    p.add_argument("--to-tag", help="end tag (the first one if repeated)")
    p.add_argument("--to", dest="to_ptr", type=int, help="end inference-states pointer")
    p.add_argument("--task", required=True, help="task description stored with each frame")
    p.add_argument("--output", required=True, help="output .parquet path")
    p.add_argument("--station", default="127.0.0.1", help="station address (default 127.0.0.1)")
    p.add_argument("--camera", type=int, default=0, help="camera index, as in normvla images (default 0)")
    p.add_argument("--generator", help="dataset-generator binary (default: PATH, then ~/normacore/current)")
    p.add_argument("--episode-duration", type=int, default=300, help="dataset-generator -episode.duration")
    p.add_argument("--min-commands", type=int, default=100, help="dataset-generator -episode.min-commands")
    p.add_argument("--jpeg-quality", type=int, default=95, help="JPEG quality for decoded VP8 frames")
    args = p.parse_args()
    if bool(args.from_tag) != bool(args.to_tag) or (args.from_ptr is None) != (args.to_ptr is None):
        p.error("use --from-tag with --to-tag, or --from with --to")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("station_py").setLevel(logging.WARNING)
    try:
        asyncio.run(export(args))
    except (LookupError, TimeoutError) as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()

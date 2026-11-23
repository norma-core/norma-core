# lerobot-export

Export a tagged recording at the camera's full resolution, and convert it to a
[LeRobot](https://github.com/huggingface/lerobot) dataset (format v3.0).

`dataset-generator` writes the images normvla records, which are 224x224
(resized without cropping). Each normvla image keeps the capture stamp of the
camera frame it came from, so the original frame can be found in the raw
`usbvideo/<camera>` queue. This example does that:

1. **`export_fullres.py`**: runs `dataset-generator` on a tag range for
   episode segmentation, then swaps every 224x224 image for its full-resolution
   camera frame, matched by exact capture stamp. The output is the
   dataset-generator parquet schema plus `image_monotonic_stamp_ns`,
   `image_width` and `image_height`. JPEG frames are copied as stored. VP8
   frames (the `usb-video` default) are decoded along their keyframe chain and
   saved as JPEG.
2. **`to_lerobot.py`**: turns one or more of those parquet files into a LeRobot
   dataset, one episode per recorded episode, with the camera stored as video.

The export needs only pyarrow, so it can run on the station host. The LeRobot
step pulls in torch, so run it on a bigger machine.

## Setup

From this folder:

```bash
uv sync                                    # export, JPEG cameras
uv sync --extra vp8                        # + PyAV, for cameras stored as VP8
uv sync --extra vp8 --extra lerobot        # + LeRobot, for to_lerobot.py
```

Then prefix the commands below with `uv run`. With plain pip, install
`pyarrow numpy pillow`, plus `av` for VP8 and `"lerobot[dataset]>=0.6,<0.7"` for
the conversion.

The scripts import `station_py` and the generated protobufs from this checkout,
so run them from inside the repository. `dataset-generator` is looked up with
`--generator`, then `PATH`, then `~/normacore/current/dataset-generator`.

## Recording

The recorder writes normvla frames only while mirroring is on (one bus with
torque). Each frame holds the follower joints, and the camera image closest to
it in time. Then:

- Set `inference.update-interval` to the frame rate you want (`33ms` for 30 Hz).
- Keep `usb-video.resize_target` at `0` while recording. With `224` the raw
  queue itself is downscaled, and there is nothing full-size to export.
- Add a start tag, perform the task, add an end tag **while mirroring is still
  on**, then stop mirroring.
- `dataset-generator` starts an episode at the first goal change after the start
  tag. It ends the episode once `-episode.duration` has passed and the arm has
  been still for 5 s, or at the end tag. It discards an episode with a gap over
  500 ms or fewer than `-episode.min-commands` goal changes.

The raw camera queue is the largest one on disk, and the station evicts its
oldest entries once `--max-queue-disk-size` is reached. At 640x480 JPEG and
30 fps, 40 GB holds roughly nine hours of video. Export soon after recording;
the export stops with an error if the frames are already gone.

## Usage

On the station host (or with `--station <address>` from another machine):

```bash
python export_fullres.py \
    --from-tag "green start" --to-tag "green stop" \
    --task "pick the green cube into the green cup" \
    --output green_cube.parquet
```

- If a tag name is used more than once, the latest start tag and the first end
  tag are used. `--from`/`--to` take inference-states pointers instead.
- `--camera N` selects the Nth camera, in normvla's image order (default 0).
- `--episode-duration` and `--min-commands` are passed to dataset-generator
  (defaults 300 s and 100).

Then convert to LeRobot:

```bash
python to_lerobot.py green_cube.parquet more.parquet \
    --repo-id <user>/green_cube --root ./green_cube --fps 30 --camera-name wrist
```

| LeRobot feature            | Source                                                     |
| -------------------------- | ---------------------------------------------------------- |
| `observation.state`        | follower `position_norm` per joint (0-1 of calibrated arc) |
| `action`                   | follower `goal_norm`, i.e. the mirrored leader pose (0-1)  |
| `observation.images.<name>`| the camera at full resolution, as video                    |
| `task`                     | the parquet's `task`                                       |

LeRobot assumes a fixed frame rate, but the recorder's rate jitters around its
interval. Frames are therefore resampled onto an exact `--fps` grid with
zero-order hold: each tick takes the latest frame at or before it.
`normacore_conversion.json` in the dataset lists, per episode, how many frames
were repeated or dropped.

## Tests

```bash
uv run --extra test python -m pytest tests
```

The tests cover tag replay (including removed tags), stamp matching for JPEG
frames, VP8 chain decoding (and refusing to decode across a missing entry), and
the resampling.

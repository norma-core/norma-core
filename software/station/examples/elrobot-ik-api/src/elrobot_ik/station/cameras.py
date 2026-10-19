"""Camera discovery and frame decoding from the station's usbvideo queues.

The station's `inference-states` queue lists every live queue; camera queues are
`<instance>/usbvideo/<md5 of the camera id>` and carry `usbvideo.RxEnvelope` entries whose
`frames` hold JPEG images when the station runs its default `codec: jpeg`.
"""
from __future__ import annotations

from dataclasses import dataclass

from elrobot_ik.station.proto import drivers_pb2, inference_pb2
from elrobot_ik.station.proto.usbvideo import frame_pb2, usbvideo_pb2

INFERENCE_STATES_QUEUE = "inference-states"


@dataclass(frozen=True)
class CameraQueue:
    id: str  # last path segment of the queue (md5 of the camera's unique id)
    queue: str  # full queue id to read from


@dataclass(frozen=True)
class CameraFrame:
    jpeg: bytes
    width: int
    height: int
    camera_name: str
    camera_unique_id: str
    stamp_ns: int


def parse_camera_queues(inference_states_entry: bytes) -> list[CameraQueue]:
    rx = inference_pb2.InferenceRx.FromString(inference_states_entry)
    return [
        CameraQueue(id=e.queue.rstrip("/").rsplit("/", 1)[-1], queue=e.queue)
        for e in rx.entries
        if e.type == drivers_pb2.QDT_USB_VIDEO_FRAMES
    ]


def parse_camera_frame(entry: bytes) -> CameraFrame | None:
    """The latest JPEG in a camera queue entry, or None for non-frame entries (device events).

    Raises ValueError when the station stores another codec (set `codec: jpeg` in station.yaml).
    """
    env = usbvideo_pb2.RxEnvelope.FromString(entry)
    if env.type != usbvideo_pb2.ET_FRAMES or not env.frames.frames_data:
        return None
    kind = env.frames.format.kind
    if kind != frame_pb2.FF_JPEG:
        raise ValueError(f"camera frames are {frame_pb2.FrameFormatKind.Name(kind)}, only FF_JPEG is supported")
    stamp = env.frames.stamps[-1].local_stamp_ns if env.frames.stamps else 0
    return CameraFrame(
        jpeg=bytes(env.frames.frames_data[-1]),
        width=env.frames.format.width,
        height=env.frames.format.height,
        camera_name=env.camera.product,
        camera_unique_id=env.camera.unique_id,
        stamp_ns=stamp,
    )

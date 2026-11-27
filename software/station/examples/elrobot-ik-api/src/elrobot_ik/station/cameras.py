"""Camera discovery and frame decoding from the station's usbvideo queues.

The station's `inference-states` queue lists every live queue; camera queues are
`<instance>/usbvideo/<md5 of the camera id>` and carry `usbvideo.RxEnvelope` entries. With the
station's `codec: vp8` (its station.yaml default) each entry holds one VP8 frame and names the
keyframe entry its chain starts at; a frame decodes from that keyframe forward. With `codec: jpeg`
each entry holds a finished JPEG.
"""
from __future__ import annotations

import io
from collections.abc import Iterable
from dataclasses import dataclass

import av

from elrobot_ik.station.proto import drivers_pb2, inference_pb2
from elrobot_ik.station.proto.usbvideo import frame_pb2, usbvideo_pb2

INFERENCE_STATES_QUEUE = "inference-states"

FF_JPEG = frame_pb2.FF_JPEG
FF_VP8 = frame_pb2.FF_VP8
KIND_NAMES = {FF_JPEG: "FF_JPEG", FF_VP8: "FF_VP8"}

# The station places a keyframe about once a second (at most every 5 s), so a chain this long
# means its keyframe policy is broken: refuse rather than decode minutes of video (mirrors the
# station's own MAX_CHAIN).
MAX_CHAIN = 1024

JPEG_QUALITY = 85


def entry_id(raw: bytes) -> int:
    """A NormFS entry id (8 bytes little-endian) as an int."""
    return int.from_bytes(raw, "little")


def entry_id_bytes(id_: int) -> bytes:
    return id_.to_bytes(8, "little")


@dataclass(frozen=True)
class CameraQueue:
    id: str  # last path segment of the queue (md5 of the camera's unique id)
    queue: str  # full queue id to read from


@dataclass(frozen=True)
class CameraEntry:
    """One ET_FRAMES entry of a camera queue: a JPEG, or one VP8 frame of a keyframe chain."""

    kind: int  # FF_JPEG or FF_VP8
    data: bytes  # the newest frame in the entry: JPEG bytes, or one VP8 packet
    width: int
    height: int
    camera_name: str
    camera_unique_id: str
    stamp_ns: int
    keyframe: bool  # VP8: this entry starts a chain
    keyframe_ptr: bytes  # VP8: the entry id of the chain's keyframe; empty on the keyframe itself

    def keyframe_id(self, own_id: bytes) -> int | None:
        """The entry id of the keyframe this VP8 frame decodes from, or None when it names none."""
        if self.keyframe:
            return entry_id(own_id)
        return entry_id(self.keyframe_ptr) if self.keyframe_ptr else None


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


def parse_camera_entry(entry: bytes) -> CameraEntry | None:
    """The frame in a camera queue entry, or None for non-frame entries (device events, sessions).

    Raises ValueError when the station stores a codec other than VP8 or JPEG.
    """
    env = usbvideo_pb2.RxEnvelope.FromString(entry)
    if env.type != usbvideo_pb2.ET_FRAMES or not env.frames.frames_data:
        return None
    kind = env.frames.format.kind
    if kind not in KIND_NAMES:
        name = frame_pb2.FrameFormatKind.Name(kind) if kind in frame_pb2.FrameFormatKind.values() else f"kind {kind}"
        raise ValueError(f"camera frames are {name}, only FF_VP8 and FF_JPEG are supported")
    return CameraEntry(
        kind=kind,
        data=bytes(env.frames.frames_data[-1]),
        width=env.frames.format.width,
        height=env.frames.format.height,
        camera_name=env.camera.product,
        camera_unique_id=env.camera.unique_id,
        stamp_ns=env.frames.stamps[-1].local_stamp_ns if env.frames.stamps else 0,
        keyframe=env.frames.keyframe,
        keyframe_ptr=bytes(env.frames.keyframe_ptr),
    )


def decode_vp8_chain(packets: Iterable[bytes]) -> tuple[bytes, int, int]:
    """Decode VP8 packets in order (the keyframe first) and return the last picture as (JPEG, width, height).

    Raises ValueError when the packets do not decode to a picture (a chain without its keyframe,
    corrupt data).
    """
    decoder = av.CodecContext.create("vp8", "r")
    picture = None
    try:
        for packet in packets:
            for frame in decoder.decode(av.Packet(packet)):
                picture = frame
    except av.FFmpegError as e:
        raise ValueError(f"VP8 chain does not decode: {e}") from e
    if picture is None:
        raise ValueError("VP8 chain produced no picture")
    buf = io.BytesIO()
    picture.to_image().save(buf, "JPEG", quality=JPEG_QUALITY)
    return buf.getvalue(), picture.width, picture.height

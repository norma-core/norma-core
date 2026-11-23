"""Reading recorded episodes back from a station at the camera's own resolution.

normvla frames carry 224x224 JPEGs, but each image keeps the capture stamp of
the camera frame it was made from. This module finds those frames in the raw
usbvideo queue (JPEG or VP8) and returns them as full-resolution JPEGs.
"""
from __future__ import annotations

import asyncio
import io
import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from target.gen_python.protobuf.drivers.inferences import normvla  # noqa: E402
from target.gen_python.protobuf.drivers.usbvideo import frame as frame_pb  # noqa: E402
from target.gen_python.protobuf.drivers.usbvideo import usbvideo  # noqa: E402
from target.gen_python.protobuf.station import drivers, inference  # noqa: E402

log = logging.getLogger(__name__)

NORMVLA_QUEUE = "inference/normvla"
TAGS_QUEUE = "inference-tags/rx"
INFERENCE_STATES_QUEUE = "inference-states"
READ_BATCH = 300


def le(n: int) -> bytes:
    return n.to_bytes(8, "little")


def from_le(b) -> int:
    return int.from_bytes(bytes(b), "little")


READ_TIMEOUT_S = 30


async def read_entries(client, queue: str, start: int, limit: int, tail: bool = False) -> list:
    """Up to `limit` entries from `start`. A read of entries the queue no longer
    holds can stall instead of ending, so each entry gets READ_TIMEOUT_S."""
    read = client.read_from_tail if tail else client.read_from_offset
    qr = read(queue, le(start), limit, 1, 256)
    out = []
    while True:
        try:
            e = await asyncio.wait_for(qr.data.get(), READ_TIMEOUT_S)
        except asyncio.TimeoutError:
            raise TimeoutError(f"read {queue}@{start}: no entry after {READ_TIMEOUT_S}s"
                               f" ({len(out)} read); evicted or not written yet?") from None
        if e is None:
            break
        out.append(e)
    if qr.err:
        raise RuntimeError(f"read {queue}@{start}: {qr.err}")
    return out


# --- tags -------------------------------------------------------------------

CT_ADD_TAG, CT_REMOVE_TAG = 0, 1


def _varint(b: bytes, i: int):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        s += 7
        if x < 0x80:
            return r, i


def parse_tag_entry(data) -> tuple[int, int | None, str | None]:
    """(type, inference_queue_ptr, tag) of an inference_tags.RxEnvelope.

    Decoded by hand: inference_tags.proto has no generated Python module yet.
    """
    b = bytes(data)
    i = 0
    kind, ptr, tag = CT_ADD_TAG, None, None
    while i < len(b):
        key, i = _varint(b, i)
        num, wire = key >> 3, key & 7
        if wire == 0:
            v, i = _varint(b, i)
            if num == 10:
                kind = v
        elif wire == 2:
            n, i = _varint(b, i)
            v = b[i:i + n]
            i += n
            if num == 11:
                ptr = from_le(v)
            elif num == 12:
                tag = v.decode("utf-8", "replace")
        elif wire == 1:
            i += 8
        elif wire == 5:
            i += 4
        else:
            raise ValueError(f"unexpected wire type {wire}")
    return kind, ptr, tag


def replay_tags(events) -> list[tuple[str, int]]:
    """Tags still present after replaying add/remove events, in the order added."""
    tags: list[tuple[str, int]] = []
    for kind, ptr, tag in events:
        if tag is None or ptr is None:
            continue
        if kind == CT_REMOVE_TAG:
            if (tag, ptr) in tags:
                tags.remove((tag, ptr))
        else:
            tags.append((tag, ptr))
    return tags


async def list_tags(client) -> list[tuple[str, int]]:
    events, start = [], 0
    while True:
        batch = await read_entries(client, TAGS_QUEUE, start, 10000)
        if not batch:
            break
        events.extend(parse_tag_entry(e.Data) for e in batch)
        start = from_le(batch[-1].ID.ID) + 1
        if len(batch) < 10000:  # reached the tail; reading past it waits for new entries
            break
    return replay_tags(events)


def resolve_tag(tags, name: str, which: str) -> int:
    hits = [p for n, p in tags if n == name]
    if not hits:
        raise LookupError(f"tag {name!r} not found; tags: {sorted({n for n, _ in tags})}")
    if len(hits) > 1:
        log.warning("tag %r appears %d times; using the %s one", name, len(hits), which)
    return hits[-1] if which == "last" else hits[0]


# --- queues -----------------------------------------------------------------

async def video_queues_at(client, inference_ptr: int) -> list[tuple[str, int]]:
    """(queue, entry id) of each camera in the inference-states entry at inference_ptr,
    in the order normvla lists their images."""
    entries = await read_entries(client, INFERENCE_STATES_QUEUE, inference_ptr, 1)
    if not entries:
        raise LookupError(f"no inference-states entry at {inference_ptr}")
    rx = inference.InferenceRxReader(entries[0].Data)
    return [(e.get_queue(), from_le(e.get_ptr())) for e in rx.get_entries()
            if e.get_type() == drivers.QueueDataType.QDT_USB_VIDEO_FRAMES]


async def normvla_image_stamps(client, first: int, last: int, camera: int) -> dict[bytes, int]:
    """global_frame_id -> capture stamp of image `camera`, for normvla entries first..last."""
    out, idx = {}, first
    while idx <= last:
        batch = await read_entries(client, NORMVLA_QUEUE, idx, min(READ_BATCH, last - idx + 1))
        if not batch:
            break
        for e in batch:
            f = normvla.FrameReader(e.Data)
            ims = f.get_images()
            if len(ims) > camera:
                out[bytes(f.get_global_frame_id())] = ims[camera].get_monotonic_stamp_ns()
        idx = from_le(batch[-1].ID.ID) + 1
    return out


# --- video ------------------------------------------------------------------

@dataclass
class FoundFrame:
    jpeg: bytes
    width: int
    height: int


def _jpeg_from_rgb(rgb, quality: int) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, "JPEG", quality=quality)
    return buf.getvalue()


@dataclass
class FrameCollector:
    """Feeds usbvideo entries in id order and keeps the frames whose capture stamp
    is wanted. JPEG frames are kept as stored. VP8 frames are decoded along their
    keyframe chain (as software/drivers/usbvideo/src/codec/chain.rs does) and
    re-encoded as JPEG; a gap or a frame of another chain drops the decoder until
    the next keyframe, so a frame is never decoded against the wrong reference."""

    wanted: set[int]
    jpeg_quality: int = 95
    found: dict[int, FoundFrame] = field(default_factory=dict)
    broken_vp8: int = 0
    _prev_id: int | None = None
    _chain: int | None = None
    _decoder: object = None

    def feed(self, entry_id: int, data) -> int | None:
        """Consume one entry; returns its last frame stamp, if it holds frames."""
        contiguous = self._prev_id is not None and entry_id == self._prev_id + 1
        self._prev_id = entry_id
        env = usbvideo.RxEnvelopeReader(data)
        if env.get_type() != usbvideo.RxEnvelopeType.ET_FRAMES:
            return None
        pack = env.get_frames()
        fmt = pack.get_format()
        kind = fmt.get_kind()
        stamps = [s.get_monotonic_stamp_ns() for s in pack.get_stamps()]
        datas = pack.get_frames_data()
        if not stamps:
            return None
        if kind == frame_pb.FrameFormatKind.FF_JPEG:
            for s, d in zip(stamps, datas):
                if s in self.wanted:
                    self.found[s] = FoundFrame(bytes(d), fmt.get_width(), fmt.get_height())
        elif kind == frame_pb.FrameFormatKind.FF_VP8:
            self._feed_vp8(entry_id, pack, stamps[-1], datas, contiguous)
        else:
            raise ValueError(f"unsupported frame format {kind!r}")
        return stamps[-1]

    def _feed_vp8(self, entry_id, pack, stamp, datas, contiguous):
        if pack.get_keyframe():
            self._decoder, self._chain = _vp8_decoder(), entry_id
        else:
            ptr = bytes(pack.get_keyframe_ptr())
            if not ptr or not contiguous or self._chain is None or from_le(ptr) != self._chain:
                if self._decoder is not None or stamp in self.wanted:
                    self.broken_vp8 += 1
                self._decoder = self._chain = None
                return
        if not datas:
            return
        import av

        frames = self._decoder.decode(av.Packet(bytes(datas[0])))
        if frames and stamp in self.wanted:
            rgb = frames[-1].to_ndarray(format="rgb24")
            self.found[stamp] = FoundFrame(_jpeg_from_rgb(rgb, self.jpeg_quality), rgb.shape[1], rgb.shape[0])


def _vp8_decoder():
    try:
        import av
    except ImportError as e:  # pragma: no cover - depends on the environment
        raise SystemExit("this camera stores VP8; install PyAV: pip install av") from e
    return av.CodecContext.create("vp8", "r")


async def collect_frames(client, queue: str, start: int, wanted: set[int], jpeg_quality: int = 95,
                         slack_ns: int = 1_000_000_000) -> FrameCollector:
    """Read `queue` from entry `start` (backing up to its VP8 keyframe) until every
    wanted stamp is found or the stream is slack_ns past the last one."""
    first = await read_entries(client, queue, start, 1)
    if not first:
        raise LookupError(f"{queue} no longer holds entry {start}: the raw video was evicted"
                          " (the queue keeps only the newest frames, up to the station's disk limit)")
    env = usbvideo.RxEnvelopeReader(first[0].Data)
    if env.get_type() == usbvideo.RxEnvelopeType.ET_FRAMES:
        pack = env.get_frames()
        if pack.get_format().get_kind() == frame_pb.FrameFormatKind.FF_VP8 and not pack.get_keyframe():
            ptr = bytes(pack.get_keyframe_ptr())
            if ptr:
                start = from_le(ptr)
    col = FrameCollector(wanted=wanted, jpeg_quality=jpeg_quality)
    stop_after = max(wanted) + slack_ns
    idx = start
    while True:
        batch = await read_entries(client, queue, idx, READ_BATCH)
        if not batch:
            break
        last = None
        for e in batch:
            s = col.feed(from_le(e.ID.ID), e.Data)
            last = s if s is not None else last
        idx = from_le(batch[-1].ID.ID) + 1
        if len(col.found) == len(wanted) or (last is not None and last > stop_after) or len(batch) < READ_BATCH:
            break
    return col


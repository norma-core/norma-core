import io
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import station_export as se  # noqa: E402
from target.gen_python.protobuf.drivers.usbvideo import frame as frame_pb  # noqa: E402
from target.gen_python.protobuf.drivers.usbvideo import usbvideo  # noqa: E402
from to_lerobot import resample  # noqa: E402


# --- tags -------------------------------------------------------------------

def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def tag_entry(tag, ptr, kind=se.CT_ADD_TAG):
    name = tag.encode()
    out = _varint(1 << 3) + _varint(123)  # monotonic_stamp_ns
    if kind:
        out += _varint(10 << 3) + _varint(kind)
    out += _varint(11 << 3 | 2) + _varint(8) + se.le(ptr)
    out += _varint(12 << 3 | 2) + _varint(len(name)) + name
    return out


def test_parse_tag_entry():
    assert se.parse_tag_entry(tag_entry("green start", 5627957)) == (se.CT_ADD_TAG, 5627957, "green start")
    assert se.parse_tag_entry(tag_entry("x", 7, se.CT_REMOVE_TAG)) == (se.CT_REMOVE_TAG, 7, "x")


def test_replay_drops_removed_tags():
    events = [se.parse_tag_entry(e) for e in (
        tag_entry("start", 10), tag_entry("start", 20), tag_entry("end", 30),
        tag_entry("start", 20, se.CT_REMOVE_TAG))]
    tags = se.replay_tags(events)
    assert tags == [("start", 10), ("end", 30)]
    assert se.resolve_tag(tags, "start", "last") == 10


def test_resolve_tag_picks_last_start_and_first_end():
    tags = [("s", 1), ("e", 5), ("s", 3), ("e", 9)]
    assert se.resolve_tag(tags, "s", "last") == 3
    assert se.resolve_tag(tags, "e", "first") == 5
    with pytest.raises(LookupError):
        se.resolve_tag(tags, "missing", "first")


# --- video ------------------------------------------------------------------

def envelope(kind, stamp, data, w=64, h=48, keyframe=False, keyframe_ptr=None):
    return usbvideo.RxEnvelope(
        type=usbvideo.RxEnvelopeType.ET_FRAMES,
        frames=frame_pb.FramesPack(
            format=frame_pb.FrameFormat(width=w, height=h, kind=kind),
            stamps=[frame_pb.FrameStamp(monotonic_stamp_ns=stamp)],
            frames_data=[data],
            keyframe=keyframe,
            keyframe_ptr=None if keyframe_ptr is None else se.le(keyframe_ptr),
        ),
    ).encode()


def test_jpeg_frames_kept_as_stored():
    col = se.FrameCollector(wanted={200})
    col.feed(0, envelope(frame_pb.FrameFormatKind.FF_JPEG, 100, b"a"))
    col.feed(1, envelope(frame_pb.FrameFormatKind.FF_JPEG, 200, b"b"))
    assert list(col.found) == [200]
    assert (col.found[200].jpeg, col.found[200].width, col.found[200].height) == (b"b", 64, 48)


def vp8_packets(n, w=64, h=48):
    av = pytest.importorskip("av")
    enc = av.CodecContext.create("libvpx", "w")
    enc.width, enc.height, enc.pix_fmt = w, h, "yuv420p"
    enc.gop_size = 4
    enc.options = {"auto-alt-ref": "0", "lag-in-frames": "0"}
    out = []
    for i in range(n):
        rgb = np.full((h, w, 3), (i * 20) % 256, np.uint8)
        f = av.VideoFrame.from_ndarray(rgb, format="rgb24").reformat(format="yuv420p")
        f.pts = i
        out += [(bytes(p), bool(p.is_keyframe)) for p in enc.encode(f)]
    out += [(bytes(p), bool(p.is_keyframe)) for p in enc.encode(None)]
    return out


def vp8_entries(packets, first_id=100):
    entries, key = [], None
    for i, (data, is_key) in enumerate(packets):
        eid = first_id + i
        key = eid if is_key else key
        entries.append((eid, envelope(frame_pb.FrameFormatKind.FF_VP8, 1000 + i, data,
                                      keyframe=is_key, keyframe_ptr=None if is_key else key)))
    return entries


def test_vp8_decodes_along_the_chain():
    from PIL import Image

    entries = vp8_entries(vp8_packets(8))
    col = se.FrameCollector(wanted={1002, 1006})
    for eid, data in entries:
        col.feed(eid, data)
    assert set(col.found) == {1002, 1006}
    img = np.asarray(Image.open(io.BytesIO(col.found[1006].jpeg)))
    assert img.shape == (48, 64, 3)
    assert abs(int(img.mean()) - 120) < 8
    assert col.broken_vp8 == 0


def test_vp8_gap_never_decodes_against_the_wrong_reference():
    entries = vp8_entries(vp8_packets(8))
    assert entries[4][0] == 104 and se.usbvideo.RxEnvelopeReader(entries[4][1]).get_frames().get_keyframe()
    col = se.FrameCollector(wanted={1002, 1003, 1005})
    for eid, data in entries[:2] + entries[3:]:  # entry 102 is missing
        col.feed(eid, data)
    assert set(col.found) == {1005}  # 103 sits after the hole; 105 follows keyframe 104
    assert col.broken_vp8 >= 1


# --- resampling -------------------------------------------------------------

def test_resample_zero_order_hold():
    ts = [0, 30_000_000, 70_000_000, 100_000_000]
    assert resample(ts, 30).tolist() == [0, 1, 1, 3]

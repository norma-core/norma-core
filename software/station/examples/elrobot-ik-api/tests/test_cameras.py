import pytest

from elrobot_ik.station.cameras import FF_JPEG, FF_VP8, decode_vp8_chain, parse_camera_entry, parse_camera_queues
from elrobot_ik.station.proto.usbvideo import frame_pb2
from tests.helpers import make_camera_frame, make_inference_states, vp8_packets

INSTANCE = "/155b778e7f8b0d414166c9669fd609d5c12e10d48a82916554077bb4e62817eb"


def test_parse_camera_queues_keeps_only_video_queues_and_uses_hash_as_id():
    data = make_inference_states({
        f"{INSTANCE}/st3215/inference": "st3215",
        f"{INSTANCE}/usbvideo/7bd21f18e39708492c1deee9e2a86aa7": "video",
        f"{INSTANCE}/usbvideo/0123456789abcdef0123456789abcdef": "video",
    })
    cams = parse_camera_queues(data)
    assert [c.id for c in cams] == ["7bd21f18e39708492c1deee9e2a86aa7", "0123456789abcdef0123456789abcdef"]
    assert cams[0].queue.endswith("/usbvideo/7bd21f18e39708492c1deee9e2a86aa7")


def test_parse_camera_entry_jpeg():
    entry = make_camera_frame(b"\xff\xd8jpegbytes", width=299, height=224, product="UVC Camera", unique_id="0x113")
    e = parse_camera_entry(entry)
    assert e is not None and e.kind == FF_JPEG
    assert e.data == b"\xff\xd8jpegbytes" and (e.width, e.height) == (299, 224)
    assert e.camera_name == "UVC Camera" and e.camera_unique_id == "0x113"
    assert e.keyframe_id(b"\x05" + b"\x00" * 7) is None  # a JPEG belongs to no chain


def test_parse_camera_entry_vp8_names_its_keyframe():
    key = parse_camera_entry(make_camera_frame(b"k", kind="vp8", keyframe=True))
    delta = parse_camera_entry(make_camera_frame(b"d", kind="vp8", keyframe_ptr=41))
    orphan = parse_camera_entry(make_camera_frame(b"o", kind="vp8"))
    assert key is not None and key.kind == FF_VP8 and key.keyframe
    own = (41).to_bytes(8, "little")
    assert key.keyframe_id(own) == 41  # a keyframe is its own chain start
    assert delta is not None and delta.keyframe_id((44).to_bytes(8, "little")) == 41
    assert orphan is not None and orphan.keyframe_id(own) is None


def test_parse_camera_entry_ignores_events_and_rejects_other_codecs():
    assert parse_camera_entry(make_camera_frame(None, event="connected")) is None
    with pytest.raises(ValueError, match="only FF_VP8 and FF_JPEG"):
        parse_camera_entry(make_camera_frame(b"raw", kind=frame_pb2.FF_NCHW))


def test_decode_vp8_chain_gives_the_last_picture_as_jpeg():
    jpeg, width, height = decode_vp8_chain(vp8_packets())
    assert jpeg[:2] == b"\xff\xd8" and (width, height) == (32, 32)
    first, _, _ = decode_vp8_chain(vp8_packets()[:1])
    assert first != jpeg  # the chain decoded further than its keyframe


def test_decode_vp8_chain_without_its_keyframe_fails():
    with pytest.raises(ValueError, match="VP8 chain"):
        decode_vp8_chain(vp8_packets()[1:])
    with pytest.raises(ValueError, match="no picture"):
        decode_vp8_chain([])

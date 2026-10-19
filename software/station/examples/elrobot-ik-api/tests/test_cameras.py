import pytest

from elrobot_ik.station.cameras import parse_camera_frame, parse_camera_queues
from tests.helpers import make_camera_frame, make_inference_states

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


def test_parse_camera_frame_jpeg():
    entry = make_camera_frame(b"\xff\xd8jpegbytes", width=299, height=224, product="UVC Camera", unique_id="0x113")
    f = parse_camera_frame(entry)
    assert f is not None
    assert f.jpeg == b"\xff\xd8jpegbytes" and (f.width, f.height) == (299, 224)
    assert f.camera_name == "UVC Camera" and f.camera_unique_id == "0x113"


def test_parse_camera_frame_ignores_events_and_other_codecs():
    assert parse_camera_frame(make_camera_frame(None, event="connected")) is None
    with pytest.raises(ValueError, match="FF_VP8"):
        parse_camera_frame(make_camera_frame(b"vp8", kind="vp8"))

from elrobot_ik import URDF_PATH
from elrobot_ik.station.proto import commands_pb2, normfs_pb2, st3215_pb2  # noqa: F401  (import check for the generated stubs)


def test_urdf_and_proto_stubs_are_packaged():
    assert URDF_PATH.exists()
    assert (URDF_PATH.parent / "assets" / "Gripper_Jaw_01_v1_1.stl").exists()

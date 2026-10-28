import math

import pytest
from fastapi.testclient import TestClient

from elrobot_ik.api.app import create_app
from tests.helpers import camera_queues, make_elrobot_bus, make_frame, make_service, mirroring_queues


def make_client(model, solver, frame, **kw):
    svc, station = make_service(model, solver, frame, queues=camera_queues(), **kw)
    return TestClient(create_app(service=svc, settings=svc.settings)), station


FRAME = make_frame(make_elrobot_bus("F1", voltage_v=12.0), make_elrobot_bus("L1", voltage_v=7.4))
MOVE = "/api/v1/arms/F1/move-to"


def down(x, y, z=0.05, yaw=0.0, **kw):
    """move-to body: gripper vertical over (x, y, z), jaws turned by yaw radians."""
    return {"position": {"x": x, "y": y, "z": z}, "orientation": {"rpy": {"roll": -math.pi / 2, "pitch": 0, "yaw": yaw}}, **kw}


def test_health_and_arms(model, solver):
    c, _ = make_client(model, solver, FRAME)
    assert c.get("/api/v1/health").json()["station_connected"] is True
    arms = c.get("/api/v1/arms").json()
    assert [(a["id"], a["role"]) for a in arms] == [("F1", "follower"), ("L1", "leader")]
    arm = arms[0]
    assert set(arm) == {"id", "role", "calibrated", "torque_enabled", "pose", "gripper", "joints"}
    assert arm["calibrated"] is True and arm["torque_enabled"] is True
    assert set(arm["pose"]) == {"position", "rpy", "rotation_deg"}
    assert arm["pose"]["position"]["x"] == pytest.approx(0.3180, abs=0.003)
    assert set(arm["joints"][0]) == {"motor", "angle_rad", "steps"} and len(arm["joints"]) == 8


def test_uncalibrated_arm_is_listed_with_nulls(model, solver):
    c, _ = make_client(model, solver, make_frame(make_elrobot_bus("F1"), make_elrobot_bus("U1", calibrated=False)))
    arm = c.get("/api/v1/arms").json()[1]
    assert arm["id"] == "U1" and arm["calibrated"] is False
    assert arm["pose"] is None and arm["gripper"] is None and arm["joints"][0]["angle_rad"] is None


def test_unknown_arm_is_404_with_candidates(model, solver):
    c, _ = make_client(model, solver, FRAME)
    r = c.post("/api/v1/arms/NOPE/move-to", json=down(0.21, 0.0))
    assert r.status_code == 404
    assert r.json()["error"] == "not_found" and r.json()["context"]["candidates"] == ["F1", "L1"]


def test_invalid_request_body_uses_the_error_envelope(model, solver):
    c, _ = make_client(model, solver, FRAME)
    r = c.post(MOVE, json={"position": {"x": "far", "y": 0.0, "z": 0.05}})
    assert r.status_code == 422
    body = r.json()
    assert set(body) == {"error", "detail", "context"} and body["error"] == "invalid_request"
    assert "x" in body["detail"] and body["context"]["errors"][0]["loc"] == ["body", "position", "x"]


def test_no_station_is_503(model, solver):
    c, _ = make_client(model, solver, None, connected=False)
    r = c.get("/api/v1/arms")
    assert r.status_code == 503 and r.json()["error"] == "station_disconnected"


def test_move_to_dry_run_response_is_slim(model, solver):
    c, station = make_client(model, solver, FRAME)
    r = c.post(MOVE, json=down(0.21, 0.05))
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"reachable", "executed", "pose", "joint_angles_rad", "motor_steps", "motion"}
    assert body["reachable"] is True and body["executed"] is False
    assert len(body["motor_steps"]) == 8 and all(1024 <= s <= 3072 for s in body["motor_steps"])
    assert set(body["pose"]) == {"position", "rpy", "rotation_deg"}
    assert body["pose"]["position"]["x"] == pytest.approx(0.21, abs=0.003)
    assert body["motion"] == {"status": "not_executed", "duration_ms": 0}
    assert len(body["joint_angles_rad"]) == 8
    assert station.sent == []


def test_move_to_yaw_turns_the_jaws(model, solver):
    c, _ = make_client(model, solver, FRAME)
    body = c.post(MOVE, json=down(0.21, 0.0, yaw=math.pi / 2)).json()
    assert body["pose"]["position"]["z"] == pytest.approx(0.05, abs=0.003)
    assert body["pose"]["rotation_deg"] == pytest.approx(90, abs=3)


def test_move_to_unreachable_is_422(model, solver):
    c, _ = make_client(model, solver, FRAME)
    r = c.post(MOVE, json=down(1.0, 0.0))
    assert r.status_code == 422 and r.json()["error"] == "unreachable"


def test_move_to_not_calibrated_execute_is_409(model, solver):
    c, station = make_client(model, solver, make_frame(make_elrobot_bus("F1", calibrated=False)))
    r = c.post(MOVE, json=down(0.21, 0.0, execute=True))
    assert r.status_code == 409 and r.json()["error"] == "not_calibrated"
    assert station.sent == []


def test_move_to_execute_stops_mirroring_then_drives(model, solver):
    c, station = make_client(model, solver, FRAME)
    station.queues.update(mirroring_queues("F1"))
    r = c.post(MOVE, json=down(0.21, 0.0, execute=True, speed=300))
    assert r.status_code == 200, r.text
    assert r.json()["executed"] is True and r.json()["motion"]["status"] == "stalled"  # fake arm never moves
    assert station.driver_types[0] == 1
    assert [c.sync_write.address for c in station.st3215_commands] == [0x28, 0x28, 0x2E, 0x29, 0x2A, 0x2A, 0x2A]


def test_move_to_execute_on_unmirrored_arm_sends_no_stop(model, solver):
    c, station = make_client(model, solver, FRAME)
    r = c.post(MOVE, json=down(0.21, 0.0, execute=True, speed=300))
    assert r.status_code == 200, r.text
    assert 1 not in station.driver_types
    assert [c.sync_write.address for c in station.st3215_commands][:4] == [0x28, 0x2E, 0x29, 0x2A]


def test_move_to_with_rpy_and_with_quaternion(model, solver):
    c, _ = make_client(model, solver, FRAME)
    body = down(0.18, 0.0, 0.06)
    r = c.post(MOVE, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["reachable"] is True
    s, w = math.sin(-math.pi / 4), math.cos(-math.pi / 4)
    body["orientation"] = {"quaternion": {"x": s, "y": 0, "z": 0, "w": w}}
    assert c.post(MOVE, json=body).status_code == 200
    body["orientation"] = {}
    assert c.post(MOVE, json=body).status_code == 422


def test_gripper_and_torque(model, solver):
    c, _ = make_client(model, solver, FRAME)
    r = c.post("/api/v1/arms/F1/gripper", json={"open": 1.0})
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"id", "gripper", "motion"} and r.json()["gripper"] == 1.0
    assert c.post("/api/v1/arms/F1/gripper", json={"open": 2.0}).status_code == 422
    r = c.post("/api/v1/arms/F1/torque", json={"enabled": False})
    assert r.status_code == 200 and r.json() == {"id": "F1", "torque_enabled": False}


def test_cameras_list_and_image(model, solver):
    c, _ = make_client(model, solver, FRAME)
    cams = c.get("/api/v1/cameras").json()
    assert cams == [{"id": "7bd21f18e39708492c1deee9e2a86aa7", "name": "UVC Camera", "unique_id": "0x113", "width": 299, "height": 224}]
    r = c.get(f"/api/v1/cameras/{cams[0]['id']}/image")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert r.content == b"\xff\xd8\xffjpeg"
    assert r.headers["x-camera-width"] == "299" and r.headers["x-camera-height"] == "224"
    r = c.get("/api/v1/cameras/nope/image")
    assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_urdf_and_meshes_are_served_and_there_are_no_pages(model, solver):
    c, _ = make_client(model, solver, FRAME)
    assert c.get("/").status_code == 404 and c.get("/debug").status_code == 404
    r = c.get("/api/v1/urdf?variant=model")
    assert r.status_code == 200 and 'name="tcp"' in r.text
    assert c.get("/urdf").text == c.get("/api/v1/urdf").text and 'name="tcp"' not in c.get("/urdf").text
    # Mesh paths are absolute on this server, so the XML resolves them from any URL (/urdf, /api/v1/urdf, a file).
    for text in (r.text, c.get("/urdf").text):
        assert 'filename="/urdf/assets/base_link.stl"' in text and 'filename="assets/' not in text
    assert c.get("/urdf/assets/base_link.stl").status_code == 200


def test_all_api_routes_are_async_and_documented(model, solver):
    import inspect

    from elrobot_ik.api.routes import router

    api_routes = [r for r in router.routes if getattr(r, "path", "").startswith("/api/v1")]
    assert len(api_routes) == 8
    assert [r.path for r in api_routes if not inspect.iscoroutinefunction(r.endpoint)] == []
    c, _ = make_client(model, solver, FRAME)
    spec = c.get("/openapi.json").json()
    assert "World frame" in spec["info"]["description"]
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            assert op.get("summary") and op.get("description") and op.get("tags"), f"{method} {path}"
    assert "/api/v1/cameras/{camera_id}/image" in spec["paths"]
    assert c.get("/docs").status_code == 200 and c.get("/redoc").status_code == 200

import json

import pytest
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError

from elrobot_ik.api.app import create_app
from elrobot_ik.api.mcp_server import build_mcp
from tests import helpers
from tests.helpers import camera_queues, make_elrobot_bus, make_frame

FRAME = make_frame(make_elrobot_bus("F1"))
TOOL_NAMES = {"health", "list_arms", "move_to", "set_gripper", "set_torque", "list_cameras", "get_camera_image"}
DOWN = {"rpy": {"roll": -1.5708, "pitch": 0, "yaw": 0}}


def make_service(model, solver, frame=FRAME):
    svc, station = helpers.make_service(model, solver, frame, queues=camera_queues())
    return svc, station, svc.settings


def payload(res):
    return res.structured_content or json.loads(res.content[0].text)


async def test_tools_are_listed_with_descriptions(model, solver):
    svc, _, _ = make_service(model, solver)
    mcp = build_mcp(lambda: svc)
    tools = {t.name: t for t in await mcp.list_tools()}
    assert set(tools) == TOOL_NAMES
    for name in TOOL_NAMES:
        assert tools[name].description, name
    assert "arm_id" in tools["move_to"].input_schema["required"]  # no default arm
    assert "tool point" in mcp.instructions


async def test_arm_tools(model, solver):
    svc, station, _ = make_service(model, solver)
    mcp = build_mcp(lambda: svc)
    arms = payload(await mcp.call_tool("list_arms", {}))["arms"]
    assert len(arms) == 1 and arms[0]["id"] == "F1" and arms[0]["role"] == "follower"
    assert arms[0]["pose"]["position"]["x"] == pytest.approx(0.3180, abs=0.003) and "gripper" in arms[0]
    out = payload(await mcp.call_tool("move_to", {"arm_id": "F1", "position": {"x": 0.21, "y": 0.0, "z": 0.05}, "orientation": DOWN}))
    assert out["reachable"] is True and out["executed"] is False and set(out) == {"reachable", "executed", "pose", "joint_angles_rad", "motor_steps", "motion"}
    assert station.sent == []


async def test_camera_tools(model, solver):
    svc, _, _ = make_service(model, solver)
    mcp = build_mcp(lambda: svc)
    cams = payload(await mcp.call_tool("list_cameras", {}))["cameras"]
    assert cams[0]["id"] == "7bd21f18e39708492c1deee9e2a86aa7"
    res = await mcp.call_tool("get_camera_image", {"camera_id": cams[0]["id"]})
    assert not res.is_error
    image = next(c for c in res.content if c.type == "image")
    assert image.mime_type == "image/jpeg" and image.data


async def test_tool_errors_carry_the_api_error_code(model, solver):
    svc, _, _ = make_service(model, solver)
    mcp = build_mcp(lambda: svc)
    with pytest.raises(ToolError) as e:
        await mcp.call_tool("set_gripper", {"arm_id": "NOPE", "open": 1.0})
    assert "not_found" in str(e.value) and "404" in str(e.value)


async def test_guide_resource(model, solver):
    svc, _, _ = make_service(model, solver)
    mcp = build_mcp(lambda: svc)
    body = next(iter(await mcp.read_resource("elrobot://guide"))).content
    assert "Coordinate frame" in body


def test_mcp_endpoint_over_http(model, solver):
    svc, _, settings = make_service(model, solver)
    app = create_app(service=svc, settings=settings)
    headers = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
    with TestClient(app) as c:
        r = c.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, headers=headers, follow_redirects=False)
        assert r.status_code == 200, r.text  # answered directly: no 307 to /mcp/ for clients that do not follow redirects
        assert {t["name"] for t in r.json()["result"]["tools"]} == TOOL_NAMES
        call = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "list_arms", "arguments": {}}}
        r = c.post("/mcp", json=call, headers=headers)
        result = r.json()["result"]
        assert "pose" in (result.get("structuredContent") or json.loads(result["content"][0]["text"]))["arms"][0]

"""FastAPI application factory and CLI entry point."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from mcp.server.transport_security import TransportSecuritySettings

from elrobot_ik import URDF_PATH, VERSION
from elrobot_ik.api.mcp_server import build_mcp
from elrobot_ik.api.routes import router, urdf
from elrobot_ik.api.schemas import ErrorBody
from elrobot_ik.config import Settings
from elrobot_ik.kinematics.model import ElrobotModel
from elrobot_ik.service import ArmService, ServiceError
from elrobot_ik.station.client import StationClient

log = logging.getLogger(__name__)

MCP_PATH = "/mcp"

API_DESCRIPTION = """Inverse kinematics for the ElRobot arm, executed through a NormaCore station.

**World frame**: origin on the base motor's rotation axis at table level,
X forward, Y left, Z up. The **tool point** is the center of the closed jaws' tip edge; `z` is its
height above the table. Angles about the vertical are positive counter-clockwise seen from above.

**Arms**: `GET /api/v1/arms` returns every arm with its `id` (the bus serial, used as `{arm_id}`), role
(`follower`: the one you drive; `leader`: the teleoperation handle), torque, joints and current tool point
pose. There is no default arm.

**Cameras**: `GET /api/v1/cameras` lists them; `GET /api/v1/cameras/{camera_id}/image` returns the newest frame as
JPEG, decoded from the station's VP8 keyframe chain (its default `codec: vp8`) or taken as stored with `codec: jpeg`.

**Motion**: one arm executes one command at a time; a new command for the same arm stops the one in
flight (that call returns `motion.status: unknown`) and runs instead.

**Errors** are `{"error", "detail", "context"}`: 404 unknown arm or camera; 409 `not_calibrated`, `motor_error`;
422 `unreachable`, `collision`, `invalid_gripper`; 415 `unsupported_codec`; 500 `limit_violation`;
503 `station_disconnected`, `no_frame`, `stale_frame`.

MCP endpoint: `/mcp`. Operating guide for agents: `AGENTS.md` (also the MCP resource `elrobot://guide`).
"""


def create_app(service: ArmService | None = None, settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    mcp = build_mcp(lambda: app.state.service)
    mcp_app = mcp.streamable_http_app(
        streamable_http_path=MCP_PATH, json_response=True, stateless_http=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),  # local tool endpoint
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with mcp.session_manager.run():
            if service is not None:  # injected (tests)
                yield
                return
            client = StationClient(settings.station_url)
            await client.start()  # connect while the model loads
            model = await asyncio.to_thread(ElrobotModel)
            app.state.service = ArmService.build(client, settings, model)
            log.info("elrobot-ik ready; station %s, MCP at /mcp", settings.station_url)
            try:
                yield
            finally:
                await client.stop()
                model.close()

    app = FastAPI(
        title="ElRobot IK API",
        version=VERSION,
        description=API_DESCRIPTION,
        openapi_tags=[
            {"name": "service", "description": "Health of this service and its station link."},
            {"name": "arms", "description": "Discover arms and read their state: id, role, torque, joints and the current tool pose."},
            {"name": "motion", "description": "Solve and execute moves, gripper, torque. Execute slowly."},
            {"name": "cameras", "description": "List the station's cameras and fetch their newest frame as JPEG (decoded from VP8 when the station stores VP8)."},
        ],
        lifespan=lifespan,
    )
    app.include_router(router)

    app.add_api_route("/urdf", urdf, include_in_schema=False)  # short alias of /api/v1/urdf

    # A plain route, not a mount: a mount at /mcp would answer the bare path with a 307 to /mcp/,
    # which not every MCP client follows. The MCP app routes the full path itself.
    app.add_route(MCP_PATH, mcp_app, include_in_schema=False)
    app.mount("/urdf", StaticFiles(directory=str(URDF_PATH.parent)), name="urdf")  # meshes referenced by the URDF

    if service is not None:
        app.state.service = service

    @app.exception_handler(ServiceError)
    async def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
        body = ErrorBody(error=exc.code, detail=exc.detail, context=exc.extra)
        return JSONResponse(status_code=exc.status, content=body.model_dump())

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        """Request-shape errors in the same {error, detail, context} body as service errors."""
        errors = [{"loc": list(e.get("loc", ())), "msg": e.get("msg", "")} for e in exc.errors()]
        detail = "; ".join(f"{'.'.join(str(x) for x in e['loc'][1:]) or 'body'}: {e['msg']}" for e in errors) or "invalid request"
        return JSONResponse(status_code=422, content=ErrorBody(error="invalid_request", detail=detail, context={"errors": errors}).model_dump())

    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = Settings.from_env()
    uvicorn.run(create_app(settings=settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()

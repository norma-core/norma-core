from __future__ import annotations

import importlib
from typing import Any

from yahboom_dogzilla_lite_monitor import station_state

yahboom_dogzilla_lite_pb: Any = importlib.import_module(
    "target.gen_python.protobuf.drivers.yahboom_dogzilla_lite.yahboom_dogzilla_lite",
)
MODEL = yahboom_dogzilla_lite_pb.YahboomDogzillaLiteModel.YAHBOOM_DOGZILLA_LITE


def test_parse_battery_status_prefers_connected_device() -> None:
    payload = yahboom_dogzilla_lite_pb.InferenceState(
        devices=[
            device_state(35, connected=False),
            device_state(83, connected=True),
        ],
    ).encode()

    assert station_state.parse_battery_status(payload) == station_state.BatteryStatus(True, 83)


def test_parse_battery_status_uses_disconnected_device_as_fallback() -> None:
    payload = yahboom_dogzilla_lite_pb.InferenceState(
        devices=[
            device_state(42, connected=False),
        ],
    ).encode()

    assert station_state.parse_battery_status(payload) == station_state.BatteryStatus(True, 42)


def test_parse_battery_status_clamps_level() -> None:
    payload = yahboom_dogzilla_lite_pb.InferenceState(
        devices=[
            device_state(125, connected=True),
        ],
    ).encode()

    assert station_state.parse_battery_status(payload) == station_state.BatteryStatus(True, 100)


def test_parse_battery_status_preserves_missing_status_as_unavailable() -> None:
    payload = yahboom_dogzilla_lite_pb.InferenceState(
        devices=[
            yahboom_dogzilla_lite_pb.InferenceState_DeviceState(is_connected=True),
        ],
    ).encode()

    assert station_state.parse_state(payload) == station_state.State(
        devices=[
            station_state.DeviceStatus(connected=True),
        ],
    )
    assert station_state.parse_battery_status(payload) == station_state.BatteryStatus()


def test_parse_state_empty_payload() -> None:
    assert station_state.parse_state(b"") == station_state.State()


def device_state(
    battery_level: int,
    *,
    connected: bool,
) -> object:
    return yahboom_dogzilla_lite_pb.InferenceState_DeviceState(
        status=yahboom_dogzilla_lite_pb.YahboomDogzillaLiteStatus(
            battery_level=battery_level,
            model=MODEL,
        ),
        is_connected=connected,
    )

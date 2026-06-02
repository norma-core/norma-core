from __future__ import annotations

import importlib
import struct
from pathlib import Path
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


def test_parse_state_extracts_wlan_ipv4_addresses() -> None:
    payload = yahboom_dogzilla_lite_pb.InferenceState(
        networks=[
            network_state("eth0", ["10.42.0.10"]),
            network_state("wlan0", ["192.168.12.34/24", "bad", "127.0.0.1"]),
            network_state("wlan1", ["10.0.0.1", "192.168.12.34"]),
        ],
    ).encode()

    state = station_state.parse_state(payload)

    assert state.wlan_ip_addresses() == ["192.168.12.34", "10.0.0.1"]
    assert state.has_wlan_ip()


def test_parse_state_requires_wlan_interface_for_connectivity() -> None:
    payload = yahboom_dogzilla_lite_pb.InferenceState(
        networks=[
            network_state("eth0", ["10.42.0.10"]),
            network_state("tailscale0", ["100.64.0.5"]),
        ],
    ).encode()

    state = station_state.parse_state(payload)

    assert state.wlan_ip_addresses() == []
    assert not state.has_wlan_ip()


def test_parse_state_empty_payload() -> None:
    assert station_state.parse_state(b"") == station_state.State()


def test_read_latest_frame_returns_validated_metadata_and_payload(tmp_path: Path) -> None:
    path = tmp_path / "station-state"
    buffer_size = 64
    data = bytearray(buffer_size * station_state.BUFFER_COUNT)
    write_frame(data, buffer_size, 1, sequence=10, timestamp_ns=1000, payload=b"old")
    write_frame(data, buffer_size, 2, sequence=20, timestamp_ns=2000, payload=b"new")
    path.write_bytes(data)

    source = station_state.Source(str(path))
    try:
        frame = source.read_latest_frame()
    finally:
        source.close()

    assert frame == station_state.SharedStateFrame(20, 2000, b"new")


def test_read_latest_frame_accepts_empty_payload(tmp_path: Path) -> None:
    path = tmp_path / "station-state"
    buffer_size = 64
    data = bytearray(buffer_size * station_state.BUFFER_COUNT)
    write_frame(data, buffer_size, 0, sequence=10, timestamp_ns=1000, payload=b"")
    path.write_bytes(data)

    source = station_state.Source(str(path))
    try:
        frame = source.read_latest_frame()
    finally:
        source.close()

    assert frame == station_state.SharedStateFrame(10, 1000, b"")


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


def network_state(iface: str, ip_addresses: list[str]) -> object:
    return yahboom_dogzilla_lite_pb.InferenceState_NetworkState(
        iface=iface,
        ips=[
            yahboom_dogzilla_lite_pb.InferenceState_NetworkIp(addr=addr)
            for addr in ip_addresses
        ],
    )


def write_frame(
    data: bytearray,
    buffer_size: int,
    index: int,
    *,
    sequence: int,
    timestamp_ns: int,
    payload: bytes,
) -> None:
    start = index * buffer_size
    struct.pack_into("<QQI", data, start, sequence, timestamp_ns, len(payload))
    data[start + station_state.HEADER_SIZE : start + station_state.HEADER_SIZE + len(payload)] = (
        payload
    )

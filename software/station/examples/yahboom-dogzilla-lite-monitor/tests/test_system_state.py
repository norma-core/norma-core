from __future__ import annotations

import importlib
from typing import Any

from yahboom_dogzilla_lite_monitor import system_state

sysinfo_pb: Any = importlib.import_module(
    "target.gen_python.protobuf.drivers.sysinfo.sysinfo",
)


def test_parse_state_extracts_wlan_ipv4_addresses() -> None:
    payload = sysinfo_pb.Envelope(
        data=sysinfo_pb.EnvelopeData(
            networks=[
                network_state("eth0", ["10.42.0.10"]),
                network_state("wlan0", ["192.168.12.34/24", "bad", "127.0.0.1"]),
                network_state("wlan1", ["10.0.0.1", "192.168.12.34"]),
            ],
        ),
    ).encode()

    state = system_state.parse_state(payload)

    assert state.wlan_ip_addresses() == ["192.168.12.34", "10.0.0.1"]
    assert state.has_wlan_ip()


def test_parse_state_requires_wlan_interface_for_connectivity() -> None:
    payload = sysinfo_pb.Envelope(
        data=sysinfo_pb.EnvelopeData(
            networks=[
                network_state("eth0", ["10.42.0.10"]),
                network_state("tailscale0", ["100.64.0.5"]),
            ],
        ),
    ).encode()

    state = system_state.parse_state(payload)

    assert state.wlan_ip_addresses() == []
    assert not state.has_wlan_ip()


def test_parse_state_extracts_tailscale_ipv4_addresses() -> None:
    payload = sysinfo_pb.Envelope(
        data=sysinfo_pb.EnvelopeData(
            networks=[
                network_state("eth0", ["10.42.0.10"]),
                network_state("wlan0", ["192.168.12.34/24"]),
                network_state("tailscale0", ["100.64.0.5/32", "bad", "127.0.0.1"]),
            ],
        ),
    ).encode()

    state = system_state.parse_state(payload)

    assert state.tailscale_ip_addresses() == ["100.64.0.5"]
    # The wlan accessor is unaffected by the tailscale interface.
    assert state.wlan_ip_addresses() == ["192.168.12.34"]


def test_tailscale_ip_addresses_empty_without_tailscale_interface() -> None:
    payload = sysinfo_pb.Envelope(
        data=sysinfo_pb.EnvelopeData(
            networks=[network_state("wlan0", ["192.168.12.34"])],
        ),
    ).encode()

    state = system_state.parse_state(payload)

    assert state.tailscale_ip_addresses() == []


def test_parse_state_empty_payload() -> None:
    assert system_state.parse_state(b"") == system_state.State()


def test_normalize_station_tcp_defaults_port() -> None:
    assert system_state.normalize_station_tcp("127.0.0.1") == "127.0.0.1:8888"
    assert system_state.normalize_station_tcp("127.0.0.1:9000") == "127.0.0.1:9000"
    assert system_state.normalize_station_tcp("") == system_state.DEFAULT_STATION_TCP


def network_state(iface: str, ip_addresses: list[str]) -> object:
    return sysinfo_pb.Network(
        iface=iface,
        ips=[sysinfo_pb.NetworkIp(addr=addr) for addr in ip_addresses],
    )

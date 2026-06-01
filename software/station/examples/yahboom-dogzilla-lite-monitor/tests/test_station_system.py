from __future__ import annotations

from yahboom_dogzilla_lite_monitor import station_system


def test_parse_ip_addr_show_networks_preserves_interfaces() -> None:
    output = "\n".join(
        [
            "2: eth0    inet 10.42.0.10/24 brd 10.42.0.255 scope global eth0",
            "3: wlan0    inet 192.168.12.34/24 brd 192.168.12.255 scope global wlan0",
            "4: tailscale0    inet 100.64.0.5/32 scope global tailscale0",
        ],
    )

    assert station_system._parse_ip_addr_show_networks(output) == [
        ("eth0", ["10.42.0.10/24"]),
        ("wlan0", ["192.168.12.34/24"]),
        ("tailscale0", ["100.64.0.5/32"]),
    ]


def test_snapshot_prefers_requested_interface() -> None:
    snapshot = station_system.Snapshot(
        [
            ("eth0", ["10.42.0.10/24"]),
            ("wlan0", ["192.168.12.34/24"]),
            ("tailscale0", ["100.64.0.5/32"]),
        ],
    )

    assert snapshot.ip_addresses("wlan0") == [
        "192.168.12.34",
        "10.42.0.10",
        "100.64.0.5",
    ]

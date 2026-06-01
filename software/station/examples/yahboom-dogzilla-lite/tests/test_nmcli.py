from __future__ import annotations

from yahboom_dogzilla_lite import nmcli
from yahboom_dogzilla_lite.network import InternetState


def test_parse_active_wifi_requires_exact_connected_state() -> None:
    output = "\n".join(
        [
            "wlan0:wifi:disconnected:old-network",
            "wlan1:wifi:connected:active-network",
        ],
    )

    assert nmcli.parse_active_wifi(output) == "wlan1"


def test_parse_active_wifi_ignores_disconnected_only() -> None:
    assert nmcli.parse_active_wifi("wlan0:wifi:disconnected:old-network") == ""


def test_parse_general_status_reads_state_and_connectivity() -> None:
    assert nmcli.parse_general_status("connected:full\n") == ("connected", "full")


def test_map_connectivity() -> None:
    assert nmcli.map_connectivity("connected", "full") == InternetState.ONLINE
    assert nmcli.map_connectivity("connected", "limited") == InternetState.LIMITED
    assert nmcli.map_connectivity("connected", "portal") == InternetState.PORTAL
    assert nmcli.map_connectivity("disconnected", "none") == InternetState.OFFLINE
    assert nmcli.map_connectivity("connecting", "") == InternetState.UNKNOWN

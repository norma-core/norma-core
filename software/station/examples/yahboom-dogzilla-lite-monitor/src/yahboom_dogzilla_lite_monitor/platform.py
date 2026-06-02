from __future__ import annotations

from yahboom_dogzilla_lite_monitor import nmcli
from yahboom_dogzilla_lite_monitor.network import Provider


def new_provider() -> Provider:
    if nmcli.available():
        return nmcli.Provider()
    raise RuntimeError("nmcli is required for network status")

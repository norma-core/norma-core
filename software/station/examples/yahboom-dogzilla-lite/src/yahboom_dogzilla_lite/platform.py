from __future__ import annotations

from yahboom_dogzilla_lite import nmcli
from yahboom_dogzilla_lite.network import MockProvider, Provider


def new_provider(mode: str) -> tuple[Provider, str]:
    normalized = mode.strip().lower() or "auto"
    if normalized == "mock":
        return MockProvider(), "mock"
    if normalized == "nmcli":
        return nmcli.Provider(), "nmcli"
    if normalized == "auto":
        if nmcli.available():
            return nmcli.Provider(), "nmcli"
        return MockProvider(), "mock"
    raise ValueError(f"unsupported backend mode {mode!r}")

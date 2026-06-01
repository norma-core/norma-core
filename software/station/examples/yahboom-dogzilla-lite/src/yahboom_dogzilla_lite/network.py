from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class InternetState(StrEnum):
    UNKNOWN = "unknown"
    OFFLINE = "offline"
    LIMITED = "limited"
    PORTAL = "portal"
    ONLINE = "online"


@dataclass(frozen=True)
class InternetStatus:
    state: InternetState
    active_interface: str = ""


class Provider(Protocol):
    def status(self) -> InternetStatus: ...


class Service:
    def __init__(self, provider: Provider) -> None:
        self._provider = provider

    def status(self) -> InternetStatus:
        return self._provider.status()


class MockProvider:
    def status(self) -> InternetStatus:
        return InternetStatus(InternetState.ONLINE, "wlan0")

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any

from yahboom_dogzilla_lite_monitor import station_tcp

DEFAULT_STATION_TCP = station_tcp.DEFAULT_STATION_TCP
DEFAULT_QUEUE_ID = "system/rx"


class NoSystemStateDataError(station_tcp.NoQueueDataError):
    pass


@dataclass(frozen=True)
class NetworkStatus:
    iface: str = ""
    ip_addresses: list[str] = dataclass_field(default_factory=list)


@dataclass(frozen=True)
class State:
    networks: list[NetworkStatus] = dataclass_field(default_factory=list)

    def wlan_ip_addresses(self) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for network in self.networks:
            if not network.iface.startswith("wlan"):
                continue
            for raw_addr in network.ip_addresses:
                addr = normalize_ipv4_address(raw_addr)
                if addr and addr not in seen:
                    seen.add(addr)
                    out.append(addr)
        return out

    def has_wlan_ip(self) -> bool:
        return bool(self.wlan_ip_addresses())


class Source(station_tcp.Source):
    def __init__(
        self,
        station_tcp: str = DEFAULT_STATION_TCP,
        queue_id: str = DEFAULT_QUEUE_ID,
        *,
        logger: logging.Logger | None = None,
    ) -> None:
        super().__init__(
            station_tcp,
            queue_id.strip() or DEFAULT_QUEUE_ID,
            label="system telemetry",
            logger=logger,
            error_cls=NoSystemStateDataError,
        )

    def read(self) -> State:
        return parse_state(self.read_frame().payload)


def parse_state(payload: bytes) -> State:
    pb = _protobuf_module()
    reader = pb.EnvelopeReader(memoryview(payload))
    data = reader.get_data()
    return State(
        networks=[parse_network_status_reader(network) for network in data.get_networks()],
    )


def parse_network_status_reader(reader: Any) -> NetworkStatus:
    return NetworkStatus(
        iface=reader.get_iface(),
        ip_addresses=[ip.get_addr() for ip in reader.get_ips()],
    )


def normalize_ipv4_address(raw: str) -> str:
    value = raw.strip()
    if "/" in value:
        value = value.split("/", 1)[0]
    parts = value.split(".")
    if len(parts) != 4:
        return ""
    try:
        octets = [int(part) for part in parts]
    except ValueError:
        return ""
    if any(part < 0 or part > 255 for part in octets):
        return ""
    if octets[0] == 127:
        return ""
    return ".".join(str(part) for part in octets)


def _protobuf_module() -> Any:
    return importlib.import_module(
        "target.gen_python.protobuf.drivers.sysinfo.sysinfo",
    )


normalize_station_tcp = station_tcp.normalize_station_tcp

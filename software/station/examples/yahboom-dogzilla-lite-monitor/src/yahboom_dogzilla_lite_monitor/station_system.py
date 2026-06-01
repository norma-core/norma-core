from __future__ import annotations

import socket
import subprocess
import time
from dataclasses import dataclass, field

REFRESH_INTERVAL = 2.0


@dataclass
class Snapshot:
    networks: list[tuple[str, list[str]]] = field(default_factory=list)

    def ip_addresses(self, preferred_interface: str = "") -> list[str]:
        preferred_interface = preferred_interface.strip()
        ordered = sorted(
            self.networks,
            key=lambda item: (
                item[0] != preferred_interface if preferred_interface else False,
                item[0],
            ),
        )
        seen: set[str] = set()
        out: list[str] = []
        for _, raw_addrs in ordered:
            for addr in normalize_ipv4_addresses(raw_addrs):
                if addr not in seen:
                    seen.add(addr)
                    out.append(addr)
        return out


class Source:
    def __init__(self) -> None:
        self._snapshot = Snapshot()
        self._last_update = 0.0
        self.refresh_local()

    def close(self) -> None:
        return None

    def refresh_local(self) -> None:
        self._snapshot = Snapshot(_local_networks())
        self._last_update = time.monotonic()

    def _refresh_if_due(self) -> None:
        if self._last_update == 0.0 or time.monotonic() - self._last_update >= REFRESH_INTERVAL:
            self.refresh_local()

    def ip_addresses(self, preferred_interface: str = "") -> list[str]:
        self._refresh_if_due()
        return self._snapshot.ip_addresses(preferred_interface)


def normalize_ipv4_addresses(raw: list[str]) -> list[str]:
    out: list[str] = []
    for addr in raw:
        normalized = normalize_ipv4_address(addr)
        if normalized and normalized not in out:
            out.append(normalized)
    return out


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


def _local_networks() -> list[tuple[str, list[str]]]:
    networks = _ip_addr_show_networks()
    if networks:
        return networks
    addrs = _ifconfig_addresses()
    if addrs:
        return [("local", addrs)]
    return [("local", _hostname_addresses())]


def _ip_addr_show() -> list[str]:
    return [addr for _, addrs in _ip_addr_show_networks() for addr in addrs]


def _ip_addr_show_networks() -> list[tuple[str, list[str]]]:
    try:
        proc = subprocess.run(
            ["ip", "-4", "-o", "addr", "show"],
            capture_output=True,
            timeout=2,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return []
    if proc.returncode != 0:
        return []
    return _parse_ip_addr_show_networks(proc.stdout.decode(errors="replace"))


def _parse_ip_addr_show_networks(output: str) -> list[tuple[str, list[str]]]:
    by_interface: dict[str, list[str]] = {}
    interface_order: list[str] = []

    for raw in output.splitlines():
        fields = raw.split()
        if len(fields) < 4:
            continue
        interface = fields[1].split("@", 1)[0].strip()
        if not interface:
            continue
        try:
            inet_index = fields.index("inet")
        except ValueError:
            continue
        if inet_index + 1 >= len(fields):
            continue
        if interface not in by_interface:
            by_interface[interface] = []
            interface_order.append(interface)
        by_interface[interface].append(fields[inet_index + 1])

    return [(interface, by_interface[interface]) for interface in interface_order]


def _local_ipv4_addresses() -> list[str]:
    addrs: list[str] = []
    for _, interface_addrs in _local_networks():
        addrs.extend(interface_addrs)
    return addrs


def _ifconfig_addresses() -> list[str]:
    try:
        proc = subprocess.run(
            ["ifconfig"],
            capture_output=True,
            timeout=2,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return []
    if proc.returncode != 0:
        return []
    addrs: list[str] = []
    for raw in proc.stdout.decode(errors="replace").splitlines():
        stripped = raw.strip()
        if not stripped.startswith("inet "):
            continue
        fields = stripped.split()
        if len(fields) < 2:
            continue
        addrs.append(fields[1])
    return addrs


def _hostname_addresses() -> list[str]:
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
    except OSError:
        return []
    return [str(info[4][0]) for info in infos]

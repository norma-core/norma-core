from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass

from yahboom_dogzilla_lite.network import InternetState, InternetStatus


def available() -> bool:
    return shutil.which("nmcli") is not None


@dataclass
class Provider:
    binary: str = "nmcli"
    timeout: float = 10.0

    def status(self) -> InternetStatus:
        general = self._run("-t", "-f", "STATE,CONNECTIVITY", "general", "status")
        devices = self._run("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status")
        state, connectivity = parse_general_status(general)
        iface = parse_active_wifi(devices)
        return InternetStatus(map_connectivity(state, connectivity), iface)

    def _run(self, *args: str) -> str:
        try:
            proc = subprocess.run(
                [self.binary, *args],
                check=False,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"nmcli timed out while running {' '.join(args)!r}") from exc
        if proc.returncode != 0:
            detail = proc.stderr.strip() or f"exit status {proc.returncode}"
            raise RuntimeError(f"nmcli {' '.join(args)}: {detail}")
        return proc.stdout


def parse_general_status(output: str) -> tuple[str, str]:
    lines = _non_empty_lines(output)
    if not lines:
        return "", ""
    fields = split_escaped(lines[0], ":")
    if len(fields) >= 2:
        return fields[0].strip().lower(), fields[1].strip().lower()
    return "", ""


def parse_active_wifi(output: str) -> str:
    for line in _non_empty_lines(output):
        fields = split_escaped(line, ":")
        if len(fields) < 4 or fields[1].strip() != "wifi":
            continue
        if fields[2].strip().lower() != "connected":
            continue
        return fields[0].strip()
    return ""


def map_connectivity(state: str, connectivity: str) -> InternetState:
    if connectivity == "full":
        return InternetState.ONLINE
    if connectivity == "limited":
        return InternetState.LIMITED
    if connectivity == "portal":
        return InternetState.PORTAL
    if connectivity == "none":
        return InternetState.OFFLINE
    if state == "connected":
        return InternetState.LIMITED
    if state in {"connecting", "disconnecting"}:
        return InternetState.UNKNOWN
    if state in {"disconnected", "asleep"}:
        return InternetState.OFFLINE
    return InternetState.UNKNOWN


def split_escaped(value: str, sep: str) -> list[str]:
    fields: list[str] = []
    current: list[str] = []
    escaped = False
    for char in value:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == sep:
            fields.append("".join(current))
            current = []
        else:
            current.append(char)
    fields.append("".join(current))
    return fields


def _non_empty_lines(output: str) -> list[str]:
    return [line.strip() for line in output.splitlines() if line.strip()]

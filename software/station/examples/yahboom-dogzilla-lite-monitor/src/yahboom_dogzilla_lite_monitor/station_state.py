from __future__ import annotations

import importlib
import mmap
import os
import struct
import time
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any, BinaryIO

DEFAULT_SHM_PATH = "/run/station/yahboom-dogzilla-lite-monitor"
BUFFER_COUNT = 4
HEADER_SIZE = 24
EMPTY_SEQ = (1 << 64) - 1


class NoSharedStateDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class BatteryStatus:
    available: bool = False
    level: int = 0


@dataclass(frozen=True)
class DeviceStatus:
    connected: bool = False
    battery: BatteryStatus = dataclass_field(default_factory=BatteryStatus)


@dataclass(frozen=True)
class State:
    devices: list[DeviceStatus] = dataclass_field(default_factory=list)

    def primary_battery_status(self) -> BatteryStatus:
        fallback: BatteryStatus | None = None
        for device in self.devices:
            if not device.battery.available:
                continue
            if device.connected:
                return device.battery
            if fallback is None:
                fallback = device.battery
        return fallback or BatteryStatus()


@dataclass(frozen=True)
class SharedStateFrame:
    sequence: int
    timestamp_ns: int
    payload: bytes

    def age_seconds(self, now_ns: int | None = None) -> float | None:
        if self.timestamp_ns <= 0:
            return None
        if now_ns is None:
            now_ns = time.monotonic_ns()
        if now_ns < self.timestamp_ns:
            return 0.0
        return (now_ns - self.timestamp_ns) / 1_000_000_000

    def is_stale(self, max_age_seconds: float, now_ns: int | None = None) -> bool:
        if max_age_seconds <= 0:
            return False
        age = self.age_seconds(now_ns)
        return age is not None and age > max_age_seconds


class Source:
    def __init__(self, shm_path: str = DEFAULT_SHM_PATH) -> None:
        self._path = shm_path.strip() or DEFAULT_SHM_PATH
        self._file: BinaryIO | None = None
        self._mmap: mmap.mmap | None = None
        self._total_size = 0
        self._buffer_size = 0
        self._max_data_size = 0
        self._file_identity: tuple[int, int] | None = None
        self._open()

    def _open(self) -> None:
        file = open(self._path, "rb")
        try:
            stat = os.fstat(file.fileno())
            total_size = stat.st_size
            if total_size <= 0 or total_size % BUFFER_COUNT != 0:
                raise RuntimeError(f"unexpected shared state file size {total_size}")
            buffer_size = total_size // BUFFER_COUNT
            if buffer_size <= HEADER_SIZE:
                raise RuntimeError(f"shared state buffer size {buffer_size} is too small")
            mapping = mmap.mmap(file.fileno(), total_size, access=mmap.ACCESS_READ)
        except Exception:
            file.close()
            raise
        self._file = file
        self._mmap = mapping
        self._total_size = total_size
        self._buffer_size = buffer_size
        self._max_data_size = buffer_size - HEADER_SIZE
        self._file_identity = (stat.st_dev, stat.st_ino)

    def close(self) -> None:
        if self._mmap is not None:
            self._mmap.close()
            self._mmap = None
        if self._file is not None:
            self._file.close()
            self._file = None
        self._file_identity = None

    def read(self) -> State:
        return parse_state(self.read_frame().payload)

    def read_battery_status(self) -> BatteryStatus:
        return parse_battery_status(self.read_frame().payload)

    def read_frame(self) -> SharedStateFrame:
        return self.read_latest_frame()

    def read_latest(self) -> bytes:
        return self.read_latest_frame().payload

    def read_latest_frame(self) -> SharedStateFrame:
        self._reopen_if_file_changed()
        if self._mmap is None:
            raise NoSharedStateDataError("station shared state is closed")

        best: SharedStateFrame | None = None
        for index in range(BUFFER_COUNT):
            start = index * self._buffer_size
            frame = _read_frame_with_validation(
                self._mmap,
                start,
                self._max_data_size,
                max_retries=3,
            )
            if frame is None:
                continue
            if best is None or frame.sequence >= best.sequence:
                best = frame
        if best is None:
            raise NoSharedStateDataError("station shared state has no readable frames")
        return best

    def _reopen_if_file_changed(self) -> None:
        if self._file is None:
            self._open()
            return

        current_stat = os.stat(self._path)
        open_stat = os.fstat(self._file.fileno())
        current_identity = (current_stat.st_dev, current_stat.st_ino)
        open_identity = (open_stat.st_dev, open_stat.st_ino)
        if (
            current_identity != open_identity
            or open_identity != self._file_identity
            or open_stat.st_size != self._total_size
        ):
            self.close()
            self._open()


def _read_header(buf: mmap.mmap, start: int) -> tuple[int, int, int]:
    seq = struct.unpack_from("<Q", buf, start)[0]
    timestamp_ns = struct.unpack_from("<Q", buf, start + 8)[0]
    data_size = struct.unpack_from("<I", buf, start + 16)[0]
    return seq, timestamp_ns, data_size


def _read_frame_with_validation(
    buf: mmap.mmap, start: int, max_data_size: int, max_retries: int
) -> SharedStateFrame | None:
    for attempt in range(max_retries):
        if attempt > 0:
            time.sleep(0.001)
        seq1, timestamp_ns1, data_size1 = _read_header(buf, start)
        if seq1 == EMPTY_SEQ:
            continue
        if data_size1 > max_data_size:
            return None

        payload = bytes(buf[start + HEADER_SIZE : start + HEADER_SIZE + data_size1])
        seq2, timestamp_ns2, data_size2 = _read_header(buf, start)
        if (seq1, timestamp_ns1, data_size1) == (seq2, timestamp_ns2, data_size2):
            return SharedStateFrame(seq1, timestamp_ns1, payload)
    return None


def parse_battery_status(payload: bytes) -> BatteryStatus:
    return parse_state(payload).primary_battery_status()


def parse_state(payload: bytes) -> State:
    pb = _protobuf_module()
    reader = pb.InferenceStateReader(memoryview(payload))
    return State(
        devices=[parse_device_status_reader(device) for device in reader.get_devices()],
    )


def parse_device_status_reader(reader: Any) -> DeviceStatus:
    if getattr(reader, "_status_buf", None) is None:
        return DeviceStatus(connected=reader.get_is_connected())
    status = reader.get_status()
    return DeviceStatus(
        connected=reader.get_is_connected(),
        battery=BatteryStatus(True, clamp_battery_level(status.get_battery_level())),
    )


def clamp_battery_level(level: int) -> int:
    return min(max(level, 0), 100)


def _protobuf_module() -> Any:
    return importlib.import_module(
        "target.gen_python.protobuf.drivers.yahboom_dogzilla_lite.yahboom_dogzilla_lite",
    )

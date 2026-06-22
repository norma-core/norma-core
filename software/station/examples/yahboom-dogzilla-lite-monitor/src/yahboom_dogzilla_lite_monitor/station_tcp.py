from __future__ import annotations

import asyncio
import importlib
import logging
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_STATION_TCP = "127.0.0.1:8888"
RECONNECT_DELAY_SECONDS = 1.0
READ_LATEST_TIMEOUT_SECONDS = 2.0


class NoQueueDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class QueueFrame:
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
    def __init__(
        self,
        station_tcp: str,
        queue_id: str,
        *,
        label: str,
        logger: logging.Logger | None = None,
        error_cls: type[NoQueueDataError] = NoQueueDataError,
    ) -> None:
        self._station_tcp = normalize_station_tcp(station_tcp)
        self._queue_id = queue_id.strip()
        self._label = label
        self._logger = logger or logging.getLogger(__name__)
        self._error_cls = error_cls
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._latest_frame: QueueFrame | None = None
        self._last_error = ""
        self._thread = threading.Thread(
            target=self._thread_main,
            name=f"{label}-tcp-reader",
            daemon=True,
        )
        self._thread.start()

    def close(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=2.0)

    def read_frame(self) -> QueueFrame:
        with self._lock:
            if self._latest_frame is not None:
                return self._latest_frame
            error = self._last_error
        if error:
            raise self._error_cls(error)
        raise self._error_cls(f"{self._label} queue {self._queue_id!r} has not delivered data yet")

    def _thread_main(self) -> None:
        try:
            asyncio.run(self._run())
        except Exception as exc:
            self._set_error(f"{self._label} TCP reader stopped: {exc}")

    async def _run(self) -> None:
        station_py = _station_py_module()
        client = station_py.Client(self._station_tcp, self._logger)
        try:
            while not self._stop_event.is_set():
                try:
                    await client.wait_ready(timeout=1.0)
                except TimeoutError:
                    await asyncio.sleep(RECONNECT_DELAY_SECONDS)
                    continue

                await self._read_latest(client)
                await self._follow_until_reconnect(client)
                if client.connected and not self._stop_event.is_set():
                    await asyncio.sleep(RECONNECT_DELAY_SECONDS)
        finally:
            client.close_connection()

    async def _read_latest(self, client: Any) -> None:
        qr = client.read_from_tail(
            self._queue_id,
            offset=(1).to_bytes(8, "little"),
            limit=1,
            step=1,
            buf_size=1,
        )
        try:
            entry = await asyncio.wait_for(
                qr.data.get(),
                timeout=READ_LATEST_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            self._set_error(f"timed out reading latest {self._queue_id!r}")
            return
        if entry is None:
            if qr.err is not None:
                self._set_error(f"failed to read latest {self._queue_id!r}: {qr.err}")
            return
        self._set_payload(bytes(entry.Data))

    async def _follow_until_reconnect(self, client: Any) -> None:
        entries: asyncio.Queue[Any] = asyncio.Queue(maxsize=100)
        errors = client.follow(self._queue_id, entries)
        while not self._stop_event.is_set() and client.connected:
            try:
                error = errors.get_nowait()
            except asyncio.QueueEmpty:
                error = None
            if error is not None:
                self._set_error(f"queue {self._queue_id!r} follow failed: {error}")
                return

            try:
                entry = await asyncio.wait_for(entries.get(), timeout=1.0)
            except TimeoutError:
                continue
            if entry is None:
                try:
                    error = errors.get_nowait()
                except asyncio.QueueEmpty:
                    error = None
                if error is not None:
                    self._set_error(f"queue {self._queue_id!r} follow failed: {error}")
                else:
                    self._set_error(f"queue {self._queue_id!r} follow stream ended")
                return
            self._set_payload(bytes(entry.Data))

    def _set_payload(self, payload: bytes) -> None:
        with self._lock:
            self._latest_frame = QueueFrame(time.monotonic_ns(), payload)
            self._last_error = ""

    def _set_error(self, error: str) -> None:
        with self._lock:
            self._last_error = error


def normalize_station_tcp(station_tcp: str) -> str:
    value = station_tcp.strip() or DEFAULT_STATION_TCP
    if ":" not in value:
        return f"{value}:8888"
    return value


def _station_py_module() -> Any:
    try:
        return importlib.import_module("station_py")
    except ImportError:
        pass

    source_file = Path(__file__).resolve()
    for parent in source_file.parents:
        candidate = parent / "shared" / "station_py"
        if candidate.is_dir():
            sys.path.insert(0, str(parent / "shared"))
            return importlib.import_module("station_py")

    return importlib.import_module("station_py")

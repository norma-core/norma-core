"""Async WebSocket client for the station's NormFS protocol.

One connection: a setup handshake, a follow-read on st3215/inference that
keeps the latest frame, and writes to the commands queue acknowledged by
write_id. Reconnects forever with a fixed delay.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Sequence

from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from elrobot_ik.station.arms import BusSnapshot, parse_frame
from elrobot_ik.station.commands import pack_commands
from elrobot_ik.station.proto import commands_pb2, normfs_pb2, st3215_pb2

log = logging.getLogger(__name__)

INFERENCE_QUEUE = "st3215/inference"
COMMANDS_QUEUE = "commands"
PROTOCOL_VERSION = 1
FOLLOW_READ_ID = 1


class StationError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


class StationClient:
    def __init__(self, url: str, *, reconnect_delay_s: float = 1.0, write_timeout_s: float = 5.0):
        self.url = url
        self.reconnect_delay_s = reconnect_delay_s
        self.write_timeout_s = write_timeout_s
        self.connected = False
        self.latest_frame: bytes | None = None
        self.latest_frame_at: float | None = None
        self._buses_cache: tuple[bytes | None, list[BusSnapshot]] = (None, [])
        self._ws = None
        self._task: asyncio.Task | None = None
        self._next_write_id = 1
        self._pending: dict[int, asyncio.Future] = {}
        self._next_read_id = 2  # 1 is the inference follow
        self._reads: dict[int, tuple[list[tuple[bytes, bytes]], asyncio.Future]] = {}
        self._connected_event = asyncio.Event()
        self._frame_event = asyncio.Event()

    # -- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="station-client")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self._close_ws()

    async def wait_connected(self, timeout_s: float) -> bool:
        return await _wait(self._connected_event, timeout_s)

    async def wait_frame(self, timeout_s: float) -> bool:
        return await _wait(self._frame_event, timeout_s)

    # -- state -------------------------------------------------------------

    def frame_age_ms(self) -> float | None:
        if self.latest_frame_at is None:
            return None
        return (time.monotonic() - self.latest_frame_at) * 1000.0

    def buses(self) -> list[BusSnapshot]:
        if self.latest_frame is None:
            return []
        cached_frame, cached = self._buses_cache
        if cached_frame is self.latest_frame:
            return cached
        buses = parse_frame(self.latest_frame)
        self._buses_cache = (self.latest_frame, buses)
        return buses

    # -- requests ----------------------------------------------------------

    async def _request(self, req: normfs_pb2.ClientRequest, key: int, registry: dict, fut: asyncio.Future,
                       timeout_s: float, timeout_detail: str):
        """Send one request and wait for the dispatcher to resolve its future."""
        if not self.connected or self._ws is None:
            raise StationError("disconnected", f"station {self.url} not connected")
        try:
            await self._ws.send(req.SerializeToString())
            return await asyncio.wait_for(fut, timeout_s)
        except TimeoutError:
            raise StationError("timeout", timeout_detail) from None
        except (WebSocketException, OSError) as e:
            raise StationError("disconnected", f"station connection lost: {e}") from e
        finally:
            registry.pop(key, None)

    async def send_commands(self, commands: Sequence[st3215_pb2.Command | commands_pb2.DriverCommand]) -> None:
        """Write one StationCommandsPack to the commands queue and wait for the station's ack."""
        write_id = self._next_write_id
        self._next_write_id += 1
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[write_id] = fut
        req = normfs_pb2.ClientRequest()
        req.write.write_id = write_id
        req.write.queue_id = COMMANDS_QUEUE
        req.write.packets.append(pack_commands(commands))
        resp = await self._request(req, write_id, self._pending, fut, self.write_timeout_s,
                                   "station did not acknowledge the command write")
        if resp.result != normfs_pb2.WriteResponse.WR_DONE:
            raise StationError("server_error", "station rejected the command write")

    async def read_tail(self, queue_id: str, n: int, timeout_s: float = 5.0) -> list[tuple[bytes, bytes]]:
        """The last `n` entries of a queue as (entry id, data), oldest first. Empty when the queue is empty."""
        if n < 1:
            raise ValueError("read_tail requires a positive entry count")
        # The tail is the newest entry itself: shift 0 reads it, shift 1 its predecessor.
        return await self._read(queue_id, normfs_pb2.OT_SHIFT_FROM_TAIL, (n - 1).to_bytes(8, "little"), n, timeout_s)

    async def read_from(self, queue_id: str, first_id: bytes, n: int, timeout_s: float = 5.0) -> list[tuple[bytes, bytes]]:
        """Up to `n` entries starting at entry id `first_id` (8 bytes, little-endian), oldest first."""
        return await self._read(queue_id, normfs_pb2.OT_ABSOLUTE, first_id, n, timeout_s)

    async def _read(self, queue_id: str, offset_type: int, offset_id: bytes, n: int, timeout_s: float) -> list[tuple[bytes, bytes]]:
        read_id = self._next_read_id
        self._next_read_id += 1
        entries: list[tuple[bytes, bytes]] = []
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._reads[read_id] = (entries, fut)
        req = normfs_pb2.ClientRequest()
        req.read.read_id = read_id
        req.read.queue_id = queue_id
        req.read.step = 1
        req.read.limit = n
        req.read.offset.id.raw = offset_id
        req.read.offset.type = offset_type
        result = await self._request(req, read_id, self._reads, fut, timeout_s, f"station did not finish reading {queue_id}")
        if result == normfs_pb2.ReadResponse.RR_QUEUE_NOT_FOUND:
            raise StationError("not_found", f"queue {queue_id} not found on station")
        if result == normfs_pb2.ReadResponse.RR_SERVER_ERROR:
            raise StationError("server_error", f"station failed to read {queue_id}")
        return entries  # RR_END, or RR_NOT_FOUND (fewer entries than asked): what we got

    # -- connection loop ---------------------------------------------------

    async def _run(self) -> None:
        while True:
            try:
                async with connect(self.url, max_size=16 * 1024 * 1024) as ws:
                    self._ws = ws
                    await self._handshake(ws)
                    await self._subscribe(ws)
                    self.connected = True
                    self._connected_event.set()
                    log.info("connected to station %s", self.url)
                    async for raw in ws:
                        self._dispatch(normfs_pb2.ServerResponse.FromString(raw))
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - any failure means reconnect
                log.warning("station connection error (%s); retrying in %.1fs", e, self.reconnect_delay_s)
            finally:
                self._on_disconnect()
            await asyncio.sleep(self.reconnect_delay_s)

    async def _handshake(self, ws) -> None:
        req = normfs_pb2.ClientRequest()
        req.setup.version = PROTOCOL_VERSION
        await ws.send(req.SerializeToString())
        while True:
            resp = normfs_pb2.ServerResponse.FromString(await asyncio.wait_for(ws.recv(), 10))
            if resp.HasField("setup"):
                if resp.setup.version != PROTOCOL_VERSION:
                    raise StationError("server_error", f"protocol version {resp.setup.version} unsupported")
                return

    async def _subscribe(self, ws) -> None:
        req = normfs_pb2.ClientRequest()
        req.read.read_id = FOLLOW_READ_ID
        req.read.queue_id = INFERENCE_QUEUE
        req.read.step = 1
        req.read.limit = 0  # follow forever
        req.read.offset.id.raw = b"\x00"
        req.read.offset.type = normfs_pb2.OT_SHIFT_FROM_TAIL
        await ws.send(req.SerializeToString())

    def _dispatch(self, resp: normfs_pb2.ServerResponse) -> None:
        if resp.HasField("write"):
            fut = self._pending.get(resp.write.write_id)
            if fut and not fut.done():
                fut.set_result(resp.write)
        elif resp.HasField("read"):
            r = resp.read
            if r.read_id == FOLLOW_READ_ID:
                self._on_follow(r)
            elif (pending := self._reads.get(r.read_id)) is not None:
                entries, fut = pending
                if r.result == normfs_pb2.ReadResponse.RR_ENTRY:
                    entries.append((bytes(r.id.raw), bytes(r.data)))
                elif r.result != normfs_pb2.ReadResponse.RR_START and not fut.done():
                    fut.set_result(r.result)

    def _on_follow(self, r: normfs_pb2.ReadResponse) -> None:
        if r.result == normfs_pb2.ReadResponse.RR_ENTRY:
            self.latest_frame = bytes(r.data)
            self.latest_frame_at = time.monotonic()
            self._frame_event.set()
        elif r.result != normfs_pb2.ReadResponse.RR_START:
            # The follow-read is over (queue not created yet, server-side error).
            # Drop the connection so _run re-subscribes after reconnect_delay_s.
            raise StationError("server_error", f"inference read ended with result {r.result}")

    def _on_disconnect(self) -> None:
        self.connected = False
        self._connected_event.clear()
        self._ws = None
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(StationError("disconnected", "station connection lost"))
        self._pending.clear()
        for _, fut in self._reads.values():
            if not fut.done():
                fut.set_exception(StationError("disconnected", "station connection lost"))
        self._reads.clear()

    async def _close_ws(self) -> None:
        ws, self._ws = self._ws, None
        if ws is not None:
            with contextlib.suppress(Exception):
                await ws.close()
        self.connected = False


async def _wait(event: asyncio.Event, timeout_s: float) -> bool:
    try:
        await asyncio.wait_for(event.wait(), timeout_s)
        return True
    except TimeoutError:
        return False

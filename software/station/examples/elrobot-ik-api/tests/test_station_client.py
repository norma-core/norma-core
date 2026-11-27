import asyncio
import struct

import pytest
from websockets.asyncio.server import serve

from elrobot_ik.station.client import COMMANDS_QUEUE, INFERENCE_QUEUE, StationClient, StationError
from elrobot_ik.station.commands import torque_command
from elrobot_ik.station.proto import normfs_pb2
from tests.helpers import make_elrobot_bus, make_frame, unpack_commands


class FakeStation:
    """Speaks just enough NormFS over WebSocket: setup, follow-read of one queue, write acks."""

    def __init__(self, frames: list[bytes], *, fail_writes: bool = False, first_read_fails: bool = False,
                 queues: dict[str, list[bytes]] | None = None):
        self.frames = frames
        self.fail_writes = fail_writes
        self.first_read_fails = first_read_fails
        self.queues = queues or {}  # other queues for one-shot tail reads
        self.writes: list[bytes] = []
        self.connections = 0
        self._server = None
        self.port = None
        self._push = asyncio.Queue()

    async def __aenter__(self):
        self._server = await serve(self._handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *exc):
        self._server.close()
        await self._server.wait_closed()

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/api"

    async def push_frame(self, frame: bytes):
        await self._push.put(frame)

    async def _handle(self, ws):
        self.connections += 1
        pusher = None
        try:
            async for raw in ws:
                req = normfs_pb2.ClientRequest.FromString(raw)
                if req.HasField("setup"):
                    resp = normfs_pb2.ServerResponse()
                    resp.setup.version = req.setup.version
                    await ws.send(resp.SerializeToString())
                elif req.HasField("read") and req.read.queue_id != INFERENCE_QUEUE:
                    rid = req.read.read_id
                    resp = normfs_pb2.ServerResponse(); resp.read.read_id = rid
                    if req.read.queue_id not in self.queues:
                        resp.read.result = normfs_pb2.ReadResponse.RR_QUEUE_NOT_FOUND
                        await ws.send(resp.SerializeToString()); continue
                    n = req.read.limit
                    start = normfs_pb2.ServerResponse(); start.read.read_id = rid; start.read.result = normfs_pb2.ReadResponse.RR_START
                    await ws.send(start.SerializeToString())
                    items = list(enumerate(self.queues[req.read.queue_id]))
                    if req.read.offset.type == normfs_pb2.OT_ABSOLUTE:
                        first = struct.unpack("<Q", req.read.offset.id.raw)[0] - 1  # entry ids are 1-based here
                        items = items[first : first + n]
                    else:
                        items = items[-n:]
                    for i, data in items:
                        await ws.send(self._entry(rid, i, data))
                    resp.read.result = normfs_pb2.ReadResponse.RR_END
                    await ws.send(resp.SerializeToString())
                elif req.HasField("read"):
                    assert req.read.queue_id == INFERENCE_QUEUE
                    if self.first_read_fails and self.connections == 1:
                        nf = normfs_pb2.ServerResponse()
                        nf.read.read_id = req.read.read_id
                        nf.read.result = normfs_pb2.ReadResponse.RR_QUEUE_NOT_FOUND
                        await ws.send(nf.SerializeToString())
                        continue
                    start = normfs_pb2.ServerResponse()
                    start.read.read_id = req.read.read_id
                    start.read.result = normfs_pb2.ReadResponse.RR_START
                    await ws.send(start.SerializeToString())
                    for i, frame in enumerate(self.frames):
                        await ws.send(self._entry(req.read.read_id, i, frame))
                    pusher = asyncio.create_task(self._pump(ws, req.read.read_id, len(self.frames)))
                elif req.HasField("write"):
                    assert req.write.queue_id == COMMANDS_QUEUE
                    self.writes.extend(bytes(p) for p in req.write.packets)
                    resp = normfs_pb2.ServerResponse()
                    resp.write.write_id = req.write.write_id
                    resp.write.result = (
                        normfs_pb2.WriteResponse.WR_SERVER_ERROR if self.fail_writes else normfs_pb2.WriteResponse.WR_DONE
                    )
                    await ws.send(resp.SerializeToString())
        finally:
            if pusher:
                pusher.cancel()

    async def _pump(self, ws, read_id, start_index):
        i = start_index
        while True:
            frame = await self._push.get()
            await ws.send(self._entry(read_id, i, frame))
            i += 1

    @staticmethod
    def _entry(read_id, index, frame) -> bytes:
        resp = normfs_pb2.ServerResponse()
        resp.read.read_id = read_id
        resp.read.result = normfs_pb2.ReadResponse.RR_ENTRY
        resp.read.id.raw = struct.pack("<Q", index + 1)
        resp.read.data = frame
        return resp.SerializeToString()


FRAME_A = make_frame(make_elrobot_bus("A", positions=[2000] * 8))
FRAME_B = make_frame(make_elrobot_bus("A", positions=[2100] * 8))


async def test_connects_and_receives_latest_frame():
    async with FakeStation([FRAME_A, FRAME_B]) as station:
        client = StationClient(station.url, reconnect_delay_s=0.05)
        await client.start()
        try:
            assert await client.wait_frame(2.0)
            await asyncio.sleep(0.05)  # let the second frame land
            assert client.connected
            assert client.latest_frame == FRAME_B
            assert client.buses()[0].motor(1).steps == 2100
            assert client.frame_age_ms() is not None and client.frame_age_ms() < 1000
        finally:
            await client.stop()


async def test_send_commands_writes_pack_to_commands_queue():
    async with FakeStation([FRAME_A]) as station:
        client = StationClient(station.url, reconnect_delay_s=0.05)
        await client.start()
        try:
            assert await client.wait_connected(2.0)
            await client.send_commands([torque_command("A", [1, 2], True)])
            assert len(station.writes) == 1
            cmds = unpack_commands(station.writes[0])
            assert cmds[0].target_bus_serial == "A"
            assert [m.motor_id for m in cmds[0].sync_write.motors] == [1, 2]
        finally:
            await client.stop()


async def test_server_error_on_write_raises():
    async with FakeStation([FRAME_A], fail_writes=True) as station:
        client = StationClient(station.url, reconnect_delay_s=0.05)
        await client.start()
        try:
            assert await client.wait_connected(2.0)
            with pytest.raises(StationError) as e:
                await client.send_commands([torque_command("A", [1], True)])
            assert e.value.code == "server_error"
        finally:
            await client.stop()


async def test_send_fails_when_disconnected():
    client = StationClient("ws://127.0.0.1:1/api", reconnect_delay_s=0.05)
    await client.start()
    try:
        await asyncio.sleep(0.1)
        assert not client.connected
        with pytest.raises(StationError) as e:
            await client.send_commands([torque_command("A", [1], True)])
        assert e.value.code == "disconnected"
    finally:
        await client.stop()


async def test_reconnects_after_server_restart():
    station = FakeStation([FRAME_A])
    await station.__aenter__()
    port = station.port
    client = StationClient(station.url, reconnect_delay_s=0.05)
    await client.start()
    try:
        assert await client.wait_frame(2.0)
        await station.__aexit__(None, None, None)
        await asyncio.sleep(0.2)
        assert not client.connected

        # restart on the same port with a newer frame
        station2 = FakeStation([FRAME_B])
        station2._server = await serve(station2._handle, "127.0.0.1", port)
        station2.port = port
        try:
            deadline = asyncio.get_event_loop().time() + 3.0
            while client.latest_frame != FRAME_B and asyncio.get_event_loop().time() < deadline:
                await asyncio.sleep(0.05)
            assert client.connected
            assert client.latest_frame == FRAME_B
            assert station2.connections == 1
        finally:
            await station2.__aexit__(None, None, None)
    finally:
        await client.stop()


async def test_pushed_frame_updates_latest():
    async with FakeStation([FRAME_A]) as station:
        client = StationClient(station.url, reconnect_delay_s=0.05)
        await client.start()
        try:
            assert await client.wait_frame(2.0)
            await station.push_frame(FRAME_B)
            deadline = asyncio.get_event_loop().time() + 2.0
            while client.latest_frame != FRAME_B and asyncio.get_event_loop().time() < deadline:
                await asyncio.sleep(0.02)
            assert client.latest_frame == FRAME_B
        finally:
            await client.stop()


async def test_queue_not_found_triggers_reconnect():
    async with FakeStation([FRAME_A], first_read_fails=True) as station:
        client = StationClient(station.url, reconnect_delay_s=0.05)
        await client.start()
        try:
            assert await client.wait_frame(3.0), "client never recovered from RR_QUEUE_NOT_FOUND"
            assert station.connections == 2
            assert client.latest_frame == FRAME_A
        finally:
            await client.stop()


async def test_read_tail_returns_last_entries_and_errors_for_unknown_queue():
    async with FakeStation([FRAME_A], queues={"cam/1": [b"a", b"b", b"c"]}) as station:
        client = StationClient(station.url, reconnect_delay_s=0.05)
        await client.start()
        try:
            assert await client.wait_frame(2.0)
            tail = await client.read_tail("cam/1", 2)
            assert [d for _, d in tail] == [b"b", b"c"]
            assert len(await client.read_tail("cam/1", 10)) == 3
            with pytest.raises(StationError) as e:
                await client.read_tail("nope", 1)
            assert e.value.code == "not_found"
            assert client.latest_frame == FRAME_A  # the follow stream is untouched
            from_second = await client.read_from("cam/1", struct.pack("<Q", 2), 5)
            assert [(struct.unpack("<Q", i)[0], d) for i, d in from_second] == [(2, b"b"), (3, b"c")]
        finally:
            await client.stop()

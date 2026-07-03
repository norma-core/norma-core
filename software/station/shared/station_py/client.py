from __future__ import annotations
import asyncio
import socket
import struct
import threading
import time
from asyncio import StreamReader, StreamWriter
from typing import Optional, Dict, List
import uuid
from dataclasses import dataclass
from typing import Optional

from .errors import ErrNotConnected, ErrRequestTimeout, \
    ErrConnectionClosed, ErrInvalidResponse, ErrServerSide, ErrQueueNotFound, ErrReadStreamClosed, ErrEntryNotFound
from target.gen_python.protobuf.normfs import normfs as normfs_pb2

try:
    from target.gen_python.protobuf.station import commands
except ImportError:
    commands = None

@dataclass
class StreamEntryId:
    ID: bytes

@dataclass
class StreamEntry:
    ID: StreamEntryId
    Data: memoryview
    DataSource: Optional[int] = None


class QueueRead:
    def __init__(self, stream_id: uuid.UUID, data_channel: asyncio.Queue, error: Optional[Exception] = None):
        self.id = stream_id
        self.data = data_channel
        self.err = error


class Client:
    def __init__(self, addr: str, logger):
        self.addr = addr
        self.logger = logger
        self.conn: Optional[socket.socket] = None
        self.reader: Optional[StreamReader] = None
        self.writer: Optional[StreamWriter] = None
        self.connected = False
        self.setup_done = False
        self.lock = threading.Lock()

        self.c2s = asyncio.Queue(maxsize=1024)
        self.s2c = asyncio.Queue(maxsize=1024)

        self.next_write_id = 1
        self.pending_writes: Dict[int, asyncio.Queue] = {}
        self.pending_writes_lock = threading.Lock()

        self.next_read_id = 1
        self.pending_reads: Dict[int, asyncio.Queue] = {}
        self.pending_reads_lock = threading.Lock()

        self.last_msg_sent_time = 0
        self.ping_sequence = 0

        # Start connection management as a task in the provided loop
        asyncio.create_task(self.manage_connection())

    async def wait_ready(self, timeout: Optional[float] = None):
        """
        Waits until the client is connected and setup is done.
        """
        if timeout:
            start = asyncio.get_event_loop().time()
            while not self.setup_done:
                if asyncio.get_event_loop().time() - start > timeout:
                    raise TimeoutError("Client setup timed out")
                await asyncio.sleep(0.1)
        else:
            while not self.setup_done:
                await asyncio.sleep(0.1)

    async def manage_connection(self):
        while True:
            if not self.connected:
                try:
                    self.reader, self.writer = await asyncio.open_connection(self.addr.split(':')[0], int(self.addr.split(':')[1]))
                    self.connected = True
                    self.setup_done = False
                    self.logger.info("Connection established")
                    if not await self.perform_initial_setup():
                        self.connected = False
                        self.writer.close()
                        await self.writer.wait_closed()
                except Exception as e:
                    self.logger.error(f"Connection failed: {e}")
                    await asyncio.sleep(5)
                    continue

            tasks = [
                asyncio.ensure_future(self.read_loop()),
                asyncio.ensure_future(self.write_loop()),
                asyncio.ensure_future(self.keep_alive_loop()),
                asyncio.ensure_future(self.process_responses()),
            ]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
            self.logger.info("Connection loops terminated, attempting to reconnect...")
            self.connected = False
            self.setup_done = False
            await asyncio.sleep(5)

    async def perform_initial_setup(self) -> bool:
        setup_req = normfs_pb2.ClientRequest()
        setup_req.setup = normfs_pb2.SetupRequest(version=1)
        try:
            await self.send_message(setup_req)
            response = await asyncio.wait_for(self.read_message(), timeout=10)
            if response and response.get_setup():
                if response.get_setup().get_version() == 1:
                    self.setup_done = True
                    self.logger.info("Initial setup successful")
                    return True
                else:
                    self.logger.error("Version mismatch during setup")
                    return False
            else:
                self.logger.error("Invalid response during setup")
                return False
        except Exception as e:
            self.logger.error(f"Initial setup failed: {e}")
            return False

    async def read_loop(self):
        while self.connected:
            try:
                msg = await self.read_message()
                if msg:
                    await self.s2c.put(msg)
                else:
                    break
            except Exception as e:
                self.logger.error(f"Read loop error: {e}")
                self.connected = False
        self.close_connection()

    async def write_loop(self):
        while self.connected:
            try:
                msg = await self.c2s.get()
                await self.send_message(msg)
                self.c2s.task_done()
            except Exception as e:
                self.logger.error(f"Write loop error: {e}")
                self.connected = False
        self.close_connection()

    async def keep_alive_loop(self):
        while self.connected:
            await asyncio.sleep(1)
            if time.time() - self.last_msg_sent_time > 1:
                await self.send_ping()

    async def send_ping(self):
        self.ping_sequence += 1
        ping_req = normfs_pb2.ClientRequest()
        ping_req.ping = normfs_pb2.PingRequest(sequence=self.ping_sequence)
        await self.c2s.put(ping_req)

    async def process_responses(self):
        while self.connected:
            try:
                response = await self.s2c.get()
                if response.get_write():
                    write_id = response.get_write().get_write_id()
                    if write_id in self.pending_writes:
                        await self.pending_writes[write_id].put(response)
                if response.get_read():
                    read_id = response.get_read().get_read_id()
                    if read_id in self.pending_reads:
                        await self.pending_reads[read_id].put(response)
                self.s2c.task_done()
            except Exception as e:
                self.logger.error(f"Process responses error: {e}")
                self.connected = False
        self.close_connection()

    async def send_message(self, msg):
        if not self.writer:
            raise ErrNotConnected
        payload = msg.encode()
        size = len(payload)
        self.writer.write(struct.pack('<Q', size))
        self.writer.write(payload)
        await self.writer.drain()
        self.last_msg_sent_time = time.time()

    async def read_message(self):
        if not self.reader:
            raise ErrNotConnected
        try:
            size_bytes = await self.reader.readexactly(8)
            size = struct.unpack('<Q', size_bytes)[0]
            if size > 0:
                payload = await self.reader.readexactly(size)
                response = normfs_pb2.ServerResponseReader(payload)
                return response
            return None
        except (asyncio.IncompleteReadError, ConnectionResetError) as e:
            self.logger.error(f"Connection lost while reading: {e}")
            self.connected = False
            return None

    def close_connection(self):
        if self.writer:
            self.writer.close()
        self.connected = False
        self.setup_done = False
        self.logger.info("Connection closed")

    async def enqueue(self, queue_id: str, data: bytes) -> bytes:
        return await self._enqueue(queue_id, data)

    async def _enqueue(self, queue_id: str, data: bytes) -> bytes:
        if not self.connected or not self.setup_done:
            raise ErrNotConnected

        with self.pending_writes_lock:
            write_id = self.next_write_id
            self.next_write_id += 1
            resp_chan = asyncio.Queue(maxsize=1)
            self.pending_writes[write_id] = resp_chan

        try:
            request = normfs_pb2.ClientRequest()
            request.write = normfs_pb2.WriteRequest(
                write_id=write_id,
                queue_id=queue_id,
                packets=[data]
            )

            await self.c2s.put(request)

            try:
                response = await asyncio.wait_for(resp_chan.get(), timeout=30)
                if response is None:
                    raise ErrConnectionClosed
                
                write_response = response.get_write()
                if write_response.get_result() == normfs_pb2.WriteResponse_Result.WR_DONE:
                    return write_response.get_ids()[0].get_raw()
                elif write_response.get_result() == normfs_pb2.WriteResponse_Result.WR_SERVER_ERROR:
                    raise ErrServerSide
                else:
                    raise ErrInvalidResponse

            except asyncio.TimeoutError:
                raise ErrRequestTimeout
        finally:
            with self.pending_writes_lock:
                del self.pending_writes[write_id]

    async def enqueue_pack(self, queue_id: str, data: List[bytes]) -> List[bytes]:
        return await self._enqueue_pack(queue_id, data)

    async def _enqueue_pack(self, queue_id: str, data: List[bytes]) -> List[bytes]:
        if not self.connected or not self.setup_done:
            raise ErrNotConnected
        
        if not data:
            return []

        with self.pending_writes_lock:
            write_id = self.next_write_id
            self.next_write_id += 1
            resp_chan = asyncio.Queue(maxsize=1)
            self.pending_writes[write_id] = resp_chan

        try:
            request = normfs_pb2.ClientRequest()
            request.write = normfs_pb2.WriteRequest(
                write_id=write_id,
                queue_id=queue_id,
                packets=data
            )

            await self.c2s.put(request)

            try:
                response = await asyncio.wait_for(resp_chan.get(), timeout=30)
                if response is None:
                    raise ErrConnectionClosed

                write_response = response.get_write()
                if write_response.get_result() == normfs_pb2.WriteResponse_Result.WR_DONE:
                    return [id_bytes.get_raw() for id_bytes in write_response.get_ids()]
                elif write_response.get_result() == normfs_pb2.WriteResponse_Result.WR_SERVER_ERROR:
                    raise ErrServerSide
                else:
                    raise ErrInvalidResponse

            except asyncio.TimeoutError:
                raise ErrRequestTimeout
        finally:
            with self.pending_writes_lock:
                del self.pending_writes[write_id]

    def read_from_offset(self, queue_id: str, offset: bytes, limit: int, step: int, buf_size: int) -> QueueRead:
        """Read forward from offset measured from head of queue."""
        return self._read_internal(queue_id, offset, positive=True, limit=limit, step=step, buf_size=buf_size)

    def read_from_tail(self, queue_id: str, offset: bytes, limit: int, step: int, buf_size: int) -> QueueRead:
        """Read forward from offset measured from tail of queue."""
        return self._read_internal(queue_id, offset, positive=False, limit=limit, step=step, buf_size=buf_size)

    def _read_internal(self, queue_id: str, offset: bytes, positive: bool, limit: int, step: int, buf_size: int) -> QueueRead:
        stream_uuid = uuid.uuid4()
        data_channel = asyncio.Queue(maxsize=buf_size if buf_size > 0 else 1)
        qr = QueueRead(stream_uuid, data_channel)

        asyncio.create_task(self._read_async(qr, queue_id, offset, positive, limit, step, buf_size))
        return qr

    async def _read_async(self, qr: QueueRead, queue_id: str, offset: bytes, positive: bool, limit: int, step: int, buf_size: int):
        if not self.connected or not self.setup_done:
            qr.err = ErrNotConnected
            qr.data.put_nowait(None)
            return

        with self.pending_reads_lock:
            read_id = self.next_read_id
            self.next_read_id += 1
            server_response_chan = asyncio.Queue()
            self.pending_reads[read_id] = server_response_chan

        try:
            request = normfs_pb2.ClientRequest()
            offset_type = (
                normfs_pb2.OffsetType.OT_ABSOLUTE if positive
                else normfs_pb2.OffsetType.OT_SHIFT_FROM_TAIL
            )
            read_req = normfs_pb2.ReadRequest(
                read_id=read_id,
                queue_id=queue_id,
                offset=normfs_pb2.Offset(
                    id=normfs_pb2.Id(raw=offset),
                    type=offset_type
                ),
                limit=limit,
                step=step
            )
            request.read = read_req

            await self.c2s.put(request)

            initial_response = await server_response_chan.get()
            if not initial_response or not initial_response.get_read():
                qr.err = ErrReadStreamClosed
                return
                
            initial_read_resp = initial_response.get_read()
            result = initial_read_resp.get_result()

            if result == normfs_pb2.ReadResponse_Result.RR_START:
                self.logger.info(f"Read stream {read_id} started")
            elif result == normfs_pb2.ReadResponse_Result.RR_QUEUE_NOT_FOUND:
                qr.err = ErrQueueNotFound
                return
            elif result == normfs_pb2.ReadResponse_Result.RR_NOT_FOUND:
                qr.err = ErrEntryNotFound
                return
            elif result == normfs_pb2.ReadResponse_Result.RR_SERVER_ERROR:
                qr.err = ErrServerSide
                return
            else:
                qr.err = ErrInvalidResponse
                return

            # Phase 2: Stream entries
            while True:
                response = await server_response_chan.get()
                if not response or not response.get_read():
                    qr.err = ErrReadStreamClosed
                    return

                read_resp = response.get_read()
                result = read_resp.get_result()

                if result == normfs_pb2.ReadResponse_Result.RR_ENTRY:
                    entry = StreamEntry(
                        ID=StreamEntryId(ID=read_resp.get_id().get_raw()),
                        Data=memoryview(read_resp.get_data()),
                        DataSource=read_resp.get_data_source()
                    )
                    await qr.data.put(entry)
                elif result == normfs_pb2.ReadResponse_Result.RR_END:
                    self.logger.debug(f"Read stream {read_id} finished")
                    return
                elif result == normfs_pb2.ReadResponse_Result.RR_QUEUE_NOT_FOUND:
                    qr.err = ErrQueueNotFound
                    return
                elif result == normfs_pb2.ReadResponse_Result.RR_NOT_FOUND:
                    qr.err = ErrEntryNotFound
                    return
                elif result == normfs_pb2.ReadResponse_Result.RR_SERVER_ERROR:
                    qr.err = ErrServerSide
                    return
                else:
                    qr.err = ErrInvalidResponse
                    return
        except Exception as e:
            qr.err = e
        finally:
            with self.pending_reads_lock:
                if read_id in self.pending_reads:
                    del self.pending_reads[read_id]
            await qr.data.put(None)  # Signal end of stream

    def follow(self, queue_id: str, target: asyncio.Queue) -> asyncio.Queue:
        """
        Follow a queue - continuously stream new entries as they arrive.
        This is equivalent to read_from_tail with offset=0 and limit=0.

        Args:
            queue_id: The queue to follow
            target: asyncio.Queue where StreamEntry objects will be sent

        Returns:
            asyncio.Queue where errors will be sent (if any occur)
        """
        error_queue = asyncio.Queue(maxsize=1)
        asyncio.create_task(self._follow_async(queue_id, target, error_queue))
        return error_queue

    async def _follow_async(self, queue_id: str, target: asyncio.Queue, error_queue: asyncio.Queue):
        """Internal async implementation of follow - streams from QueueRead to target queue."""
        qr = self._read_internal(queue_id, offset=b'\x00', positive=False, limit=0, step=1, buf_size=100)

        try:
            while True:
                entry = await qr.data.get()
                if entry is None:
                    # Stream ended
                    if qr.err:
                        await error_queue.put(qr.err)
                    return
                await target.put(entry)
        except Exception as e:
            await error_queue.put(e)


# StationClient type alias (for API compatibility with Go)
StationClient = Client


async def new_station_client(server: str, logger) -> StationClient:
    """
    Create a new StationClient with default port 8888 if not specified.

    Args:
        server: Server address (e.g., "localhost" or "localhost:8888")
        logger: Logger instance

    Returns:
        StationClient instance
    """
    addr = server
    if ':' not in server:
        addr = f"{server}:8888"

    client = Client(addr, logger)
    await client.wait_ready(timeout=10.0)
    return client


async def send_commands(client: Client, command_list: List) -> None:
    """
    Send commands to the station using EnqueuePack.

    Args:
        client: StationClient instance
        command_list: List of DriverCommand protobuf messages

    Raises:
        Exception: If commands protobuf is not available or enqueue fails
    """
    if commands is None:
        raise ImportError("commands module not available - generate protobufs first")

    # Wrap commands in StationCommandsPack
    commands_pack = commands.StationCommandsPack(
        commands=command_list
    )

    # Encode the pack and send it as a single packet
    await client.enqueue("commands", commands_pack.encode())

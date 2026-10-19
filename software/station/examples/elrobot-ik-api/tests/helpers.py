"""Shared test builders: register snapshots, inference frames, camera queues, a fake station client."""
from collections.abc import Callable

from elrobot_ik.calibration.mapper import MotorMapper
from elrobot_ik.config import Settings
from elrobot_ik.service import ArmService
from elrobot_ik.station import registers as R
from elrobot_ik.station.arms import parse_frame
from elrobot_ik.station.client import StationError
from elrobot_ik.station.proto import commands_pb2, drivers_pb2, inference_pb2, st3215_pb2
from elrobot_ik.station.proto.usbvideo import frame_pb2, usbvideo_pb2

CAL_MIN, CAL_MAX = 1024, 3072
INSTANCE = "/155b778e7f8b0d414166c9669fd609d5c12e10d48a82916554077bb4e62817eb"
CAM_ID = "7bd21f18e39708492c1deee9e2a86aa7"
CAM_QUEUE = f"{INSTANCE}/usbvideo/{CAM_ID}"

# Settings for tests: short settle window and timeout so "arm never moves" paths finish fast.
FAST = {"motion_timeout_s": 0.3, "settle_window_s": 0.05}


def make_snapshot(position: int, *, voltage_v: float = 12.0, torque: bool = True, status: int = 0) -> bytes:
    """Build a 0x47-byte ST3215 register snapshot with the given values."""
    buf = bytearray(R.SNAPSHOT_SIZE)
    buf[R.ADDR_PRESENT_POSITION : R.ADDR_PRESENT_POSITION + 2] = (position & 0xFFFF).to_bytes(2, "little")
    buf[R.ADDR_PRESENT_VOLTAGE] = round(voltage_v * 10) & 0xFF
    buf[R.ADDR_TORQUE_ENABLE] = 1 if torque else 0
    buf[R.ADDR_STATUS] = status & 0xFF
    return bytes(buf)


def make_motor_state(motor_id: int, position: int, *, range_min: int = 0, range_max: int = 0, frozen: bool = False,
                     voltage_v: float = 12.0, status: int = 0, torque: bool = True) -> st3215_pb2.InferenceState.MotorState:
    m = st3215_pb2.InferenceState.MotorState()
    m.id = motor_id
    m.state = make_snapshot(position, voltage_v=voltage_v, status=status, torque=torque)
    m.range_min = range_min
    m.range_max = range_max
    m.range_freezed = frozen
    return m


def make_bus_state(serial: str, motors) -> st3215_pb2.InferenceState.BusState:
    b = st3215_pb2.InferenceState.BusState()
    b.bus.serial_number = serial
    b.motors.extend(motors)
    return b


def make_elrobot_bus(serial: str, positions: list[int] | None = None, *, calibrated: bool = True,
                     voltage_v: float = 12.0, status: int = 0) -> st3215_pb2.InferenceState.BusState:
    positions = positions or [2048] * 8
    motors = [
        make_motor_state(i + 1, positions[i], range_min=CAL_MIN if calibrated else 0, range_max=CAL_MAX if calibrated else 0,
                         frozen=calibrated, voltage_v=voltage_v, status=status)
        for i in range(8)
    ]
    return make_bus_state(serial, motors)


def make_frame(*buses) -> bytes:
    state = st3215_pb2.InferenceState()
    state.buses.extend(buses)
    return state.SerializeToString()


def make_inference_states(queues: dict[str, str]) -> bytes:
    """inference-states entry listing queues; values: "video" or anything else."""
    rx = inference_pb2.InferenceRx()
    for q, kind in queues.items():
        e = rx.entries.add()
        e.queue = q
        e.ptr = b"\x01"
        e.type = drivers_pb2.QDT_USB_VIDEO_FRAMES if kind == "video" else drivers_pb2.QDT_ST3215_INFERENCE
    return rx.SerializeToString()


def make_camera_frame(jpeg: bytes | None, *, width: int = 320, height: int = 240, product: str = "cam",
                      unique_id: str = "0x1", kind: str = "jpeg", event: str | None = None) -> bytes:
    env = usbvideo_pb2.RxEnvelope()
    env.camera.product = product
    env.camera.unique_id = unique_id
    if event == "connected":
        env.type = usbvideo_pb2.ET_DEVICE_CONNECTED
        return env.SerializeToString()
    env.type = usbvideo_pb2.ET_FRAMES
    env.frames.format.width = width
    env.frames.format.height = height
    env.frames.format.kind = frame_pb2.FF_JPEG if kind == "jpeg" else frame_pb2.FF_VP8
    if jpeg is not None:
        env.frames.frames_data.append(jpeg)
        st = env.frames.stamps.add()
        st.local_stamp_ns = 1_700_000_000_000_000_000
    return env.SerializeToString()


def camera_queues(latest_jpeg: bytes = b"\xff\xd8\xffjpeg") -> dict[str, list[bytes]]:
    """Fake station queues: one camera (a connect event, an older and the latest frame)."""
    return {
        "inference-states": [make_inference_states({f"{INSTANCE}/st3215/inference": "st", CAM_QUEUE: "video"})],
        CAM_QUEUE: [make_camera_frame(None, event="connected", product="UVC Camera", unique_id="0x113"),
                    make_camera_frame(b"\xff\xd8older", width=299, height=224, product="UVC Camera", unique_id="0x113"),
                    make_camera_frame(latest_jpeg, width=299, height=224, product="UVC Camera", unique_id="0x113")],
    }


# ---- decoding what was sent ------------------------------------------------------------

def unpack_driver_commands(data: bytes) -> list[commands_pb2.DriverCommand]:
    return list(commands_pb2.StationCommandsPack.FromString(data).commands)


def unpack_commands(data: bytes) -> list[st3215_pb2.Command]:
    """The st3215 commands in a pack (other driver commands are skipped)."""
    return [st3215_pb2.Command.FromString(d.body) for d in unpack_driver_commands(data) if d.type == drivers_pb2.STC_ST3215_COMMAND]


def is_goal_write(cmd) -> bool:
    return isinstance(cmd, st3215_pb2.Command) and cmd.sync_write.address == R.ADDR_GOAL_POSITION


def goal_steps(cmds) -> dict[int, int]:
    """motor id -> goal steps from the goal writes in a batch."""
    return {m.motor_id: int.from_bytes(m.value, "little") for c in cmds if is_goal_write(c) for m in c.sync_write.motors}


class FakeStationClient:
    """Duck-typed stand-in for StationClient used by service and API tests."""

    def __init__(self, frame: bytes | None, *, connected: bool = True, age_ms: float = 10.0, queues: dict[str, list[bytes]] | None = None):
        self.connected = connected
        self.age_ms = age_ms
        self.sent: list[list] = []
        self.on_send: Callable[[list], None] | None = None
        self._frame = frame
        self.queues = queues or {}  # queue id -> entries oldest first, for read_tail

    def set_frame(self, frame: bytes | None) -> None:
        self._frame = frame

    def frame_age_ms(self):
        return None if self._frame is None else self.age_ms

    def buses(self):
        return [] if self._frame is None else parse_frame(self._frame)

    async def send_commands(self, commands):
        self.sent.append(list(commands))
        if self.on_send:
            self.on_send(list(commands))

    async def read_tail(self, queue_id: str, n: int):
        if not self.connected:
            raise StationError("disconnected", "fake station not connected")
        if queue_id not in self.queues:
            raise StationError("not_found", f"queue {queue_id} not found")
        entries = self.queues[queue_id][-n:]
        return [(i.to_bytes(8, "little"), e) for i, e in enumerate(entries)]

    @property
    def st3215_commands(self) -> list[st3215_pb2.Command]:
        """Every servo command sent, in order (driver commands such as mirroring filtered out)."""
        return [c for b in self.sent for c in b if isinstance(c, st3215_pb2.Command)]

    @property
    def driver_types(self) -> list[int]:
        """The driver command type of every sent batch, in order (0 = st3215, 1 = mirroring)."""
        return [b[0].type if isinstance(b[0], commands_pb2.DriverCommand) else 0 for b in self.sent if b]

    def arrive_at_goals(self, serial: str = "F1", sag: dict[int, int] | None = None) -> None:
        """Make the fake arm land on every goal write (minus an optional per-motor sag)."""
        def on_send(cmds):
            goals = goal_steps(cmds)
            if goals:
                positions = [goals.get(i, 2048) - (sag or {}).get(i, 0) for i in range(1, 9)]
                self.set_frame(make_frame(make_elrobot_bus(serial, positions=positions)))
        self.on_send = on_send


def make_service(model, solver, frame, *, settings: Settings | None = None, **client_kw):
    """An ArmService over a fake station; returns (service, fake client)."""
    settings = settings or Settings(**FAST)
    client = FakeStationClient(frame, **client_kw)
    return ArmService(client, model, solver, MotorMapper(model.joint_limits), settings), client

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any

from yahboom_dogzilla_lite_monitor import station_tcp

DEFAULT_QUEUE_ID = "yahboom-dogzilla-lite/inference"


class NoDogzillaStateDataError(station_tcp.NoQueueDataError):
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


class Source(station_tcp.Source):
    def __init__(
        self,
        station_tcp_addr: str = station_tcp.DEFAULT_STATION_TCP,
        queue_id: str = DEFAULT_QUEUE_ID,
        *,
        logger: logging.Logger | None = None,
    ) -> None:
        super().__init__(
            station_tcp_addr,
            queue_id.strip() or DEFAULT_QUEUE_ID,
            label="dogzilla",
            logger=logger,
            error_cls=NoDogzillaStateDataError,
        )

    def read(self) -> State:
        return parse_state(self.read_frame().payload)

    def read_battery_status(self) -> BatteryStatus:
        return parse_battery_status(self.read_frame().payload)


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

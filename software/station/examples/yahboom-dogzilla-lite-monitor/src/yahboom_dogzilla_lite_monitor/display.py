from __future__ import annotations

import ctypes
import fcntl
import os
import platform
import struct
import time
from dataclasses import dataclass
from typing import Protocol

from PIL import Image

SPI_MAGIC = 107
SPI_WRITE = 1
SPI_NR_SHIFT = 0
SPI_TYPE_SHIFT = 8
SPI_SIZE_SHIFT = 16
SPI_DIR_SHIFT = 30

CMD_SWRESET = 0x01
CMD_SLPOUT = 0x11
CMD_COLMOD = 0x3A
CMD_MADCTL = 0x36
CMD_INVON = 0x21
CMD_INVOFF = 0x20
CMD_NORON = 0x13
CMD_DISPON = 0x29
CMD_CASET = 0x2A
CMD_RASET = 0x2B
CMD_RAMWR = 0x2C

SPI_WRITE_CHUNK_SIZE = 4096

GPIO_MAX_NAME_SIZE = 32
GPIO_HANDLES_MAX = 64
GPIO_HANDLE_REQUEST_OUTPUT = 1 << 1
GPIO_CONSUMER_LABEL = b"yahboom-dogzilla-lite-monitor"

GPIO_IOCTL_NR_SHIFT = 0
GPIO_IOCTL_TYPE_SHIFT = 8
GPIO_IOCTL_SIZE_SHIFT = 16
GPIO_IOCTL_DIR_SHIFT = 30
GPIO_IOCTL_WRITE = 1
GPIO_IOCTL_READ = 2


class Screen(Protocol):
    def bounds(self) -> tuple[int, int]: ...

    def present(self, image: Image.Image) -> None: ...

    def close(self) -> None: ...


@dataclass
class Config:
    mode: str = "auto"
    spi_device: str = "/dev/spidev0.0"
    gpiochip: str = "/dev/gpiochip0"
    dc_pin: int = 25
    reset_pin: int = 27
    width: int = 320
    height: int = 240
    offset_x: int = 0
    offset_y: int = 0
    spi_speed_hz: int = 40_000_000
    madctl: int = 0x70
    invert_colors: bool = True


class MockScreen:
    def __init__(self, width: int = 320, height: int = 240) -> None:
        self.width = width
        self.height = height
        self.frames: list[Image.Image] = []

    def bounds(self) -> tuple[int, int]:
        return self.width, self.height

    def present(self, image: Image.Image) -> None:
        if image.size != self.bounds():
            raise ValueError(f"frame size {image.size} does not match display size {self.bounds()}")
        self.frames.append(image.copy())

    def close(self) -> None:
        return None


def new_screen(config: Config) -> Screen:
    mode = config.mode.strip().lower() or "auto"
    if mode == "mock":
        return MockScreen(config.width, config.height)
    if mode not in {"auto", "st7789"}:
        raise ValueError(f"unsupported display mode {config.mode!r}")
    if platform.system() != "Linux":
        if mode == "auto":
            return MockScreen(config.width, config.height)
        raise RuntimeError("st7789 display mode is only supported on Linux")
    return ST7789Screen(config)


class ST7789Screen:
    def __init__(self, config: Config) -> None:
        if config.width <= 0 or config.height <= 0:
            raise ValueError("display size must be positive")
        if config.dc_pin < 0:
            raise ValueError("dc pin is required")
        self.width = config.width
        self.height = config.height
        self.offset_x = config.offset_x
        self.offset_y = config.offset_y
        self._spi_fd = os.open(config.spi_device, os.O_RDWR)
        try:
            _configure_spi(self._spi_fd, 0, 8, config.spi_speed_hz)
            self._dc = GpioPin(config.gpiochip, config.dc_pin)
            self._reset = (
                GpioPin(config.gpiochip, config.reset_pin)
                if config.reset_pin >= 0
                else None
            )
            self._init_controller(config)
            self.present(Image.new("RGBA", self.bounds(), (0, 0, 0, 255)))
        except Exception:
            self.close()
            raise

    def bounds(self) -> tuple[int, int]:
        return self.width, self.height

    def present(self, image: Image.Image) -> None:
        if image.size != self.bounds():
            raise ValueError(f"frame size {image.size} does not match display size {self.bounds()}")
        self._set_window(0, 0, self.width - 1, self.height - 1)
        self._write_command(CMD_RAMWR)
        self._write_data(_to_rgb565_be(image))

    def close(self) -> None:
        for item in (getattr(self, "_reset", None), getattr(self, "_dc", None)):
            if item is not None:
                item.close()
        if getattr(self, "_spi_fd", -1) >= 0:
            os.close(self._spi_fd)
            self._spi_fd = -1

    def _init_controller(self, config: Config) -> None:
        if self._reset is not None:
            self._reset.write(False)
            time.sleep(0.020)
            self._reset.write(True)
            time.sleep(0.120)
        self._write_command(CMD_SWRESET)
        time.sleep(0.150)
        self._write_command(CMD_SLPOUT)
        time.sleep(0.120)
        self._write_command_data(CMD_COLMOD, 0x55)
        self._write_command_data(CMD_MADCTL, config.madctl & 0xFF)
        self._write_command(CMD_INVON if config.invert_colors else CMD_INVOFF)
        self._write_command(CMD_NORON)
        time.sleep(0.020)
        self._write_command(CMD_DISPON)
        time.sleep(0.020)

    def _set_window(self, x0: int, y0: int, x1: int, y1: int) -> None:
        x0 += self.offset_x
        x1 += self.offset_x
        y0 += self.offset_y
        y1 += self.offset_y
        self._write_command_data(CMD_CASET, x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF)
        self._write_command_data(CMD_RASET, y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF)

    def _write_command(self, command: int) -> None:
        self._dc.write(False)
        _write_all(self._spi_fd, bytes([command & 0xFF]))

    def _write_data(self, data: bytes) -> None:
        if not data:
            return
        self._dc.write(True)
        for pos in range(0, len(data), SPI_WRITE_CHUNK_SIZE):
            _write_all(self._spi_fd, data[pos : pos + SPI_WRITE_CHUNK_SIZE])

    def _write_command_data(self, command: int, *data: int) -> None:
        self._write_command(command)
        self._write_data(bytes(item & 0xFF for item in data))


def _request_code(direction: int, typ: int, nr: int, size: int) -> int:
    return (
        (direction << SPI_DIR_SHIFT)
        | (typ << SPI_TYPE_SHIFT)
        | (nr << SPI_NR_SHIFT)
        | (size << SPI_SIZE_SHIFT)
    )


def _configure_spi(fd: int, mode: int, bits: int, speed: int) -> None:
    fcntl.ioctl(fd, _request_code(SPI_WRITE, SPI_MAGIC, 1, 1), struct.pack("B", mode))
    fcntl.ioctl(fd, _request_code(SPI_WRITE, SPI_MAGIC, 3, 1), struct.pack("B", bits))
    fcntl.ioctl(fd, _request_code(SPI_WRITE, SPI_MAGIC, 4, 4), struct.pack("<I", speed))


def rgb565(r: int, g: int, b: int) -> int:
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def _to_rgb565_be(image: Image.Image) -> bytes:
    rgb = image if image.mode == "RGB" else image.convert("RGB")
    raw = rgb.tobytes("raw", "RGB")
    pixel_count = len(raw) // 3
    out = bytearray(pixel_count * 2)
    pack = struct.pack_into
    for i in range(pixel_count):
        src = i * 3
        r = raw[src]
        g = raw[src + 1]
        b = raw[src + 2]
        pack(">H", out, i * 2, ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))
    return bytes(out)


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError("display write made no progress")
        view = view[written:]


class GpioPin:
    def __init__(self, chip_path: str, number: int) -> None:
        if number < 0:
            raise ValueError("gpio number must be non-negative")
        chip_fd = os.open(chip_path, os.O_RDONLY)
        try:
            req = _GpioHandleRequest()
            req.line_offsets[0] = number
            req.flags = GPIO_HANDLE_REQUEST_OUTPUT
            req.lines = 1
            req.consumer_label = GPIO_CONSUMER_LABEL
            _ioctl_struct(
                chip_fd,
                _gpio_ioctl_request_code(
                    GPIO_IOCTL_READ | GPIO_IOCTL_WRITE,
                    0xB4,
                    0x03,
                    ctypes.sizeof(_GpioHandleRequest),
                ),
                req,
            )
            self._number = number
            self._fd = int(req.fd)
        finally:
            os.close(chip_fd)

    def write(self, high: bool) -> None:
        data = _GpioHandleData()
        data.values[0] = 1 if high else 0
        _ioctl_struct(
            self._fd,
            _gpio_ioctl_request_code(
                GPIO_IOCTL_READ | GPIO_IOCTL_WRITE,
                0xB4,
                0x09,
                ctypes.sizeof(_GpioHandleData),
            ),
            data,
        )

    def close(self) -> None:
        if getattr(self, "_fd", -1) >= 0:
            os.close(self._fd)
            self._fd = -1


class _GpioHandleRequest(ctypes.Structure):
    _fields_ = [
        ("line_offsets", ctypes.c_uint32 * GPIO_HANDLES_MAX),
        ("flags", ctypes.c_uint32),
        ("default_values", ctypes.c_uint8 * GPIO_HANDLES_MAX),
        ("consumer_label", ctypes.c_char * GPIO_MAX_NAME_SIZE),
        ("lines", ctypes.c_uint32),
        ("fd", ctypes.c_int32),
    ]


class _GpioHandleData(ctypes.Structure):
    _fields_ = [("values", ctypes.c_uint8 * GPIO_HANDLES_MAX)]


def _gpio_ioctl_request_code(direction: int, typ: int, nr: int, size: int) -> int:
    return (
        (direction << GPIO_IOCTL_DIR_SHIFT)
        | (typ << GPIO_IOCTL_TYPE_SHIFT)
        | (nr << GPIO_IOCTL_NR_SHIFT)
        | (size << GPIO_IOCTL_SIZE_SHIFT)
    )


def _ioctl_struct(fd: int, request: int, value: ctypes.Structure) -> None:
    buf = bytearray(bytes(value))
    fcntl.ioctl(fd, request, buf, True)
    ctypes.memmove(ctypes.addressof(value), bytes(buf), len(buf))

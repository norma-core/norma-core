"""Service settings, read from environment variables."""
from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

SPEED_RANGE = (100, 1500)
ACCEL_RANGE = (5, 100)


def clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


@dataclass(frozen=True)
class Settings:
    station_url: str = "ws://localhost:8889/api"
    host: str = "0.0.0.0"
    port: int = 8010
    motion_speed: int = 600
    motion_accel: int = 30
    stale_after_ms: int = 500
    arrival_tolerance_steps: int = 15
    motion_timeout_s: float = 8.0  # per attempt: give up waiting if the arm is still moving after this
    settle_window_s: float = 0.4  # positions unchanged this long = the servos have stopped
    settle_jitter_steps: int = 2
    handoff_timeout_s: float = 2.0  # wait this long for the mirroring stop's torque-off, and for a torque write to read back
    max_nudges: int = 2  # re-command by the residual this many times when servos stop short

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        return cls(
            station_url=env.get("STATION_URL", cls.station_url),
            host=env.get("IK_HOST", cls.host),
            port=int(env.get("IK_PORT", cls.port)),
            motion_speed=int(env.get("MOTION_SPEED", cls.motion_speed)),  # clamped where used
            motion_accel=int(env.get("MOTION_ACCEL", cls.motion_accel)),
            stale_after_ms=int(env.get("STALE_AFTER_MS", cls.stale_after_ms)),
        )

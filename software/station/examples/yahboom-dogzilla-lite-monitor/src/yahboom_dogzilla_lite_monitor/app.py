from __future__ import annotations

import logging
import time
from typing import Any

from yahboom_dogzilla_lite_monitor import render, station_state
from yahboom_dogzilla_lite_monitor.display import Screen

DEFAULT_POLL_INTERVAL = 3.0
DEFAULT_STATION_STATE_STALE_AFTER = 10.0


def run(
    *,
    logger: logging.Logger,
    state_source: station_state.Source | None,
    station_state_path: str,
    screen: Screen,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    station_state_stale_after: float = DEFAULT_STATION_STATE_STALE_AFTER,
    once: bool = False,
) -> None:
    poll_interval = poll_interval if poll_interval > 0 else DEFAULT_POLL_INTERVAL
    station_state_stale_after = (
        station_state_stale_after
        if station_state_stale_after > 0
        else DEFAULT_STATION_STATE_STALE_AFTER
    )

    current_connected = False
    current_station_up = False
    current_battery = station_state.BatteryStatus()
    current_ip_addresses: list[str] = []
    last_state_error = ""
    last_frame_key: tuple[Any, ...] | None = None

    def refresh_state() -> None:
        nonlocal current_connected, current_station_up, current_battery
        nonlocal current_ip_addresses, state_source, last_state_error

        current_connected = False
        current_station_up = False
        current_ip_addresses = []
        if state_source is None and station_state_path:
            try:
                state_source = station_state.Source(station_state_path)
                logger.info("station state source is now available: %s", station_state_path)
            except OSError:
                pass
            except Exception as exc:
                if str(exc) != last_state_error:
                    logger.warning("failed to open station state source: %s", exc)
                    last_state_error = str(exc)
        if state_source is not None:
            try:
                frame = state_source.read_frame()
                if frame.is_stale(station_state_stale_after):
                    current_battery = station_state.BatteryStatus()
                    age = frame.age_seconds()
                    error = (
                        "station shared state is stale"
                        if age is None
                        else f"station shared state is stale: age={age:.1f}s"
                    )
                    if error != last_state_error:
                        logger.warning(error)
                        last_state_error = error
                else:
                    state = station_state.parse_state(frame.payload)
                    current_ip_addresses = state.wlan_ip_addresses()
                    current_connected = bool(current_ip_addresses)
                    current_station_up = True
                    current_battery = state.primary_battery_status()
                    last_state_error = ""
            except station_state.NoSharedStateDataError as exc:
                if str(exc) != last_state_error:
                    logger.warning("station shared state unavailable: %s", exc)
                    last_state_error = str(exc)
                current_battery = station_state.BatteryStatus()
            except OSError as exc:
                if str(exc) != last_state_error:
                    logger.warning("station state source disappeared: %s", exc)
                    last_state_error = str(exc)
                try:
                    state_source.close()
                except Exception:
                    pass
                state_source = None
                current_battery = station_state.BatteryStatus()
            except Exception as exc:
                if str(exc) != last_state_error:
                    logger.warning("failed to fetch station state: %s", exc)
                    last_state_error = str(exc)
                current_battery = station_state.BatteryStatus()
        else:
            current_battery = station_state.BatteryStatus()

    def frame_key() -> tuple[Any, ...]:
        return (
            current_connected,
            current_station_up,
            current_battery.level,
            current_battery.available,
            tuple(current_ip_addresses),
        )

    def present_frame(force: bool = False) -> None:
        nonlocal last_frame_key
        key = frame_key()
        if not force and key == last_frame_key:
            return
        frame = render.draw_status_screen(
            screen.bounds(),
            current_connected,
            current_station_up,
            current_battery.level,
            current_battery.available,
            current_ip_addresses,
        )
        screen.present(frame)
        last_frame_key = key

    refresh_state()
    present_frame(force=True)
    while not once:
        time.sleep(poll_interval)
        refresh_state()
        present_frame()

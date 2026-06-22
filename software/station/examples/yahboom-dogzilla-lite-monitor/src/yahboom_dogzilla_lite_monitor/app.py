from __future__ import annotations

import logging
import time
from typing import Any

from yahboom_dogzilla_lite_monitor import render, station_state, system_state
from yahboom_dogzilla_lite_monitor.display import Screen

DEFAULT_POLL_INTERVAL = 3.0
DEFAULT_DOGZILLA_STATE_STALE_AFTER = 10.0
DEFAULT_SYSTEM_STATE_STALE_AFTER = 10.0


def run(
    *,
    logger: logging.Logger,
    dogzilla_source: station_state.Source | None,
    system_source: system_state.Source | None,
    screen: Screen,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    dogzilla_state_stale_after: float = DEFAULT_DOGZILLA_STATE_STALE_AFTER,
    system_state_stale_after: float = DEFAULT_SYSTEM_STATE_STALE_AFTER,
    once: bool = False,
) -> None:
    poll_interval = poll_interval if poll_interval > 0 else DEFAULT_POLL_INTERVAL
    dogzilla_state_stale_after = (
        dogzilla_state_stale_after
        if dogzilla_state_stale_after > 0
        else DEFAULT_DOGZILLA_STATE_STALE_AFTER
    )
    system_state_stale_after = (
        system_state_stale_after
        if system_state_stale_after > 0
        else DEFAULT_SYSTEM_STATE_STALE_AFTER
    )

    current_connected = False
    current_station_up = False
    current_battery = station_state.BatteryStatus()
    current_ip_addresses: list[str] = []
    last_state_error = ""
    last_system_error = ""
    last_frame_key: tuple[Any, ...] | None = None

    def refresh_state() -> None:
        nonlocal current_connected, current_station_up, current_battery
        nonlocal current_ip_addresses, dogzilla_source, system_source
        nonlocal last_state_error, last_system_error

        current_connected = False
        current_station_up = False
        current_ip_addresses = []
        if dogzilla_source is not None:
            try:
                frame = dogzilla_source.read_frame()
                if frame.is_stale(dogzilla_state_stale_after):
                    current_battery = station_state.BatteryStatus()
                    age = frame.age_seconds()
                    error = (
                        "Dogzilla telemetry is stale"
                        if age is None
                        else f"Dogzilla telemetry is stale: age={age:.1f}s"
                    )
                    if error != last_state_error:
                        logger.warning(error)
                        last_state_error = error
                else:
                    state = station_state.parse_state(frame.payload)
                    current_station_up = True
                    current_battery = state.primary_battery_status()
                    last_state_error = ""
            except station_state.NoDogzillaStateDataError as exc:
                if str(exc) != last_state_error:
                    logger.warning("Dogzilla telemetry unavailable: %s", exc)
                    last_state_error = str(exc)
                current_battery = station_state.BatteryStatus()
            except Exception as exc:
                if str(exc) != last_state_error:
                    logger.warning("failed to fetch Dogzilla state: %s", exc)
                    last_state_error = str(exc)
                current_battery = station_state.BatteryStatus()
        else:
            current_battery = station_state.BatteryStatus()

        if system_source is not None:
            try:
                frame = system_source.read_frame()
                if frame.is_stale(system_state_stale_after):
                    age = frame.age_seconds()
                    error = (
                        "system telemetry is stale"
                        if age is None
                        else f"system telemetry is stale: age={age:.1f}s"
                    )
                    if error != last_system_error:
                        logger.warning(error)
                        last_system_error = error
                else:
                    sys_state = system_state.parse_state(frame.payload)
                    current_ip_addresses = [
                        *sys_state.wlan_ip_addresses(),
                        *sys_state.tailscale_ip_addresses(),
                    ]
                    current_connected = sys_state.has_wlan_ip()
                    last_system_error = ""
            except system_state.NoSystemStateDataError as exc:
                if str(exc) != last_system_error:
                    logger.warning("system telemetry unavailable: %s", exc)
                    last_system_error = str(exc)
            except Exception as exc:
                if str(exc) != last_system_error:
                    logger.warning("failed to fetch system state: %s", exc)
                    last_system_error = str(exc)

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

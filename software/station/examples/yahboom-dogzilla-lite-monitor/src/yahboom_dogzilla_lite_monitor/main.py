from __future__ import annotations

import argparse
import logging

from yahboom_dogzilla_lite_monitor import app, display, platform, station_state, station_system
from yahboom_dogzilla_lite_monitor.network import Service


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Yahboom Dogzilla Lite Raspberry Pi status screen")
    parser.add_argument("--poll-interval", type=float, default=3.0)
    parser.add_argument(
        "--station-state",
        default=station_state.DEFAULT_SHM_PATH,
        help=(
            "path to the Yahboom Dogzilla Lite telemetry shared-memory file "
            "(default: /run/station/yahboom-dogzilla-lite-monitor)"
        ),
    )
    parser.add_argument(
        "--station-state-stale-after",
        type=float,
        default=app.DEFAULT_STATION_STATE_STALE_AFTER,
        help="seconds without fresh station telemetry before showing station offline",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logger = logging.getLogger("yahboom-dogzilla-lite-monitor")

    provider = platform.new_provider()
    service = Service(provider)

    screen = None
    state_source = None
    system_source = None
    try:
        screen = display.new_screen()
        try:
            state_source = station_state.Source(args.station_state)
        except OSError as exc:
            logger.warning(
                "Yahboom Dogzilla Lite telemetry unavailable: path=%s error=%s",
                args.station_state,
                exc,
            )
        except RuntimeError as exc:
            logger.warning(
                "Yahboom Dogzilla Lite telemetry unreadable: path=%s error=%s",
                args.station_state,
                exc,
            )

        system_source = station_system.Source()
        logger.info(
            "starting Yahboom Dogzilla Lite Python display",
            extra={
                "station_state": args.station_state,
            },
        )
        app.run(
            logger=logger,
            service=service,
            state_source=state_source,
            station_state_path=args.station_state,
            system_source=system_source,
            screen=screen,
            poll_interval=args.poll_interval,
            station_state_stale_after=args.station_state_stale_after,
        )
    finally:
        if system_source is not None:
            system_source.close()
        if state_source is not None:
            state_source.close()
        if screen is not None:
            screen.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

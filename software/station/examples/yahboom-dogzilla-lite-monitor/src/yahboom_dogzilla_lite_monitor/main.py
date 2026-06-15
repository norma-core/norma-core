from __future__ import annotations

import argparse
import logging

from yahboom_dogzilla_lite_monitor import app, display, station_state, system_state


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Yahboom Dogzilla Lite Raspberry Pi status screen")
    parser.add_argument("--poll-interval", type=float, default=3.0)
    parser.add_argument(
        "--station-tcp",
        default=system_state.DEFAULT_STATION_TCP,
        help="station NormFS TCP address used to read telemetry queues (default: 127.0.0.1:8888)",
    )
    parser.add_argument(
        "--dogzilla-queue",
        default=station_state.DEFAULT_QUEUE_ID,
        help=(
            "station NormFS queue used for Yahboom Dogzilla Lite telemetry "
            "(default: yahboom-dogzilla-lite/inference)"
        ),
    )
    parser.add_argument(
        "--system-queue",
        default=system_state.DEFAULT_QUEUE_ID,
        help="station NormFS queue used for system telemetry (default: system/rx)",
    )
    parser.add_argument(
        "--dogzilla-state-stale-after",
        type=float,
        default=app.DEFAULT_DOGZILLA_STATE_STALE_AFTER,
        help="seconds without fresh Yahboom Dogzilla Lite telemetry before showing station offline",
    )
    parser.add_argument(
        "--system-state-stale-after",
        type=float,
        default=app.DEFAULT_SYSTEM_STATE_STALE_AFTER,
        help="seconds without fresh system telemetry before showing Wi-Fi disconnected",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logger = logging.getLogger("yahboom-dogzilla-lite-monitor")

    screen = None
    dogzilla_source = None
    system_source = None
    try:
        screen = display.new_screen()
        dogzilla_source = station_state.Source(
            args.station_tcp,
            args.dogzilla_queue,
            logger=logger.getChild("dogzilla"),
        )
        system_source = system_state.Source(
            args.station_tcp,
            args.system_queue,
            logger=logger.getChild("system"),
        )

        logger.info(
            "starting Yahboom Dogzilla Lite Python display",
            extra={
                "station_tcp": args.station_tcp,
                "dogzilla_queue": args.dogzilla_queue,
                "system_queue": args.system_queue,
            },
        )
        app.run(
            logger=logger,
            dogzilla_source=dogzilla_source,
            system_source=system_source,
            screen=screen,
            poll_interval=args.poll_interval,
            dogzilla_state_stale_after=args.dogzilla_state_stale_after,
            system_state_stale_after=args.system_state_stale_after,
        )
    finally:
        if dogzilla_source is not None:
            dogzilla_source.close()
        if system_source is not None:
            system_source.close()
        if screen is not None:
            screen.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

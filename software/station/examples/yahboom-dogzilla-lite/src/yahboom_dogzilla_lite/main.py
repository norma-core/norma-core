from __future__ import annotations

import argparse
import logging

from yahboom_dogzilla_lite import app, display, platform, station_state, station_system
from yahboom_dogzilla_lite.network import Service


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Yahboom Dogzilla Lite Raspberry Pi status screen")
    parser.add_argument("--backend", default="auto", choices=["auto", "nmcli", "mock"])
    parser.add_argument("--poll-interval", type=float, default=3.0)
    parser.add_argument("--display", default="auto", choices=["auto", "st7789", "mock"])
    parser.add_argument("--spi-dev", default="/dev/spidev0.0")
    parser.add_argument("--gpiochip", default="/dev/gpiochip0")
    parser.add_argument("--dc-pin", type=int, default=25)
    parser.add_argument("--reset-pin", type=int, default=27)
    parser.add_argument("--width", type=int, default=320)
    parser.add_argument("--height", type=int, default=240)
    parser.add_argument("--offset-x", type=int, default=0)
    parser.add_argument("--offset-y", type=int, default=0)
    parser.add_argument("--spi-speed-hz", type=int, default=40_000_000)
    parser.add_argument("--madctl", type=lambda value: int(value, 0), default=0x70)
    parser.add_argument("--invert-colors", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument(
        "--station-state",
        default=station_state.DEFAULT_SHM_PATH,
        help=(
            "path to the Yahboom Dogzilla Lite telemetry shared-memory file "
            "(default: /run/station/yahboom-dogzilla-lite)"
        ),
    )
    parser.add_argument(
        "--station-state-stale-after",
        type=float,
        default=app.DEFAULT_STATION_STATE_STALE_AFTER,
        help="seconds without fresh station telemetry before showing station offline",
    )
    parser.add_argument("--once", action="store_true", help="render one frame and exit")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logger = logging.getLogger("yahboom-dogzilla-lite")

    provider, backend_name = platform.new_provider(args.backend)
    service = Service(provider)

    screen = None
    state_source = None
    system_source = None
    try:
        screen = display.new_screen(
            display.Config(
                mode=args.display,
                spi_device=args.spi_dev,
                gpiochip=args.gpiochip,
                dc_pin=args.dc_pin,
                reset_pin=args.reset_pin,
                width=args.width,
                height=args.height,
                offset_x=args.offset_x,
                offset_y=args.offset_y,
                spi_speed_hz=args.spi_speed_hz,
                madctl=args.madctl,
                invert_colors=args.invert_colors,
            )
        )
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
                "backend": backend_name,
                "display": args.display,
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
            once=args.once,
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

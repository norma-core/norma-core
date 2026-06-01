from __future__ import annotations

from enum import IntEnum
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

Font = ImageFont.ImageFont | ImageFont.FreeTypeFont
ASSETS_DIR = Path(__file__).resolve().parent / "assets"

BACKGROUND = (0, 0, 0, 255)
LABEL = (244, 238, 219, 255)
MUTED = (111, 122, 142, 255)
GREEN = (93, 211, 158, 255)
YELLOW = (255, 200, 87, 255)
RED = (255, 93, 115, 255)


class DogMood(IntEnum):
    SMILE = 0
    SLEEP = 1


def draw_status_screen(
    size: tuple[int, int],
    wifi_connected: bool,
    station_up: bool,
    battery_level: int,
    battery_available: bool,
    ip_addresses: list[str] | None = None,
) -> Image.Image:
    image = Image.new("RGBA", size, BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw_face(image, DogMood.SMILE if station_up else DogMood.SLEEP)
    draw_wifi_status_icon(draw, wifi_connected)
    draw_battery_indicator(draw, size, battery_level, battery_available)
    draw_ip_footer(draw, size, ip_addresses or [])
    return image


def draw_face(image: Image.Image, mood: DogMood) -> None:
    face = _face_asset(mood)
    if face is not None:
        x = (image.width - face.width) // 2
        y = (image.height - face.height) // 2
        image.alpha_composite(face, (x, y))
        return

    draw = ImageDraw.Draw(image)
    eye_y = image.height // 2 - 16
    if mood == DogMood.SMILE:
        draw.ellipse((105, eye_y, 135, eye_y + 30), fill=LABEL)
        draw.ellipse((185, eye_y, 215, eye_y + 30), fill=LABEL)
    else:
        draw.line((100, eye_y + 15, 140, eye_y + 15), fill=LABEL, width=6)
        draw.line((180, eye_y + 15, 220, eye_y + 15), fill=LABEL, width=6)


@lru_cache(maxsize=4)
def _face_asset(mood: DogMood) -> Image.Image | None:
    asset_name = "face-awake.png" if mood == DogMood.SMILE else "face-sleep.png"
    asset_path = ASSETS_DIR / asset_name
    if not asset_path.exists():
        return None
    with Image.open(asset_path) as face:
        return face.convert("RGBA")


def draw_wifi_status_icon(draw: ImageDraw.ImageDraw, connected: bool) -> None:
    color = GREEN if connected else RED
    cx, cy = 22, 22
    for radius, width in ((12, 3), (8, 2), (4, 2)):
        draw.arc(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            180,
            360,
            fill=color,
            width=width,
        )
    draw.ellipse((cx - 2, cy - 2, cx + 2, cy + 2), fill=color)


def draw_battery_indicator(
    draw: ImageDraw.ImageDraw, size: tuple[int, int], level: int, available: bool
) -> None:
    width, _ = size
    body_w, body_h, tip_w = 26, 12, 3
    x0 = width - 11 - body_w - tip_w
    y0 = 10
    outline = LABEL if available else MUTED
    text = "--"
    if available:
        text = f"{min(max(level, 0), 100)}%"
    draw.rectangle((x0, y0, x0 + body_w, y0 + body_h), outline=outline)
    draw.rectangle((x0 + body_w, y0 + 3, x0 + body_w + tip_w, y0 + body_h - 3), fill=outline)
    if available:
        fill_w = min(max(level, 0), 100) * (body_w - 4) // 100
        if level > 0 and fill_w == 0:
            fill_w = 1
        if fill_w:
            draw.rectangle(
                (x0 + 2, y0 + 2, x0 + 2 + fill_w, y0 + body_h - 2),
                fill=battery_color(level),
            )
    text_y = _vertically_center_text_y(draw, text, y0 + body_h // 2)
    draw_text_right(draw, (x0 - 6, text_y), text, outline)


def _vertically_center_text_y(draw: ImageDraw.ImageDraw, text: str, target_center: int) -> int:
    font = font_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    return int(target_center - (bbox[1] + bbox[3]) // 2)


def battery_color(level: int) -> tuple[int, int, int, int]:
    if level > 60:
        return GREEN
    if level > 25:
        return YELLOW
    return RED


def draw_ip_footer(
    draw: ImageDraw.ImageDraw, size: tuple[int, int], ip_addresses: list[str]
) -> None:
    width, _ = size
    line = format_ip_footer_line(ip_addresses, max_pixel_width=width - 16)
    if line:
        draw_text_center(draw, (width // 2, size[1] - 22), line, LABEL)


def format_ip_footer_line(
    ip_addresses: list[str],
    max_pixel_width: int | None = None,
    max_footer_chars: int = 44,
) -> str:
    cleaned: list[str] = []
    for addr in ip_addresses:
        addr = addr.strip()
        if addr and addr not in cleaned:
            cleaned.append(addr)
    if not cleaned:
        return ""

    def fits(candidate: str) -> bool:
        if max_pixel_width is not None:
            return _measure_text_width(candidate) <= max_pixel_width
        return len(candidate) <= max_footer_chars

    line = "IP " + " ".join(cleaned)
    if fits(line):
        return line
    visible: list[str] = []
    for index, addr in enumerate(cleaned):
        candidate_items = [*visible, addr]
        candidate = "IP " + " ".join(candidate_items)
        remaining = len(cleaned) - index - 1
        if remaining:
            candidate += f" +{remaining}"
        if not fits(candidate):
            break
        visible.append(addr)
    if not visible:
        return f"IP +{len(cleaned)}"
    line = "IP " + " ".join(visible)
    remaining = len(cleaned) - len(visible)
    if remaining:
        line += f" +{remaining}"
    return line


def _measure_text_width(text: str) -> int:
    font = font_default()
    bbox = font.getbbox(text)
    return int(bbox[2] - bbox[0])


def draw_text_center(
    draw: ImageDraw.ImageDraw,
    point: tuple[int, int],
    text: str,
    fill: tuple[int, int, int, int],
    font: Font | None = None,
) -> None:
    font = font or font_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text(
        (point[0] - (bbox[2] - bbox[0]) // 2 - bbox[0], point[1]),
        text,
        fill=fill,
        font=font,
    )


def draw_text_right(
    draw: ImageDraw.ImageDraw,
    point: tuple[int, int],
    text: str,
    fill: tuple[int, int, int, int],
    font: Font | None = None,
) -> None:
    font = font or font_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text(
        (point[0] - (bbox[2] - bbox[0]) - bbox[0], point[1]),
        text,
        fill=fill,
        font=font,
    )


_FONT_REGULAR_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)

DEFAULT_FONT_SIZE = 14


@lru_cache(maxsize=8)
def load_font(size: int = DEFAULT_FONT_SIZE) -> Font:
    for path in _FONT_REGULAR_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def font_default() -> Font:
    return load_font(DEFAULT_FONT_SIZE)

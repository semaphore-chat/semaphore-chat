#!/usr/bin/env python3
"""Generate the slice rig's image fixtures: a portrait, a panorama and a tiny picture.

Plain stdlib PNG writing (no downloads, no third-party content). Run from anywhere:

    python3 native/rigs/slice/fixtures/generate_media_fixtures.py

The two large pictures exceed 480 px on their long side, so a backend that measures images
gives them thumbnails; the tiny one is drawn at its own size and has none.
"""

import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent


def chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def write_png(name: str, width: int, height: int, pixel) -> None:
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # filter: none
        for x in range(width):
            rows.extend(pixel(x, y))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )
    (HERE / name).write_bytes(png)
    print(f"{name}: {width}x{height}, {len(png)} bytes")


def portrait(width: int, height: int) -> None:
    """A sky gradient with a sun and a horizon: a phone-photo shape."""

    def pixel(x: int, y: int):
        sky = (40 + y * 120 // height, 90 + y * 90 // height, 200 - y * 40 // height)
        dx, dy = x - width // 2, y - height // 4
        if dx * dx + dy * dy < (width // 4) ** 2:
            return (255, 224, 120)
        if y > height * 3 // 4:
            return (40, 100, 60)
        return sky

    write_png("portrait.png", width, height, pixel)


def panorama(width: int, height: int) -> None:
    """A wide landscape: sky gradient, hills, and a lake band."""

    def pixel(x: int, y: int):
        if y > height * 2 // 3:
            return (30, 70, 110)
        if y > height // 2:
            return (55, 110, 70)
        return (120 + x * 60 // width, 150 + y * 40 // height, 220)

    write_png("panorama.png", width, height, pixel)


def tiny(width: int, height: int) -> None:
    """Four quadrants: small enough that the list draws it at its exact size."""

    def pixel(x: int, y: int):
        left, top = x < width // 2, y < height // 2
        if left and top:
            return (230, 90, 90)
        if not left and top:
            return (90, 200, 120)
        if left:
            return (90, 130, 235)
        return (240, 200, 80)

    write_png("tiny.png", width, height, pixel)


if __name__ == "__main__":
    portrait(600, 1200)
    panorama(1600, 300)
    tiny(64, 64)

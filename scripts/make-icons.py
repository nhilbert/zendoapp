#!/usr/bin/env python3
"""Draws the app icons in public/ (dark theme: sage ring on the dark paper colour).

No dependencies: anti-aliased circles computed per pixel, written as PNG with zlib.
Run from the repository root:  python3 scripts/make-icons.py
Then raise ?v= on the icons in public/manifest.webmanifest: installed apps keep their icon
until the browser sees a changed icon address in the manifest.
"""
import struct
import zlib

PAPER = (0x17, 0x17, 0x16)  # --paper (dark)
SAGE = (0x8D, 0xB4, 0x9F)  # --accent (dark)

# Geometry as a share of the icon size; the mark keeps a safe margin for masked (rounded) icons.
RING_RADIUS = 0.30
RING_WIDTH = 0.066
DOT_RADIUS = 0.084

SIZES = {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}


def coverage(signed_distance: float) -> float:
    """Pixel coverage from the distance of its centre to the shape edge (negative = inside)."""
    return min(1.0, max(0.0, 0.5 - signed_distance))


def draw(size: int) -> bytes:
    c = size / 2
    ring_mid, ring_half, dot = RING_RADIUS * size, RING_WIDTH * size / 2, DOT_RADIUS * size
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter type: none
        for x in range(size):
            d = ((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2) ** 0.5
            a = max(coverage(abs(d - ring_mid) - ring_half), coverage(d - dot))
            row += bytes(round(p + (s - p) * a) for p, s in zip(PAPER, SAGE))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


if __name__ == "__main__":
    for name, size in SIZES.items():
        with open(f"public/{name}", "wb") as f:
            f.write(draw(size))
        print(f"public/{name} {size}×{size}")

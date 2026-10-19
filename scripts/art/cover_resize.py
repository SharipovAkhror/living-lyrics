"""Resize public/covers/<slug>/source.jpg to 96, 192, 512 and 1024.

Center-crops to a square, then downscales with Lanczos. Quality 88, 4:4:4.
The master must already be at least 1024 px on the short side: this does not upscale.
"""
import sys
from pathlib import Path

from PIL import Image

SIZES = (96, 192, 512, 1024)
QUALITY = 88


def main(slug: str) -> None:
    root = Path(__file__).resolve().parents[2]
    src = root / "public" / "covers" / slug / "source.jpg"
    image = Image.open(src)
    image.load()
    if image.mode != "RGB":
        image = image.convert("RGB")
    width, height = image.size
    side = min(width, height)
    if side < 1024:
        raise SystemExit(f"{slug}: source is {width}x{height}, need at least 1024 on the short side")
    left = (width - side) // 2
    top = (height - side) // 2
    square = image.crop((left, top, left + side, top + side))
    for size in SIZES:
        resized = square.resize((size, size), Image.Resampling.LANCZOS)
        dest = src.parent / f"{size}.jpg"
        resized.save(dest, format="JPEG", quality=QUALITY, subsampling=0, optimize=True)
        print(f"{slug}/{size}.jpg  {dest.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: cover_resize.py <slug>")
    main(sys.argv[1])

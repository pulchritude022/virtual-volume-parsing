#!/usr/bin/env python3
"""
Emit reading-optimised crops for one page image, for in-session transcription.

Crops off the burned-in copyright caption strip, then writes three JPEGs: the
full two-page spread, and contrast-enhanced + upscaled crops of the LEFT and
RIGHT pages (the enhancement makes faded/stained text far more legible). Prints
the three repo-relative paths, one per line — the /transcribe-batch skill Reads
those files.

Usage:
    python scripts/preprocess.py --volume CH2-341-1 --image 3
"""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def emit(volume: str, n: int, out_dir: Path) -> list[Path]:
    from PIL import Image, ImageEnhance, ImageOps

    src = REPO / "data" / volume / "images" / f"img_{n:04d}.jpg"
    if not src.exists():
        sys.exit(f"No image at {src} — download it first (fetch_images.py).")

    im = Image.open(src).convert("RGB")
    W, H = im.size
    top = int(H * 0.06)      # drop the copyright caption strip along the top
    mid = int(W * 0.49)

    def save(img: Image.Image, max_long: int, suffix: str) -> Path:
        long_edge = max(img.size)
        if long_edge > max_long:
            s = max_long / long_edge
            img = img.resize((int(img.width * s), int(img.height * s)))
        dest = out_dir / f"img_{n:04d}_{suffix}.jpg"
        img.save(dest, format="JPEG", quality=90)
        return dest

    def enhance(crop: Image.Image) -> Image.Image:
        g = ImageOps.autocontrast(ImageOps.grayscale(crop), cutoff=1)
        g = ImageEnhance.Contrast(g).enhance(1.5)
        return g.resize((int(g.width * 1.6), int(g.height * 1.6))).convert("RGB")

    out_dir.mkdir(parents=True, exist_ok=True)
    return [
        save(im.crop((0, top, W, H)), 2200, "full"),
        save(enhance(im.crop((0, top, mid, H))), 2500, "left"),
        save(enhance(im.crop((mid, top, W, H))), 2500, "right"),
    ]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--volume", default="CH2-341-1")
    ap.add_argument("--image", type=int, required=True)
    ap.add_argument("--out", default=None, help="output dir (default data/<vol>/.crops)")
    args = ap.parse_args()

    out_dir = Path(args.out) if args.out else REPO / "data" / args.volume / ".crops"
    for p in emit(args.volume, args.image, out_dir):
        print(p.relative_to(REPO).as_posix())


if __name__ == "__main__":
    main()

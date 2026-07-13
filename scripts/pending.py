#!/usr/bin/env python3
"""
List the next downloaded-but-not-yet-transcribed page image numbers.

Compares the successfully-downloaded images in the manifest against the
transcription .md files already written, and prints the next N image numbers to
work on (ascending). The /transcribe-batch skill uses this to pick each batch.

Usage:
    python scripts/pending.py --volume CH2-341-1 --count 10
    python scripts/pending.py --volume CH2-341-1 --summary
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--volume", default="CH2-341-1")
    ap.add_argument("--count", type=int, default=10)
    ap.add_argument("--summary", action="store_true", help="print counts, not the list")
    args = ap.parse_args()

    vol_dir = REPO / "data" / args.volume
    idir = vol_dir / "images"
    if not idir.exists():
        sys.exit(f"No images dir at {idir} — run fetch_images.py first.")

    # "Downloaded" = the jpg is actually on disk (manifest status may be
    # "ok" or "skipped"; both mean the file exists).
    downloaded = sorted(int(p.stem.split("_")[1]) for p in idir.glob("img_*.jpg"))
    manifest_path = vol_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    tdir = vol_dir / "transcriptions"
    done = {int(p.stem.split("_")[1]) for p in tdir.glob("img_*.md")} if tdir.exists() else set()
    pending = [n for n in downloaded if n not in done]

    if args.summary:
        total = manifest.get("total_images", "?")
        print(f"volume {args.volume}: total~{total}  downloaded={len(downloaded)}  "
              f"transcribed={len(done)}  pending={len(pending)}")
        if pending:
            print(f"next: {pending[:args.count]}")
        return

    print(" ".join(str(n) for n in pending[:args.count]))


if __name__ == "__main__":
    main()

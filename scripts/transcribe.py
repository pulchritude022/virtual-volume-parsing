#!/usr/bin/env python3
"""
Stage 1 — transcribe downloaded page images with Claude Opus vision.

For each image, sends (a) the full two-page spread and (b) contrast-enhanced,
upscaled crops of the left and right pages to Claude, primed by the palaeography
reference guide, and writes a markdown transcription following the output
contract in reference/scottish-secretary-hand.md.

Cost note: this calls the Anthropic API once per image (Claude Opus 4.8 vision,
adaptive thinking). 254 pages is real money — default to a small --end for
calibration, review the output, then run the whole volume.

Usage:
    pip install anthropic Pillow
    # credentials: ANTHROPIC_API_KEY env var, or `ant auth login`
    python scripts/transcribe.py --volume CH2-341-1 --start 2 --end 6      # calibrate
    python scripts/transcribe.py --volume CH2-341-1                        # whole volume
    python scripts/transcribe.py --volume CH2-341-1 --start 3 --end 8 --force
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MODEL = "claude-opus-4-8"
MAX_TOKENS = 16000

SYSTEM_INSTRUCTIONS = """\
You are an expert palaeographer transcribing 17th-century Scottish church-court
records (Scots and Latin, Secretary Hand). You are given, for one manuscript
opening, three images: (1) the full two-page spread, and (2)+(3) contrast-enhanced,
enlarged crops of the LEFT and RIGHT pages to help you read faded or damaged text.
The reading guide below is authoritative — apply it rigorously.

Produce a single Markdown document, and OUTPUT ONLY THAT DOCUMENT (no preamble,
no code fences around the whole thing). Follow this exact structure:

---
image_number: <N>
volume: <VOL>
folios: [<left>, <right>]        # the folio/page numbers written on the pages, if visible
year: <YYYY or ?>
sitting_date: <YYYY-MM-DD or ?>
languages: [scots, latin]
transcriber: claude-opus-4-8
confidence: {left: high|medium|low, right: high|medium|low}
status: draft-needs-review
people: [<names as written>]
places: [<places as written>]
dates: [<dates mentioned>]
---

# <VOL> — Image <N> (folios <left>–<right>)

## Folio <left> (left page)  *(confidence: ...)*
### Diplomatic transcription
```
<faithful reading: keep original spelling; expand contractions with added
letters in [square brackets]; mark uncertain words with [?]; illegible stretches
as [illeg.] or [...]; note line breaks with / and mark marginalia/damage>
```
### Modern English
<clear modern rendering>

## Folio <right> (right page)  *(confidence: ...)*
### Diplomatic transcription
```
<as above>
```
### Modern English
<...>

## Notes & context
- <Latin/Scots glosses, historical/biographical context, damage, and a bulleted
  list of your lowest-confidence readings for the human reviewer to check>

Rules: never invent text to fill a gap — mark what you cannot read. Read `y`+
superscript as th- (the/that/this), not "ye/yat". Resolve c/t and e/d by context.
Preserve proper nouns exactly as written, then normalise in the modern layer.
Each image is a TWO-PAGE opening — transcribe both pages separately.

=== READING GUIDE ===
"""


def load_reference() -> str:
    return (REPO / "reference" / "scottish-secretary-hand.md").read_text(encoding="utf-8")


def preprocess(image_path: Path) -> list[tuple[str, bytes]]:
    """Return [(label, jpeg_bytes)] for full spread + enhanced left/right pages."""
    from PIL import Image, ImageEnhance, ImageOps

    im = Image.open(image_path).convert("RGB")
    W, H = im.size
    top = int(H * 0.06)          # crop the burned-in copyright caption strip
    mid = int(W * 0.49)

    def enc(img: Image.Image, max_long: int) -> bytes:
        long_edge = max(img.size)
        if long_edge > max_long:
            scale = max_long / long_edge
            img = img.resize((int(img.width * scale), int(img.height * scale)))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue()

    def enhance(crop: Image.Image, upscale: float) -> Image.Image:
        g = ImageOps.autocontrast(ImageOps.grayscale(crop), cutoff=1)
        g = ImageEnhance.Contrast(g).enhance(1.5)
        if upscale != 1.0:
            g = g.resize((int(g.width * upscale), int(g.height * upscale)))
        return g.convert("RGB")

    full = im.crop((0, top, W, H))
    left = enhance(im.crop((0, top, mid, H)), 1.6)
    right = enhance(im.crop((mid, top, W, H)), 1.6)
    return [
        ("full spread", enc(full, 2200)),
        ("LEFT page (enhanced)", enc(left, 2500)),
        ("RIGHT page (enhanced)", enc(right, 2500)),
    ]


def transcribe_one(client, volume: str, n: int, image_path: Path, system_blocks) -> str:
    images = preprocess(image_path)
    content = []
    for label, data in images:
        content.append({"type": "text", "text": f"Image: {label}"})
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg",
                       "data": base64.standard_b64encode(data).decode()},
        })
    content.append({"type": "text", "text": (
        f"Transcribe this opening. It is image_number {n} of volume {volume}. "
        "Output only the Markdown document per the contract.")})

    with client.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        system=system_blocks,
        messages=[{"role": "user", "content": content}],
    ) as stream:
        msg = stream.get_final_message()

    return "".join(b.text for b in msg.content if b.type == "text").strip()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--volume", default="CH2-341-1")
    ap.add_argument("--start", type=int, default=2)
    ap.add_argument("--end", type=int, default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--sleep", type=float, default=1.0)
    args = ap.parse_args()

    try:
        import anthropic
    except ImportError:
        sys.exit("Install deps first:  pip install anthropic Pillow")

    vol_dir = REPO / "data" / args.volume
    manifest_path = vol_dir / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"No manifest at {manifest_path}. Run fetch_images.py first.")
    manifest = json.loads(manifest_path.read_text())
    out_dir = vol_dir / "transcriptions"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Reference guide is stable across all calls → cache it to cut cost.
    system_blocks = [
        {"type": "text", "text": SYSTEM_INSTRUCTIONS + load_reference(),
         "cache_control": {"type": "ephemeral"}},
    ]

    client = anthropic.Anthropic()
    end = args.end or manifest.get("total_images", 257)
    ok = skipped = errors = 0
    for n in range(args.start, end + 1):
        rec = manifest.get("images", {}).get(str(n))
        if not rec or rec.get("status") != "ok":
            continue
        img_path = REPO / rec["path"]
        out_path = out_dir / f"img_{n:04d}.md"
        if out_path.exists() and not args.force:
            skipped += 1
            print(f"  [{n:>3}] skip (exists)")
            continue
        try:
            md = transcribe_one(client, args.volume, n, img_path, system_blocks)
            out_path.write_text(md + "\n", encoding="utf-8")
            ok += 1
            print(f"  [{n:>3}] ok    -> {out_path.relative_to(REPO)}  ({len(md)} chars)")
        except Exception as e:  # noqa: BLE001 - report and continue
            errors += 1
            print(f"  [{n:>3}] ERROR {type(e).__name__}: {e}")
        time.sleep(args.sleep)

    print(f"\nDone. ok={ok} skipped={skipped} errors={errors}. "
          f"Transcriptions in {out_dir.relative_to(REPO)}")


if __name__ == "__main__":
    main()

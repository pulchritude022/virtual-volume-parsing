#!/usr/bin/env python3
"""Stage 4/5 — build the static GitHub Pages site from transcription markdown.

Walks ``data/<volume>/transcriptions/*.md`` (front-matter + a fixed section
contract) plus ``data/<volume>/manifest.json`` and ``config/volumes.yaml`` and
emits JSON the static viewer in ``docs/`` consumes:

    docs/data/volumes.json                     list of volumes + summary counts
    docs/data/<volume>/index.json              page list + volume metadata
    docs/data/<volume>/pages/img_NNNN.json     one structured page (folios, notes)

The site is data-driven and dependency-free at runtime: the browser fetches
these JSON files and renders a side-by-side image / transcription / translation
viewer plus the emerging "wiki" (people, places, topics indexes).

Images are Crown-copyright and .gitignored, so they are NEVER embedded here.
By default the public build references them by relative path (they simply 404 on
the hosted site and the viewer shows a "view on ScotlandsPeople" placeholder).
Pass ``--with-images`` to copy the local images into ``docs/`` for private,
local-only review; those copies stay untracked (``*.jpg`` is gitignored).

Usage:
    python scripts/build_site.py                      # all volumes, no images
    python scripts/build_site.py --volume CH2-341-1   # one volume
    python scripts/build_site.py --with-images        # local review build
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import Counter
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "volumes.yaml"
DATA = ROOT / "data"
DOCS = ROOT / "docs"
SITE_DATA = DOCS / "data"


# --------------------------------------------------------------------------- #
# Markdown transcription parsing
# --------------------------------------------------------------------------- #

FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
CONFIDENCE_RE = re.compile(r"\*\(confidence:\s*([^)]*?)\)\*", re.IGNORECASE)
FENCE_RE = re.compile(r"```[^\n]*\n(.*?)```", re.DOTALL)


def split_front_matter(text: str) -> tuple[dict, str]:
    """Return (front_matter_dict, body). Tolerates a missing block."""
    m = FRONT_MATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        fm = {}
    return fm, text[m.end():]


def _sections(body: str, level: int) -> list[tuple[str, str]]:
    """Split ``body`` on headings of exactly ``level`` hashes.

    Returns [(heading_text, section_body), ...]; text before the first heading
    is returned under the empty-string heading so nothing is dropped.
    """
    hashes = "#" * level
    pat = re.compile(rf"^{hashes}\s+(.*)$", re.MULTILINE)
    out: list[tuple[str, str]] = []
    matches = list(pat.finditer(body))
    if not matches:
        return [("", body)]
    if matches[0].start() > 0:
        out.append(("", body[: matches[0].start()]))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        out.append((m.group(1).strip(), body[m.end():end]))
    return out


def _first_fence(text: str) -> str:
    m = FENCE_RE.search(text)
    return m.group(1).rstrip("\n") if m else ""


def _strip_confidence(heading: str) -> tuple[str, str | None]:
    conf = None
    m = CONFIDENCE_RE.search(heading)
    if m:
        conf = m.group(1).strip()
    cleaned = CONFIDENCE_RE.sub("", heading).strip().rstrip("—-").strip()
    return cleaned, conf


def parse_folio(heading: str, section: str) -> dict:
    """Parse one ``## Folio …`` section into diplomatic / modern / intro parts."""
    label, confidence = _strip_confidence(heading)
    diplomatic = ""
    modern = ""
    intro = ""
    notes = ""
    for sub_head, sub_body in _sections(section, 3):
        key = sub_head.lower()
        if sub_head == "":
            intro = sub_body.strip()
        elif "diplomatic" in key:
            diplomatic = _first_fence(sub_body)
        elif "modern english" in key or "translation" in key:
            modern = sub_body.strip()
        elif key.startswith("notes"):
            # Some pages nest "### Notes & context" inside the last folio
            # rather than as a top-level "## Notes" section.
            notes = sub_body.strip()
    return {
        "label": label,
        "confidence": confidence,
        "intro": intro,
        "diplomatic": diplomatic,
        "modern": modern,
        "notes": notes,
    }


def parse_transcription(md_path: Path) -> dict:
    text = md_path.read_text(encoding="utf-8")
    fm, body = split_front_matter(text)

    title = ""
    folios: list[dict] = []
    notes_parts: list[str] = []
    for heading, section in _sections(body, 2):
        if heading == "":
            # Leading block: the "# CH2/341/1 — Image N …" H1 title lives here.
            m = re.search(r"^#\s+(.*)$", section, re.MULTILINE)
            if m:
                title = m.group(1).strip()
        elif heading.lower().startswith("folio"):
            folio = parse_folio(heading, section)
            # A folio-nested "### Notes" is lifted to the page-level notes block.
            folio_notes = folio.pop("notes", "")
            if folio_notes:
                notes_parts.append(folio_notes)
            folios.append(folio)
        elif heading.lower().startswith("notes"):
            notes_parts.append(section.strip())

    notes = "\n\n".join(p for p in notes_parts if p)
    # Drop editorial HTML comments (e.g. the Stage-2 REVIEW LOG placeholder).
    notes = re.sub(r"<!--.*?-->", "", notes, flags=re.DOTALL).strip()
    return {"front_matter": fm, "title": title, "folios": folios, "notes": notes}


# --------------------------------------------------------------------------- #
# Volume assembly
# --------------------------------------------------------------------------- #

def load_volumes_config() -> list[dict]:
    cfg = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    return cfg.get("volumes", [])


def load_manifest(volume_id: str) -> dict:
    path = DATA / volume_id / "manifest.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def image_slug_to_number(slug: str) -> int | None:
    m = re.search(r"(\d+)", slug)
    return int(m.group(1)) if m else None


def build_volume(vol_cfg: dict, with_images: bool) -> dict | None:
    volume_id = vol_cfg["id"]
    tdir = DATA / volume_id / "transcriptions"
    if not tdir.exists():
        print(f"  x {volume_id}: no transcriptions/ dir — skipping")
        return None

    manifest = load_manifest(volume_id)
    manifest_images = manifest.get("images", {})

    out_dir = SITE_DATA / volume_id
    pages_dir = out_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    people = Counter()
    places = Counter()
    topics = Counter()
    page_index: list[dict] = []

    md_files = sorted(tdir.glob("*.md"))
    for md_path in md_files:
        slug = md_path.stem  # img_0002
        number = image_slug_to_number(slug)
        parsed = parse_transcription(md_path)
        fm = parsed["front_matter"]

        # Join to manifest for provenance / image availability.
        mrec = manifest_images.get(str(number), {}) if number is not None else {}
        # Prefer the manifest's recorded URL; otherwise synthesize the canonical
        # ScotlandsPeople viewer URL so every page links back to its source.
        source_url = mrec.get("source_url")
        gaz = vol_cfg.get("gaz")
        if not source_url and gaz and number is not None:
            source_url = (
                "https://www.scotlandspeople.gov.uk/virtual-volumes/volume-images/"
                f"volume_data-{volume_id}/{gaz}?image_number={number}"
            )
        local_rel = f"data/{volume_id}/images/{slug}.jpg"
        local_abs = DATA / volume_id / "images" / f"{slug}.jpg"
        image_present = local_abs.exists()

        if with_images and image_present:
            dest = out_dir / "images" / f"{slug}.jpg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(local_abs, dest)
            image_href = f"data/{volume_id}/images/{slug}.jpg"
            image_available = True
        else:
            image_href = None
            image_available = False

        for name in fm.get("people", []) or []:
            people[str(name).strip()] += 1
        for place in fm.get("places", []) or []:
            places[str(place).strip()] += 1
        for topic in fm.get("topics", []) or []:
            topics[str(topic).strip()] += 1

        page = {
            "volume": volume_id,
            "slug": slug,
            "image_number": number,
            "title": parsed["title"] or f"Image {number}",
            "folios_ref": fm.get("folios"),
            "year": fm.get("year"),
            "sitting_date": str(fm.get("sitting_date")) if fm.get("sitting_date") else None,
            "languages": fm.get("languages"),
            "status": fm.get("status"),
            "confidence": fm.get("confidence"),
            "people": fm.get("people") or [],
            "places": fm.get("places") or [],
            "money": fm.get("money") or [],
            "topics": fm.get("topics") or [],
            "transcriber": fm.get("transcriber"),
            "image": {
                "available": image_available,
                "href": image_href,
                "local_path": local_rel,
                "source_url": source_url,
            },
            "folios": parsed["folios"],
            "notes": parsed["notes"],
        }
        (pages_dir / f"{slug}.json").write_text(
            json.dumps(page, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        page_index.append(
            {
                "slug": slug,
                "image_number": number,
                "title": page["title"],
                "year": page["year"],
                "sitting_date": page["sitting_date"],
                "status": page["status"],
                "confidence": page["confidence"],
                "folios_ref": page["folios_ref"],
                "people_count": len(page["people"]),
                "topics": page["topics"],
                "image_available": image_available,
            }
        )

    index = {
        "id": volume_id,
        "title": vol_cfg.get("title"),
        "reference": vol_cfg.get("reference"),
        "court": vol_cfg.get("court"),
        "place": vol_cfg.get("place"),
        "period": vol_cfg.get("period"),
        "languages": vol_cfg.get("languages"),
        "total_images": vol_cfg.get("images"),
        "year_sections": vol_cfg.get("year_sections"),
        "focus_case": vol_cfg.get("focus_case"),
        "transcribed_count": len(page_index),
        "pages": page_index,
        "people": [{"name": n, "count": c} for n, c in people.most_common()],
        "places": [{"name": n, "count": c} for n, c in places.most_common()],
        "topics": [{"name": n, "count": c} for n, c in topics.most_common()],
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"  [ok] {volume_id}: {len(page_index)} page(s), "
        f"{len(people)} people, {len(places)} places"
        + (" [+images]" if with_images else "")
    )
    return {
        "id": volume_id,
        "title": vol_cfg.get("title"),
        "reference": vol_cfg.get("reference"),
        "period": vol_cfg.get("period"),
        "place": vol_cfg.get("place"),
        "total_images": vol_cfg.get("images"),
        "transcribed_count": len(page_index),
        "focus_case": vol_cfg.get("focus_case"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--volume", help="build only this volume id (default: all)")
    ap.add_argument(
        "--with-images",
        action="store_true",
        help="copy local page images into docs/ for private local review "
        "(untracked; never published)",
    )
    args = ap.parse_args()

    SITE_DATA.mkdir(parents=True, exist_ok=True)
    volumes = load_volumes_config()
    if args.volume:
        volumes = [v for v in volumes if v.get("id") == args.volume]
        if not volumes:
            raise SystemExit(f"volume {args.volume!r} not found in {CONFIG}")

    print(f"Building site data -> {SITE_DATA.relative_to(ROOT)}")
    summaries = []
    for vol in volumes:
        summary = build_volume(vol, args.with_images)
        if summary:
            summaries.append(summary)

    (SITE_DATA / "volumes.json").write_text(
        json.dumps({"volumes": summaries}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote volumes.json ({len(summaries)} volume(s)). Done.")


if __name__ == "__main__":
    main()

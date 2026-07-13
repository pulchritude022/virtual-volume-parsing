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
EVENTS_CONFIG = ROOT / "config" / "events.yaml"
ALIASES_CONFIG = ROOT / "config" / "aliases.yaml"
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


def load_events_config() -> list[dict]:
    if not EVENTS_CONFIG.exists():
        return []
    cfg = yaml.safe_load(EVENTS_CONFIG.read_text(encoding="utf-8")) or {}
    return cfg.get("events", [])


def load_aliases_config() -> dict:
    if not ALIASES_CONFIG.exists():
        return {}
    return yaml.safe_load(ALIASES_CONFIG.read_text(encoding="utf-8")) or {}


def compute_page_events(events_cfg: list[dict], image_number: int | None,
                         people: list[str], topics: list[str]) -> list[str]:
    """Deterministically classify a page into 0+ events from config/events.yaml.

    No transcription file is touched: membership is derived purely from the
    image number plus the people/topics already extracted at Stage 1, so
    re-running the build re-classifies every page (past and future) for free.
    """
    if image_number is None:
        return []
    people_l = [p.lower() for p in people]
    topics_l = [t.lower() for t in topics]
    out = []
    for ev in events_cfg:
        rng = ev.get("image_range") or {}
        lo, hi = rng.get("min"), rng.get("max")
        if lo is not None and image_number < lo:
            continue
        if hi is not None and image_number > hi:
            continue
        people_any = [p.lower() for p in ev.get("people_any", [])]
        topics_any = ev.get("topics_any", [])
        matched = False
        if people_any and any(pat in pk for pk in people_l for pat in people_any):
            matched = True
        if not matched and topics_any:
            # Flat list -> OR semantics; list-of-lists -> AND across groups,
            # OR within each group (see config/events.yaml for why).
            groups = topics_any if topics_any and isinstance(topics_any[0], list) else [topics_any]
            matched = all(
                any(pat.lower() in tk for tk in topics_l for pat in group)
                for group in groups
            )
        if matched:
            out.append(ev["name"])
    return out


# --------------------------------------------------------------------------- #
# Stage 3 — entity extraction (people / places consolidated across openings)
# --------------------------------------------------------------------------- #

_BRACKET_RE = re.compile(r"\[[^\]]*\]")           # editorial [expansion] / [?] / [—]
_NONWORD_RE = re.compile(r"[^a-z0-9]+")


def clean_entity(name: str) -> str:
    """Display form: drop any inline '# comment', collapse whitespace."""
    return re.sub(r"\s+", " ", str(name).split("#")[0]).strip()


def entity_key(name: str) -> str:
    """Conservative merge key: lowercase, strip editorial brackets & punctuation.

    Merges spelling-identical variants that differ only in editorial marks
    (e.g. 'Ardwell' vs 'Ardwell [?]') without over-merging distinct names.
    """
    base = _BRACKET_RE.sub(" ", clean_entity(name).lower())
    return re.sub(r"\s+", " ", _NONWORD_RE.sub(" ", base)).strip()


def entity_slug(key: str) -> str:
    return _NONWORD_RE.sub("-", key).strip("-") or "unknown"


ENTITY_KINDS = ("person", "place", "event")
RELATED_FIELD = {"person": "related_people", "place": "related_places", "event": "related_events"}


class EntityAccumulator:
    """Collects mentions + co-occurrences for one kind (person/place/event).

    Co-occurrence is tracked generically across all ENTITY_KINDS plus a
    free-text `topics` bucket, so adding a new kind (e.g. "event") needs no
    change here — related_person / related_place / related_event fall out
    of the same mechanism that already produced related_people/related_places.
    """

    def __init__(self, kind: str, alias_map: dict | None = None):
        self.kind = kind
        self.alias_map = alias_map or {}
        self.by_key: dict[str, dict] = {}

    def note(self, raw_name: str, page_ref: dict, co: dict[str, list[str]] | None = None) -> str | None:
        """Record one mention. `co` maps other kind -> list of names on the same page."""
        key = entity_key(raw_name)
        if not key:
            return None
        key = self.alias_map.get(key, key)
        rec = self.by_key.setdefault(
            key,
            {"key": key, "display": Counter(), "mentions": {},
             "co": {k: Counter() for k in ENTITY_KINDS}, "topics": Counter()},
        )
        rec["display"][clean_entity(raw_name)] += 1
        rec["mentions"].setdefault(page_ref["slug"], page_ref)
        for other_kind, names in (co or {}).items():
            bucket = rec["co"].setdefault(other_kind, Counter())
            for n in names:
                if other_kind == self.kind and entity_key(n) == key:
                    continue  # don't self-relate
                bucket[n] += 1
        return key

    def note_topics(self, key: str, topics: list[str]) -> None:
        rec = self.by_key.get(key)
        if rec is None:
            return
        for t in topics:
            rec["topics"][t] += 1

    def finalize(self, slug_taken: set[str]) -> list[dict]:
        out = []
        for rec in self.by_key.values():
            name = rec["display"].most_common(1)[0][0]
            slug = entity_slug(rec["key"])
            base, n = slug, 2
            while slug in slug_taken:
                slug, n = f"{base}-{n}", n + 1
            slug_taken.add(slug)
            mentions = sorted(
                rec["mentions"].values(),
                key=lambda m: (m["image_number"] is None, m["image_number"] or 0),
            )
            doc = {
                "kind": self.kind,
                "slug": slug,
                "name": name,
                "variants": [v for v, _ in rec["display"].most_common()],
                "count": len(mentions),
                "mentions": mentions,
                "topics": [dict(name=k, count=c) for k, c in rec["topics"].most_common(24)],
            }
            for k in ENTITY_KINDS:
                doc[RELATED_FIELD[k]] = [dict(name=n, count=c) for n, c in rec["co"].get(k, Counter()).most_common(24)]
            out.append(doc)
        out.sort(key=lambda e: (-e["count"], e["name"].lower()))
        return out


def load_narrative(volume_id: str, kind: str, slug: str) -> str | None:
    """Load an optional Stage-3b LLM-synthesized narrative for one entity.

    data/<volume>/wiki/<kind>/<slug>.md — authored once, reviewable like a
    transcription, and re-attached to the mechanically-extracted entity JSON
    on every build. An optional leading `---`-delimited front-matter block is
    stripped; everything else is passed through as markdown.
    """
    path = DATA / volume_id / "wiki" / kind / f"{slug}.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    m = FRONT_MATTER_RE.match(text)
    return text[m.end():].strip() if m else text.strip()


def build_glossary(volume_id: str) -> dict | None:
    """Parse data/<volume>/glossary.md (## Term headings) into JSON, if present."""
    path = DATA / volume_id / "glossary.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    _, body = split_front_matter(text)
    title = ""
    terms = []
    slug_taken: set[str] = set()
    for heading, section in _sections(body, 2):
        if heading == "":
            m = re.search(r"^#\s+(.*)$", section, re.MULTILINE)
            if m:
                title = m.group(1).strip()
            continue
        slug = entity_slug(entity_key(heading))
        base, n = slug, 2
        while slug in slug_taken:
            slug, n = f"{base}-{n}", n + 1
        slug_taken.add(slug)
        terms.append({"term": heading.strip(), "slug": slug, "definition": section.strip()})
    terms.sort(key=lambda t: t["term"].lower())
    return {"volume": volume_id, "title": title, "terms": terms}


def build_volume(vol_cfg: dict, with_images: bool, events_cfg: list[dict], aliases_cfg: dict) -> dict | None:
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
    events = Counter()
    person_acc = EntityAccumulator("person", aliases_cfg.get("person"))
    place_acc = EntityAccumulator("place", aliases_cfg.get("place"))
    event_acc = EntityAccumulator("event")
    accs = {"person": person_acc, "place": place_acc, "event": event_acc}
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

        page_people = [clean_entity(n) for n in (fm.get("people") or []) if clean_entity(n)]
        page_places = [clean_entity(n) for n in (fm.get("places") or []) if clean_entity(n)]
        page_topics = [clean_entity(n) for n in (fm.get("topics") or []) if clean_entity(n)]
        page_events = compute_page_events(events_cfg, number, page_people, page_topics)
        for name in page_people:
            people[name] += 1
        for place in page_places:
            places[place] += 1
        for topic in page_topics:
            topics[topic] += 1
        for ev in page_events:
            events[ev] += 1

        # Feed entity accumulators with a compact page reference + co-occurrences.
        page_ref = {
            "slug": slug,
            "image_number": number,
            "title": parsed["title"] or f"Image {number}",
            "year": fm.get("year"),
            "sitting_date": str(fm.get("sitting_date")) if fm.get("sitting_date") else None,
            "folios_ref": fm.get("folios"),
        }
        by_kind = {"person": page_people, "place": page_places, "event": page_events}
        for kind, names in by_kind.items():
            acc = accs[kind]
            for name in names:
                key = acc.note(name, page_ref, co=by_kind)
                if key is not None:
                    acc.note_topics(key, page_topics)

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
            "events": page_events,
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

    # ---- Stage 3: finalize & write consolidated entity pages --------------- #
    slug_taken: set[str] = set()
    finalized = {kind: accs[kind].finalize(slug_taken) for kind in ENTITY_KINDS}

    # name(clean) -> {slug, kind} so co-occurrence links can resolve to pages.
    resolve = {}
    for kind in ENTITY_KINDS:
        for e in finalized[kind]:
            for v in e["variants"]:
                resolve.setdefault(entity_key(v), {"slug": e["slug"], "kind": kind})

    def _link(items):
        out = []
        for it in items:
            r = resolve.get(entity_key(it["name"]))
            out.append({**it, "slug": r["slug"] if r else None,
                        "kind": r["kind"] if r else None})
        return out

    ent_dir = out_dir / "entities"
    for kind in ENTITY_KINDS:
        kdir = ent_dir / kind
        kdir.mkdir(parents=True, exist_ok=True)
        for e in finalized[kind]:
            e["narrative"] = load_narrative(volume_id, kind, e["slug"])
            doc = {**e, "volume": volume_id}
            for k in ENTITY_KINDS:
                doc[RELATED_FIELD[k]] = _link(e[RELATED_FIELD[k]])
            (kdir / f"{e['slug']}.json").write_text(
                json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    def _summ(coll):
        return [{"slug": e["slug"], "name": e["name"], "count": e["count"],
                  "has_narrative": e.get("narrative") is not None} for e in coll]

    summaries_by_kind = {kind: _summ(finalized[kind]) for kind in ENTITY_KINDS}
    (ent_dir).mkdir(parents=True, exist_ok=True)
    (ent_dir / "index.json").write_text(
        json.dumps({"volume": volume_id,
                    "people": summaries_by_kind["person"],
                    "places": summaries_by_kind["place"],
                    "events": summaries_by_kind["event"]}, ensure_ascii=False, indent=2),
        encoding="utf-8")

    glossary = build_glossary(volume_id)
    if glossary:
        (out_dir / "glossary.json").write_text(
            json.dumps(glossary, ensure_ascii=False, indent=2), encoding="utf-8")

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
        "people": summaries_by_kind["person"],
        "places": summaries_by_kind["place"],
        "events": summaries_by_kind["event"],
        "topics": [{"name": n, "count": c} for n, c in topics.most_common()],
        "has_glossary": glossary is not None,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"  [ok] {volume_id}: {len(page_index)} page(s), "
        f"{len(people)} people, {len(places)} places, {len(events)} events"
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

    events_cfg = load_events_config()
    aliases_cfg = load_aliases_config()

    print(f"Building site data -> {SITE_DATA.relative_to(ROOT)}")
    summaries = []
    for vol in volumes:
        summary = build_volume(vol, args.with_images, events_cfg, aliases_cfg)
        if summary:
            summaries.append(summary)

    (SITE_DATA / "volumes.json").write_text(
        json.dumps({"volumes": summaries}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote volumes.json ({len(summaries)} volume(s)). Done.")


if __name__ == "__main__":
    main()

# Plan of attack — Scottish church records → transcriptions → private wiki

**Goal.** Turn 257 page-images of the *Stranraer Presbytery minutes, 1641–1652* (ScotlandsPeople
Virtual Volume CH2/341/1) into (1) accurate transcriptions/translations as markdown "raw source
material", (2) a corrected, human-reviewed corpus, and (3) a cross-linked, Wikipedia-style **private**
wiki of the people, places, and events — with the original image shown side-by-side with its
transcription for review. Built for **this volume first, but structured to generalise** to more
volumes and to the ~1796 German-handwriting journal later.

## Decisions locked in (2026-07-12)
- **Acquisition:** automate via Dad's own logged-in session cookie, fetched **slowly**. Browser-drive
  fallback if the cookie approach breaks. *(Validated working — see Status.)*
- **Transcription engine:** **Claude Opus vision**, primed by `reference/scottish-secretary-hand.md`.
- **Hosting:** **fully private** (private repo + local viewer). Not published. This also sidesteps the
  NRS 20-image public-display cap on Crown-copyright images.
- **Scope:** complete CH2/341/1 well; keep code volume-generic.

## Key facts established
- Images are **free to view** when logged in; the credit charge only applies to the site's "save a
  copy" button, which we do not use. No public API exists.
- Each "image" is a **two-page opening** (~500 MS pages across 257 images).
- Image endpoint: `/images/<opaque-token>`; the token is embedded per-page in the viewer HTML and
  requires the `SSESS…` session cookie (anonymous requests get 403).
- Copyright: personal/non-commercial research use (incl. downloading) is permitted; **public
  re-display capped at 20 images** — hence "private".

---

## Stages

### Stage 0 — Acquisition  ✅ mechanism proven
- `scripts/fetch_images.py` — slow, resumable, stdlib-only. Writes `data/<vol>/images/img_NNNN.jpg`
  + `manifest.json` (image #, token, bytes, sha256, provenance).
- **Next:** run the full 1–257 pull (≈40–60 min at 6–12 s/image).

### Stage 1 — Raw transcription
- Per image, Claude Opus vision → `data/<vol>/transcriptions/img_NNNN.md` with a fixed contract:
  - **Diplomatic** transcription (faithful spelling, expansions in `[ ]`, `[?]`/`[illeg.]` marks),
    per page (left `Nr` / right `Nv` since each image = two pages).
  - **Modern English** translation.
  - **Notes**: Latin/Scots glosses, historical/biographical context, damage, uncertainties.
  - **Front-matter**: image #, folio numbers, year, confidence, people/places/dates seen.
- Calibrate on ~5 representative pages first; compare against Dad's 14 Gemini pages; refine the
  prompt + reference guide. Then batch all 257.
- *Open question:* multi-pass / ensemble for hard pages (a second Opus pass or cross-check).

### Stage 2 — Human review & correction loop
- Local static side-by-side viewer (image ⟷ transcription) reading the manifest + .md files.
- Dad flags errors/omissions; corrections captured back into the .md (+ a changelog).
- This is the "go over them together, point out flaws, collect feedback, update" workflow.

### Stage 3 — Structured extraction  ✅ mechanical extraction + events done
- `scripts/build_site.py` extracts people/places (front-matter, per page) into consolidated,
  cross-linked, cited entity records under `docs/data/<vol>/entities/{person,place,event}/`,
  with co-occurrence ("related_*") computed generically across all three kinds.
- **Events/controversies are a first-class kind, computed automatically, never hand-tagged.**
  `config/events.yaml` declares each event (name, image range, matching people/topic keywords);
  `compute_page_events()` classifies every page at build time from data Stage 1 already produced.
  Add an event → rebuild → every past *and future* transcribed page is reclassified for free.
- **Spelling-variant fragmentation fixed via `config/aliases.yaml`** (e.g. "Livingston"/
  "Livingstone", "Barneill"/"Balneil") — a normalised-key → canonical-key map, so real manuscript
  spelling variance no longer splits one person into two entity pages.

### Stage 3b — Narrative synthesis (LLM-authored, human-reviewable)  🟢 pilot done
- `data/<vol>/wiki/{person,place,event}/<slug>.md` — a Wikipedia-style biographical/narrative
  synthesis per entity, written once (by Claude, from the corpus + existing page notes) and
  attached to the mechanically-extracted JSON on every build — same review posture as a
  transcription, not hand-maintained duplicate data.
- Cross-references use a `entity:kind/slug` markdown-link scheme and bare `img_NNN` citation
  tokens; both are resolved to real hrefs client-side (`resolveWikiLinks()` in `app.js`) so
  authoring stays terse (no manual href-building, no zero-padding required).
- **Piloted on ~15-20 major entities** (the 5 configured events + the dozen most-recurring
  people + core parishes) per the "focus first" scope decision (2026-07-13). Minor one-off
  entities still render as a plain evidence index (mentions + co-occurrence, no prose) until a
  narrative is written for them.
- `data/<vol>/glossary.md` — Scots/Latin/ecclesiastical-procedural terms, parsed the same way.

### Stage 4 — Wiki generation  🟢 interactive wiki live
- Dependency-free static site (`docs/index.html`, `docs/viewer.html`, `docs/entity.html`,
  `docs/glossary.html`) renders the side-by-side viewer, an Events/People/Places/Topics home
  index, cross-linked entity pages (narrative + cited evidence trail + related-entity chips),
  and a glossary. No framework, no build tooling — regenerate with `python scripts/build_site.py`.
- **Next:** write narratives for the remaining recurring entities as more images are transcribed;
  consider a timeline view and a map of the Rhins parishes (both can reuse existing page
  `year`/`sitting_date` and place data — no new extraction needed).

### Stage 5 — Hosting
- **Split by copyright, decided 2026-07-12:** the **images** stay private (gitignored, never
  embedded; the site links back to ScotlandsPeople) while the **transcriptions/translations** — the
  project's own work — can be published. The image-free site is therefore GitHub-Pages-safe and
  stays within the NRS 20-image public cap.
- Pages-ready via `docs/` + `.nojekyll`. Publishing is a deliberate opt-in (Settings → Pages →
  Deploy from a branch → `/docs`); until then it runs locally via `http.server`. Revisit showing
  images publicly only if NRS permission is obtained.

---

## Immediate next steps
1. `git init`, first commit of the scaffold (secrets + images gitignored).
2. Run `fetch_images.py --start 1 --end 5` as a live smoke test, then the full pull.
3. Build the Stage-1 transcription prompt + run the ~5-page calibration; review output format with
   Aaron/Dad before batching.

## Open questions to confirm with Dad
- Can he share his 14 already-translated (Gemini) pages? Great as a calibration gold-set.
- Desired depth of "biographical sketches" — strictly evidenced from the records, or also weaving in
  external genealogical/DNA context (McMaster/McCreary/MacDowall, haplogroup R-FTD50311)?
- Priority order: the MacCulloch case (folios 1–14) first, or straight sequential?

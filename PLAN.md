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

### Stage 3 — Structured extraction
- From corrected .md, extract entities → `data/<vol>/entities/` (people, places, events, dates,
  offices, money) with **page citations** and variant spellings; resolve cross-references and
  co-occurrences. Produces the material for Dad's "overview/summary" and "biographical sketches".

### Stage 4 — Wiki generation  🟡 scaffold in place
- **Done:** `scripts/build_site.py` parses the transcription markdown (front-matter + folio
  sections) into JSON under `docs/data/`, and a dependency-free static site (`docs/index.html`,
  `docs/viewer.html`) renders the **side-by-side viewer** (image ⟷ diplomatic ⟷ modern English)
  plus overview/contents and seed People/Places/Topics indexes. No framework, no build tooling —
  regenerate with `python scripts/build_site.py`.
- **Next:** promote the entity indexes into cross-linked pages per person/place/event (fed by
  Stage-3 extraction), add a timeline, relationship graph, and a map of the Rhins parishes.

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

# virtual-volume-parsing

Batch-process historical Scottish church-court records (ScotlandsPeople "Virtual Volumes") into
accurate transcriptions/translations and a cross-linked, **private** wiki of the people, places,
and events they describe — with each original page image shown side-by-side with its transcription
for human review.

First volume: **Stranraer Presbytery, Minutes (1641–1652), CH2/341/1** (257 two-page images).
Motivation: McCollough/MacCulloch family genealogy (Rhins of Galloway).

See **[PLAN.md](PLAN.md)** for the staged roadmap and **[reference/scottish-secretary-hand.md](reference/scottish-secretary-hand.md)**
for the palaeography guide used to prime transcription.

## Layout
```
config/volumes.yaml           volume registry (generic, multi-volume ready)
scripts/fetch_images.py       Stage 0 — slow, resumable image acquisition
scripts/build_site.py         Stage 4 — transcriptions → JSON for the static site
reference/                    palaeography / reading guides
data/<volume>/
  images/                     downloaded page images (gitignored — copyright/large)
  manifest.json               provenance for each image
  transcriptions/             Stage 1 — one markdown file per image
secrets/                      session cookie (gitignored — never commit)
docs/                         Stage 4/5 — static viewer + generated data (GitHub Pages root)
  index.html, viewer.html     overview + side-by-side reviewer
  assets/                     style.css, app.js (no build step, no framework)
  data/                       generated JSON (built from transcriptions)
```

## Quick start
```bash
# 0. (once) install Stage-1 deps; Stage-0 fetch is stdlib-only
pip install -r requirements.txt

# 1. Provide your logged-in ScotlandsPeople session cookie:
cp secrets/cookie.env.example secrets/cookie.env    # then paste your SSESS… cookie

# 2. Smoke-test, then pull the volume (free-to-view images; no credits spent):
python scripts/fetch_images.py --volume CH2-341-1 --start 1 --end 5
python scripts/fetch_images.py --volume CH2-341-1

# 3. Transcribe with Claude Opus (needs ANTHROPIC_API_KEY or `ant auth login`).
#    Calibrate on a few pages first — this bills the Anthropic API per page.
python scripts/transcribe.py --volume CH2-341-1 --start 2 --end 6
python scripts/transcribe.py --volume CH2-341-1        # whole volume

# 4. Build the static viewer/site and preview it locally:
python scripts/build_site.py                 # transcriptions only (public-safe)
python scripts/build_site.py --with-images   # + local images, for private review
python -m http.server 8791 --directory docs  # then open http://127.0.0.1:8791
```

## The viewer / site (`docs/`)
`scripts/build_site.py` turns the transcription markdown + `manifest.json` +
`config/volumes.yaml` into JSON under `docs/data/`, which a dependency-free static
site renders:

- **`docs/index.html`** — overview: volume progress, a year-grouped contents list, and
  browsable People / Places / Topics indexes (the seed of the Stage-4 wiki).
- **`docs/viewer.html`** — the side-by-side reviewer: manuscript image ⟷ diplomatic
  transcription ⟷ modern-English translation, per folio, with notes and page entities.
  Toggle Diplomatic / Modern / Both; `←`/`→` arrows page through the volume.

Re-run `build_site.py` after any transcription changes. It needs `http://` (for `fetch`),
so preview via `http.server` rather than opening the files directly.

**Images stay copyright-safe by construction:** they are `.gitignore`d and never embedded.
The default build references them by relative path (they 404 on a public host, and the
viewer shows a "View on ScotlandsPeople" placeholder). `--with-images` copies them into
`docs/` for *local* review only — those copies remain untracked.

### Hosting on GitHub Pages
The site is Pages-ready (`docs/` + `.nojekyll`). To publish the **transcriptions and
translations** (the project's own work) while keeping the Crown-copyright images private:
build **without** `--with-images`, commit `docs/`, and set Pages → *Deploy from a branch* →
`/docs`. Enabling public Pages is a deliberate step — see **Ethics & copyright** below.

## Ethics & copyright
Images are © National Records of Scotland (Crown copyright), **free to view** when logged in. This
project downloads them for **non-commercial private research only**. NRS permits reuse of at most 20
images in public displays without written permission — so the **images are never published** (they
are `.gitignore`d and the site links back to ScotlandsPeople instead). The **transcriptions and
translations are the project's own work** and may be shared; publishing the image-free site to
GitHub Pages therefore stays within the cap. The fetcher spends no credits and only automates
page-by-page viewing the account is already entitled to; it runs slowly out of courtesy to the server.

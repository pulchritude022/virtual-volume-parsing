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
docs/                         Stage 4/5 — static viewer (GitHub Pages root)
  index.html, viewer.html     overview + side-by-side reviewer
  assets/                     style.css, app.js (no build step, no framework)
  data/                       generated JSON (gitignored; rebuilt by CI on deploy)
.github/workflows/            deploy-pages.yml — build + publish to Pages on push
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

The generated JSON (`docs/data/`) is **not committed** — it is `.gitignore`d and rebuilt by
CI on deploy, so the transcription markdown is the single source of truth. Run `build_site.py`
locally only to preview. It needs `http://` (for `fetch`), so preview via `http.server` rather
than opening the files directly.

**Images stay copyright-safe by construction:** they are `.gitignore`d and never embedded.
The default build references them by relative path (they 404 on a public host, and the
viewer shows an "Open on ScotlandsPeople" link that opens the original in a new tab).
`--with-images` copies them into `docs/` for *local* review only — those copies remain untracked.

### Hosting on GitHub Pages (automated)
Live at **https://pulchritude022.github.io/virtual-volume-parsing/**. Deployment is automated by
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml): on any push to `main`
that touches the transcriptions, config, builder, or front-end, CI runs `build_site.py` and
publishes `docs/` to Pages. **Pages source = _GitHub Actions_** (Settings → Pages).

So the publishing loop for new transcriptions is just:
```bash
git add data/ && git commit -m "Transcribe …" && git push   # CI builds + deploys
```
No manual `build_site.py` run or `docs/` commit is needed to publish. Only the **transcriptions
and translations** (the project's own work) are published; the Crown-copyright images never are.

## Ethics & copyright
Images are © National Records of Scotland (Crown copyright), **free to view** when logged in. This
project downloads them for **non-commercial private research only**. NRS permits reuse of at most 20
images in public displays without written permission — so the **images are never published** (they
are `.gitignore`d and the site links back to ScotlandsPeople instead). The **transcriptions and
translations are the project's own work** and may be shared; publishing the image-free site to
GitHub Pages therefore stays within the cap. The fetcher spends no credits and only automates
page-by-page viewing the account is already entitled to; it runs slowly out of courtesy to the server.

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
reference/                    palaeography / reading guides
data/<volume>/
  images/                     downloaded page images (gitignored — copyright/large)
  manifest.json               provenance for each image
  transcriptions/             Stage 1 — one markdown file per image
secrets/                      session cookie (gitignored — never commit)
docs/                         Stage 4/5 — generated wiki (private)
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
```

## Ethics & copyright
Images are © National Records of Scotland (Crown copyright), **free to view** when logged in. This
project downloads them for **non-commercial private research only**, and keeps everything private.
NRS permits reuse of at most 20 images in public displays without written permission — hence the
wiki is not published. The fetcher spends no credits and only automates page-by-page viewing the
account is already entitled to; it runs slowly out of courtesy to the server.

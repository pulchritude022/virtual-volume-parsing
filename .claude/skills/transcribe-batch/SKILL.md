---
name: transcribe-batch
description: Transcribe a batch of downloaded ScotlandsPeople page images in-session with Claude vision, primed by this repo's palaeography guides. Use whenever the user wants to transcribe the Scottish church-court records in this repo, continue/resume transcription, or "do the next batch of pages". Processes ~10 two-page openings per session, writes one markdown file per image following the project's output contract, and tracks progress so fresh sessions pick up where the last left off. No Anthropic API key needed — this is in-session vision.
---

# Transcribe a batch of page images (in-session)

You are transcribing 17th-century Scottish presbytery minutes (Scots + Latin,
Secretary Hand) from page images already downloaded into this repo. Work in
batches because each image + transcription consumes context; when context gets
tight, stop cleanly and let the user resume in a fresh session.

Default volume: `CH2-341-1`. Default batch size: **10** openings (do fewer if
context is already heavy this session). The user may override: a volume id, a
count, or specific image numbers.

## 1. Prime yourself (once per session)
Read both palaeography guides before transcribing — they are the authority:
- `reference/scottish-secretary-hand.md` (volume-specific working guide: letter
  forms, `y`=thorn, abbreviations, this volume's names/places, the output contract)
- `reference/nrs-secretary-hand-tutorial.md` (NRS tutorial notes)

## 2. Pick the batch
```
python scripts/pending.py --volume CH2-341-1 --summary        # progress overview
python scripts/pending.py --volume CH2-341-1 --count 10       # next N image numbers
```
Use the printed numbers as this batch (unless the user named specific images).

> **Worktree note:** page images live under `data/<volume>/images/` and are
> gitignored (they exist only in the **main checkout**). In a git worktree that
> folder is empty, so `pending.py`/`preprocess.py` fail with "no images dir".
> Fix once per session by junctioning the main checkout's images in (PowerShell,
> no admin needed):
> `New-Item -ItemType Junction -Path data\CH2-341-1\images -Target <main-checkout>\data\CH2-341-1\images`

## 3. For each image number N in the batch
1. Emit reading crops:
   ```
   python scripts/preprocess.py --volume CH2-341-1 --image N
   ```
   It prints three repo-relative paths: `..._full.jpg`, `..._left.jpg`, `..._right.jpg`.
2. **Read all three** crop files (the enhanced left/right crops make faded text legible).
3. Transcribe the opening following the **output contract** below, applying the
   golden rules from the reference guide (never invent text; mark uncertainty
   with `[?]` and illegible stretches with `[illeg.]`; read `y`+superscript as
   *th-*; resolve `c/t` and `e/d` by context; preserve proper nouns as written).
4. Write it to `data/CH2-341-1/transcriptions/img_<NNNN>.md` (zero-padded, e.g.
   `img_0003.md`).

Carry context **across** the batch: keep a running list of recurring people,
places, and hands so spellings stay consistent and you can cross-reference (this
is the advantage of doing it in-session rather than one-image-at-a-time).

## 4. Output contract (write exactly this shape)
```markdown
---
image_number: <N>
volume: CH2-341-1
reference: CH2/341/1
folios: [<left>, <right>]        # folio numbers written on the pages, if visible
year: <YYYY or ?>
sitting_date: <YYYY-MM-DD or ?>
languages: [scots, latin]
transcriber: claude-opus-4-8 (in-session)
confidence: {left: high|medium|low, right: high|medium|low}
status: draft-needs-review
people: [<names as written>]      # drives the site's People index
places: [<places as written>]     # drives the Places index
topics: [<kebab-case themes>]     # drives the Topics index, e.g. usury, witness-deposition
money: [<sums / measures mentioned>]
dates: [<dates mentioned>]        # optional; not indexed by the site builder
---

# CH2/341/1 — Image <N> (folios <left>–<right>)

## Folio <left> (left page)  *(confidence: ...)*
### Diplomatic transcription
```

<faithful reading; original spelling; expansions in [ ]; [?]/[illeg.] marks; line breaks as />

```
### Modern English
<clear modern rendering>

## Folio <right> (right page)  *(confidence: ...)*
### Diplomatic transcription
```

<...>

```
### Modern English
<...>

## Notes & context
- <Latin/Scots glosses, historical/biographical context, damage, and a bulleted
  list of the lowest-confidence readings for the human reviewer to check>

<!-- REVIEW LOG (Stage 2): record the reviewer's corrections below as dated bullets. -->
```
(See `data/CH2-341-1/transcriptions/img_0002.md` for a worked example.)

**Shape rules the site builder depends on.** `scripts/build_site.py` parses these
files into the Stage-4 data-driven viewer under `docs/` (the markdown is the single
source of truth; the generated `docs/data/**.json` is gitignored and rebuilt on
deploy). To stay compatible:
- Keep the order: `# … Image N` H1, then the two `## Folio …` sections, then a
  final `## Notes & context`. Prose placed **between** the H1 and the first
  `## Folio` is **not** shown in the viewer — put any page overview at the top of
  the Notes section instead.
- Put the `*(confidence: …)*` marker **last** on each `## Folio …` heading line. A
  short "— descriptor" may come *before* it, never after (trailing text lands in
  the viewer's folio label).
- Every folio needs a `### Diplomatic transcription` holding one fenced code block
  (the builder reads the first fence as the diplomatic text) and a `### Modern
  English` section.
- `people` / `places` / `topics` drive the wiki indexes — keep spellings
  consistent across the batch so the same entity aggregates instead of splitting.

## 5. Finish the batch
When you've done the batch (or context is getting tight — don't push into
degraded reads), STOP and report:
- how many openings you transcribed this session, with the image numbers;
- a quick note of notable people/places/events found (useful for the eventual wiki);
- run `python scripts/pending.py --volume CH2-341-1 --summary` and tell the user
  the remaining count, and to **start a fresh session and run `/transcribe-batch`
  again** to continue.

Before finishing, **verify the batch feeds the viewer**: run
`python scripts/build_site.py --volume CH2-341-1` and confirm it reports your new
page count with no errors (this is how the openings reach the Stage-4 site; the
`docs/data/` output is gitignored and regenerated on deploy).

Do not commit automatically. Leave the new `.md` files for the user to review
(Stage 2) and commit when ready. The `data/**/.crops/` files are gitignored scratch.

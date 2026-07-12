#!/usr/bin/env python3
"""
Fetch Virtual Volume page images from ScotlandsPeople for a single volume.

These images are FREE TO VIEW on scotlandspeople.gov.uk; this script automates,
slowly, the same page-by-page viewing a logged-in user is entitled to do. It
requires the user's own logged-in session cookie. It does NOT spend credits and
does NOT bypass any paywall — the credit charge only applies to the site's
"save a copy" button, which this does not use.

Usage:
    # put your session cookie in secrets/cookie.env  (see cookie.env.example)
    python scripts/fetch_images.py --volume CH2-341-1 --start 1 --end 257
    python scripts/fetch_images.py --volume CH2-341-1 --start 1 --end 5   # small test
    python scripts/fetch_images.py --volume CH2-341-1 --force             # re-download

Design notes:
  * stdlib only (urllib) — runs on a bare Python 3.8+ install.
  * Resumable: skips images already on disk unless --force.
  * Polite: randomised delay between requests (default 6-12s). Be a good guest.
  * Records a manifest.json with provenance (image number, token, bytes, sha256).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOST = "https://www.scotlandspeople.gov.uk"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# One entry per volume. Add more volumes here; the pipeline is volume-generic.
VOLUMES = {
    "CH2-341-1": {
        "gaz": "GAZ00156",
        "title": "Stranraer Presbytery, Minutes (1641-1652), CH2/341/1",
        "images": 257,
    },
}

IMG_TOKEN_RE = re.compile(r'/images/([A-Za-z0-9=_-]+)')
LOGIN_HINTS = ("/user/login", "Access denied", "Sign in to your account")


def load_cookie() -> str:
    """Read the session cookie from env var SP_COOKIE or secrets/cookie.env."""
    cookie = os.environ.get("SP_COOKIE", "").strip()
    if cookie:
        return cookie
    env = REPO / "secrets" / "cookie.env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("SP_COOKIE="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
            # Also accept a bare `NAME=VALUE` cookie line.
            if line.startswith("SSESS"):
                return line
    sys.exit("No cookie found. Set SP_COOKIE env var or create secrets/cookie.env "
             "(see secrets/cookie.env.example).")


def http_get(url: str, cookie: str, referer: str | None = None
             ) -> tuple[int, bytes, str, str]:
    """Returns (status, body, content_type, final_url). Follows 3xx for GET."""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Cookie": cookie,
        "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8",
        **({"Referer": referer} if referer else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", ""), resp.geturl()
    except urllib.error.HTTPError as e:
        ctype = e.headers.get("Content-Type", "") if e.headers else ""
        return e.code, e.read(), ctype, e.url


def _image_number_of(url: str) -> int | None:
    m = re.search(r"image_number=(\d+)", url)
    return int(m.group(1)) if m else None


def viewer_url(gaz: str, volume: str, n: int) -> str:
    return f"{HOST}/virtual-volumes/volume-images/volume_data-{volume}/{gaz}?image_number={n}"


def fetch_one(volume: str, gaz: str, n: int, cookie: str, out_dir: Path,
              force: bool) -> dict:
    dest = out_dir / f"img_{n:04d}.jpg"
    if dest.exists() and not force:
        return {"image_number": n, "status": "skipped", "path": str(dest.relative_to(REPO)),
                "bytes": dest.stat().st_size}

    page_url = viewer_url(gaz, volume, n)
    status, body, _, final_url = http_get(page_url, cookie)
    html = body.decode("utf-8", "replace")
    if status != 200 or any(h in html for h in LOGIN_HINTS):
        return {"image_number": n, "status": f"page_error_{status}",
                "note": "cookie may be expired/invalid — re-login and update secrets/cookie.env"}

    # Out-of-range / cover slots redirect to a different image_number (e.g. 1 -> 2).
    final_n = _image_number_of(final_url)
    if final_n is not None and final_n != n:
        return {"image_number": n, "status": "redirect", "redirected_to": final_n,
                "note": f"image_number={n} redirects to {final_n}; not a distinct page"}

    tokens = [t for t in IMG_TOKEN_RE.findall(html) if t not in ("watermark",)]
    if not tokens:
        return {"image_number": n, "status": "no_token",
                "note": "no /images/<token> found on page"}
    token = tokens[0]
    img_url = f"{HOST}/images/{token}"

    istatus, ibody, ctype, _ = http_get(img_url, cookie, referer=page_url)
    if istatus != 200 or not ibody[:2] == b"\xff\xd8":  # JPEG magic
        return {"image_number": n, "status": f"img_error_{istatus}",
                "content_type": ctype, "token": token}

    dest.write_bytes(ibody)
    return {
        "image_number": n,
        "status": "ok",
        "path": str(dest.relative_to(REPO)),
        "bytes": len(ibody),
        "sha256": hashlib.sha256(ibody).hexdigest(),
        "content_type": ctype,
        "token": token,
        "source_url": page_url,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--volume", default="CH2-341-1", choices=sorted(VOLUMES))
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--end", type=int, default=None, help="inclusive; defaults to volume size")
    ap.add_argument("--min-delay", type=float, default=6.0)
    ap.add_argument("--max-delay", type=float, default=12.0)
    ap.add_argument("--force", action="store_true", help="re-download existing images")
    args = ap.parse_args()

    vol = VOLUMES[args.volume]
    end = args.end or vol["images"]
    cookie = load_cookie()

    out_dir = REPO / "data" / args.volume / "images"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = REPO / "data" / args.volume / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "volume": args.volume, "gaz": vol["gaz"], "title": vol["title"],
        "total_images": vol["images"], "images": {},
    }

    print(f"Volume {args.volume} — {vol['title']}")
    print(f"Fetching images {args.start}..{end}  (delay {args.min_delay}-{args.max_delay}s)\n")
    ok = skipped = errors = 0
    for n in range(args.start, end + 1):
        rec = fetch_one(args.volume, vol["gaz"], n, cookie, out_dir, args.force)
        manifest["images"][str(n)] = rec
        manifest_path.write_text(json.dumps(manifest, indent=2))
        tag = rec["status"]
        if tag == "ok":
            ok += 1
            print(f"  [{n:>3}/{end}] ok    {rec['bytes']:>7} B  {rec['path']}")
        elif tag == "skipped":
            skipped += 1
            print(f"  [{n:>3}/{end}] skip  (exists)")
        elif tag == "redirect":
            skipped += 1
            print(f"  [{n:>3}/{end}] skip  (redirects to {rec['redirected_to']}, no distinct page)")
        else:
            errors += 1
            print(f"  [{n:>3}/{end}] ERROR {tag}  {rec.get('note', '')}")
            if tag.startswith("page_error") or "cookie" in rec.get("note", ""):
                print("\nStopping: session looks invalid. Update secrets/cookie.env and rerun "
                      "(it will resume where it left off).")
                break
        if n != end and tag != "skipped":
            time.sleep(random.uniform(args.min_delay, args.max_delay))

    print(f"\nDone. ok={ok} skipped={skipped} errors={errors}. Manifest: "
          f"{manifest_path.relative_to(REPO)}")


if __name__ == "__main__":
    main()

"""Set a recipe's cover image from a web URL.

Downloads the image, validates it is a real food-photo-sized image, converts to
JPEG (max 1600px), uploads to storage as cover-web.jpg (upsert), and points
recipes.cover_image_path at it. Original photos in recipe_images are untouched.

Usage: uv run --project ../worker python set_cover.py <recipe_id> <image_url>
Exit 0 with "ok ..." on success; exit 1 with "fail: reason" otherwise.
"""

from __future__ import annotations

import io
import sys

import httpx
from PIL import Image

from import_photos import Supa, load_env

MIN_W, MIN_H, MAX_EDGE = 500, 350, 1600


def main() -> int:
    recipe_id, url = sys.argv[1], sys.argv[2]
    load_env()
    try:
        r = httpx.get(url, timeout=30, follow_redirects=True,
                      headers={"User-Agent": "Mozilla/5.0 (Macintosh) Mealy/1.0"})
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content))
        img.load()
    except Exception as e:
        print(f"fail: download/decode: {e}")
        return 1
    if img.width < MIN_W or img.height < MIN_H:
        print(f"fail: too small ({img.width}x{img.height})")
        return 1
    if img.width > MAX_EDGE or img.height > MAX_EDGE:
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85)

    supa = Supa()
    path = f"{supa.household_id}/{recipe_id}/cover-web.jpg"
    resp = supa.client.post(
        f"{supa.url}/storage/v1/object/recipe-media/{path}",
        headers={**supa.headers, "Content-Type": "image/jpeg", "x-upsert": "true"},
        content=buf.getvalue(),
    )
    resp.raise_for_status()
    supa.client.patch(
        f"{supa.url}/rest/v1/recipes?id=eq.{recipe_id}",
        headers=supa.headers, json={"cover_image_path": path},
    ).raise_for_status()
    print(f"ok {path} ({img.width}x{img.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

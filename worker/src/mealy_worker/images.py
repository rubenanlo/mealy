"""Image candidate validation (spec Part 7) — ported from companion/set_cover.py.

An image qualifies as a cover when it decodes and is at least food-photo
sized; oversized images are downscaled and everything is normalized to JPEG.
"""

from __future__ import annotations

import io

import httpx
from PIL import Image

MIN_W, MIN_H, MAX_EDGE = 500, 350, 1600
_UA = "Mozilla/5.0 (Macintosh) Mealy/1.0"


def validate_image_bytes(data: bytes) -> bytes | None:
    """Normalized JPEG bytes when data is a usable cover image, else None."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        return None
    if img.width < MIN_W or img.height < MIN_H:
        return None
    if img.width > MAX_EDGE or img.height > MAX_EDGE:
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        # Composite onto white so transparent pixels don't leak RGB noise.
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        img = background
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()


async def fetch_validated_image(url: str) -> bytes | None:
    """Download + validate one candidate; None on any failure."""
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=10.0, headers={"User-Agent": _UA}
        ) as client:
            response = await client.get(url)
        if response.status_code >= 400:
            return None
    except Exception:
        return None
    return validate_image_bytes(response.content)


async def pick_cover(urls: list[str], limit: int = 3) -> str | None:
    """First candidate URL (of at most `limit`) that passes validation."""
    for url in urls[:limit]:
        if await fetch_validated_image(url) is not None:
            return url
    return None

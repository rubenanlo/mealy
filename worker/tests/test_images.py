"""Part 7 — image validation. Pillow generates fixtures in-memory."""

import io

from PIL import Image

from mealy_worker.images import validate_image_bytes


def png_bytes(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 120, 40)).save(buf, "PNG")
    return buf.getvalue()


def test_rejects_garbage_and_small_images():
    assert validate_image_bytes(b"not an image") is None
    assert validate_image_bytes(png_bytes(200, 200)) is None  # < 500x350


def test_accepts_and_normalizes_to_jpeg():
    out = validate_image_bytes(png_bytes(800, 600))
    assert out is not None
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"


def test_downscales_oversized_images():
    out = validate_image_bytes(png_bytes(3200, 2400))
    img = Image.open(io.BytesIO(out))
    assert max(img.width, img.height) <= 1600

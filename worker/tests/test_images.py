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


def test_transparent_rgba_composites_onto_white():
    # Fully transparent pixels carry loud green RGB noise that must not leak.
    buf = io.BytesIO()
    Image.new("RGBA", (800, 600), (0, 255, 0, 0)).save(buf, "PNG")
    out = validate_image_bytes(buf.getvalue())
    assert out is not None
    img = Image.open(io.BytesIO(out))
    r, g, b = img.getpixel((400, 300))
    assert min(r, g, b) >= 250  # near-white, not green


def test_transparent_palette_png_composites_onto_white():
    buf = io.BytesIO()
    pal = Image.new("RGBA", (800, 600), (255, 0, 255, 0)).convert(
        "P", palette=Image.ADAPTIVE
    )
    pal.save(buf, "PNG", transparency=0)
    assert pal.mode == "P" and "transparency" in Image.open(buf).info
    out = validate_image_bytes(buf.getvalue())
    assert out is not None
    img = Image.open(io.BytesIO(out))
    r, g, b = img.getpixel((400, 300))
    assert min(r, g, b) >= 250  # near-white, not magenta

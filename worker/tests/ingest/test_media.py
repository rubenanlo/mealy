"""Task 7 — photo & PDF ingestion tests. The LLM is mocked."""

import pytest

from mealy_worker.ingest import media
from mealy_worker.models import CanonicalRecipe, Ingredient

CANNED = CanonicalRecipe(
    title="Tarte aux pommes",
    ingredients=[Ingredient(raw="200 g de farine", name="farine", quantity=200.0, unit="g")],
    steps=["Melanger.", "Cuire."],
    confidence=0.85,
)


def make_pdf(text: str) -> bytes:
    """Build a minimal one-page PDF with a real text layer."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode()
    return bytes(out)


async def test_two_images_make_exactly_one_structure_images_call(monkeypatch):
    calls = []

    async def fake_structure_images(images, media_types, hint=None):
        calls.append({"images": images, "media_types": media_types})
        return CANNED, "texte OCR complet"

    monkeypatch.setattr(media, "structure_images", fake_structure_images)

    result = await media.ingest_images([b"img-a", b"img-b"], ["image/jpeg", "image/png"])

    assert len(calls) == 1, "multi-image = one recipe = one vision call"
    assert calls[0]["images"] == [b"img-a", b"img-b"]
    assert calls[0]["media_types"] == ["image/jpeg", "image/png"]
    assert result.canonical is CANNED
    assert result.needs_review is False
    assert result.verbatim.kind == "photo"
    assert result.verbatim.ocr_text == "texte OCR complet"


async def test_low_confidence_sets_needs_review(monkeypatch):
    shaky = CANNED.model_copy(update={"confidence": 0.45})

    async def fake_structure_images(images, media_types, hint=None):
        return shaky, "ocr"

    monkeypatch.setattr(media, "structure_images", fake_structure_images)

    result = await media.ingest_images([b"img"], ["image/jpeg"])
    assert result.needs_review is True
    assert result.canonical is shaky


async def test_text_layer_pdf_goes_through_structure_text(monkeypatch):
    pdf = make_pdf("Tarte aux pommes: 200 g de farine, 3 pommes. Cuire 40 min.")
    seen = {}

    async def fake_structure_text(verbatim):
        seen["verbatim"] = verbatim
        return CANNED

    monkeypatch.setattr(media, "structure_text", fake_structure_text)

    result = await media.ingest_pdf(pdf)

    assert result.canonical is CANNED
    assert result.verbatim.kind == "pdf"
    assert "200 g de farine" in result.verbatim.ocr_text
    # the prompt verbatim is exactly what is stored
    assert seen["verbatim"].ocr_text == result.verbatim.ocr_text


async def test_scanned_pdf_rasterises_to_images(monkeypatch):
    monkeypatch.setattr(media, "_extract_pdf_text", lambda data: "")
    monkeypatch.setattr(media, "_rasterize", lambda data: [b"page1.png", b"page2.png"])

    calls = []

    async def fake_structure_images(images, media_types, hint=None):
        calls.append({"images": images, "media_types": media_types})
        return CANNED, "OCR scanné"

    monkeypatch.setattr(media, "structure_images", fake_structure_images)

    result = await media.ingest_pdf(b"%PDF-fake-scanned")

    assert len(calls) == 1
    assert calls[0]["images"] == [b"page1.png", b"page2.png"]
    assert result.verbatim.kind == "pdf"
    assert result.verbatim.ocr_text == "OCR scanné"
    assert result.canonical is CANNED


async def test_unreadable_pdf_returns_needs_review(monkeypatch):
    monkeypatch.setattr(media, "_extract_pdf_text", lambda data: "")
    monkeypatch.setattr(media, "_rasterize", lambda data: [])

    result = await media.ingest_pdf(b"not really a pdf")
    assert result.canonical is None
    assert result.needs_review is True
    assert result.verbatim.kind == "pdf"

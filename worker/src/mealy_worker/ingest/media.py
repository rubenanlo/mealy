"""Photo & PDF ingestion (Task 7).

Photos: multiple images = one recipe (spec §3.2) — a single multi-image
vision call does OCR + structuring; the OCR transcription is stored verbatim.

PDFs: text layer via ``pypdf`` fed to the structuring brain; scanned PDFs are
rasterised with ``pypdfium2`` and treated as photos.
"""

from __future__ import annotations

import io

import pypdf
import pypdfium2 as pdfium

from ..models import IngestResult, Verbatim
from ..structure import structure_images, structure_text

MAX_PDF_PAGES = 8
CONFIDENCE_REVIEW_THRESHOLD = 0.6


async def ingest_images(images: list[bytes], media_types: list[str]) -> IngestResult:
    """N photos of one recipe → one vision call → {verbatim OCR, canonical}."""
    canonical, ocr_text = await structure_images(images, media_types)
    return IngestResult(
        verbatim=Verbatim(kind="photo", ocr_text=ocr_text or None),
        canonical=canonical,
        needs_review=canonical.confidence < CONFIDENCE_REVIEW_THRESHOLD,
    )


def _extract_pdf_text(data: bytes) -> str:
    try:
        reader = pypdf.PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception:
        return ""
    return "\n\n".join(p for p in pages if p.strip())


def _rasterize(data: bytes) -> list[bytes]:
    """Render PDF pages to PNG bytes (scanned PDFs → photos)."""
    try:
        doc = pdfium.PdfDocument(data)
    except Exception:
        return []
    pngs: list[bytes] = []
    try:
        for index in range(min(len(doc), MAX_PDF_PAGES)):
            page = doc[index]
            bitmap = page.render(scale=2.0)
            image = bitmap.to_pil()
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            pngs.append(buf.getvalue())
    except Exception:
        pass
    finally:
        doc.close()
    return pngs


async def ingest_pdf(data: bytes) -> IngestResult:
    """PDF → text layer if present, else rasterise pages → vision."""
    text = _extract_pdf_text(data)
    if text.strip():
        verbatim = Verbatim(kind="pdf", ocr_text=text)
        canonical = await structure_text(verbatim)
        return IngestResult(
            verbatim=verbatim,
            canonical=canonical,
            needs_review=canonical.confidence < CONFIDENCE_REVIEW_THRESHOLD,
        )

    pages = _rasterize(data)
    if not pages:
        return IngestResult(
            verbatim=Verbatim(kind="pdf"),
            canonical=None,
            needs_review=True,
        )
    canonical, ocr_text = await structure_images(pages, ["image/png"] * len(pages))
    return IngestResult(
        verbatim=Verbatim(kind="pdf", ocr_text=ocr_text or None),
        canonical=canonical,
        needs_review=canonical.confidence < CONFIDENCE_REVIEW_THRESHOLD,
    )

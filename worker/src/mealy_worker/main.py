"""Mealy worker API (Task 8).

Stateless capture service: every route turns raw material into an
``IngestResult`` ``{verbatim, canonical}``; the app persists both layers
itself. All routes except ``/health`` require a Supabase access token.
"""

from __future__ import annotations

from fastapi import Depends, File, UploadFile
from fastapi import FastAPI
from pydantic import BaseModel

from .auth import verify_token
from .ingest.media import ingest_images, ingest_pdf
from .ingest.social import ingest_social
from .ingest.url import ingest_url
from .models import IngestResult, Verbatim
from .structure import structure_text

app = FastAPI(title="Mealy Worker", version="0.1.0")


class UrlBody(BaseModel):
    url: str


class TextBody(BaseModel):
    text: str


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/ingest/url", response_model=IngestResult)
async def ingest_url_route(body: UrlBody, _claims: dict = Depends(verify_token)) -> IngestResult:
    return await ingest_url(body.url)


@app.post("/ingest/text", response_model=IngestResult)
async def ingest_text_route(body: TextBody, _claims: dict = Depends(verify_token)) -> IngestResult:
    verbatim = Verbatim(kind="paste", pasted=body.text)
    canonical = await structure_text(verbatim)
    return IngestResult(
        verbatim=verbatim,
        canonical=canonical,
        needs_review=canonical.confidence < 0.6,
    )


@app.post("/ingest/social", response_model=IngestResult)
async def ingest_social_route(body: UrlBody, _claims: dict = Depends(verify_token)) -> IngestResult:
    return await ingest_social(body.url)


@app.post("/ingest/images", response_model=IngestResult)
async def ingest_images_route(
    files: list[UploadFile] = File(...), _claims: dict = Depends(verify_token)
) -> IngestResult:
    images = [await f.read() for f in files]
    media_types = [f.content_type or "image/jpeg" for f in files]
    return await ingest_images(images, media_types)


@app.post("/ingest/pdf", response_model=IngestResult)
async def ingest_pdf_route(
    file: UploadFile = File(...), _claims: dict = Depends(verify_token)
) -> IngestResult:
    return await ingest_pdf(await file.read())

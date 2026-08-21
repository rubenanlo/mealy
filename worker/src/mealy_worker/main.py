"""Mealy worker API (Task 8).

Stateless capture service: every route turns raw material into an
``IngestResult`` ``{verbatim, canonical}``; the app persists both layers
itself. All routes except ``/health`` require a Supabase access token.
"""

from __future__ import annotations

from fastapi import Depends, File, HTTPException, UploadFile
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel

from .auth import verify_token
from .fodmap import SwapRequest, SwapResponse, suggest_swaps
from .images import fetch_validated_image
from .ingest.media import ingest_images, ingest_pdf
from .ingest.social import ingest_social
from .ingest.url import ingest_url
from .matching import IngredientMatch, match_ingredients
from .models import CanonicalRecipe, IngestResult, Verbatim
from .structure import structure_text

app = FastAPI(title="Mealy Worker", version="0.1.0")


class UrlBody(BaseModel):
    url: str


class TextBody(BaseModel):
    text: str


class MatchBody(BaseModel):
    lines: list[str]
    candidates: list[str]


class MatchResponse(BaseModel):
    matches: list[IngredientMatch]


class StructureBody(BaseModel):
    verbatim: Verbatim
    force_llm: bool = False


class ImageUrlBody(BaseModel):
    url: str


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


@app.post("/structure", response_model=CanonicalRecipe)
async def structure_route(
    body: StructureBody, _claims: dict = Depends(verify_token)
) -> CanonicalRecipe:
    """Re-run extraction on a stored verbatim (spec Part 6)."""
    return await structure_text(body.verbatim, force_llm=body.force_llm)


@app.post("/match/ingredients", response_model=MatchResponse)
async def match_ingredients_route(
    body: MatchBody, _claims: dict = Depends(verify_token)
) -> MatchResponse:
    """LLM fallback matcher: raw lines → candidate slug or null (Phase 2 §4)."""
    return MatchResponse(matches=await match_ingredients(body.lines, body.candidates))


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


@app.post("/image/fetch")
async def image_fetch_route(
    body: ImageUrlBody, _claims: dict = Depends(verify_token)
) -> Response:
    """Download + validate a web image for the cover-replace flow (Part 4/7)."""
    data = await fetch_validated_image(body.url)
    if data is None:
        raise HTTPException(status_code=422, detail="image failed validation")
    return Response(content=data, media_type="image/jpeg")


@app.post("/fodmap/swaps", response_model=SwapResponse)
async def fodmap_swaps_route(
    body: SwapRequest, _claims: dict = Depends(verify_token)
) -> SwapResponse:
    """Low-FODMAP substitution suggestions (spec Part 8)."""
    return await suggest_swaps(body)

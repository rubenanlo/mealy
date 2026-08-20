"""Canonical recipe / verbatim models (Task 3).

Verbatim rule (spec §3.1): the ``Verbatim`` layer stores captured text
byte-for-byte and is never edited by any code path. ``CanonicalRecipe`` is
derived and re-generatable; every ingredient keeps its original ``raw`` line.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SourceKind = Literal["url", "reel", "photo", "pdf", "paste"]


class Ingredient(BaseModel):
    raw: str
    quantity: float | None = None
    unit: str | None = None
    name: str
    group: str | None = None
    fodmap: str | None = None


class CanonicalRecipe(BaseModel):
    title: str
    language: str = "fr"
    servings: int | None = None
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    dish_type: str | None = None
    tags: list[str] = Field(default_factory=list)
    ingredients: list[Ingredient] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)
    nutrition: dict | None = None
    confidence: float = 0.0


class Verbatim(BaseModel):
    """Immutable capture layer — stored exactly as fetched, never edited."""

    kind: SourceKind
    url: str | None = None
    json_ld: dict | None = None
    page_text: str | None = None
    caption: str | None = None
    transcript: str | None = None
    overlay_text: str | None = None
    ocr_text: str | None = None
    pasted: str | None = None


class IngestResult(BaseModel):
    verbatim: Verbatim
    canonical: CanonicalRecipe | None = None
    needs_review: bool = False
    image_urls: list[str] = Field(default_factory=list)

"""Exact recipe translation into the app's supported languages.

One forced tool-use call produces every target language at once. The prompt
forbids any content change beyond the language itself, and a post-validation
fidelity guard rejects replies whose ingredient or step counts drift. The
verbatim layer is never sent here — only the canonical structured content.
Spec: docs/superpowers/specs/2026-08-25-recipe-translations-design.md.
"""

from __future__ import annotations

from pydantic import BaseModel

from . import structure
from .models import Ingredient
from .structure import MODEL, _tool_input

SUPPORTED_LOCALES = ("en", "es", "fr", "it")

TRANSLATE_SYSTEM = (
    "You translate recipes EXACTLY. Detect the source language, then translate "
    "the title, every ingredient, and every step into each requested target "
    "language. The translation must be faithful and complete: never add, drop, "
    "merge, reorder, or summarize anything; do not convert units or change "
    "quantities; keep numbers, times, and temperatures identical. Translate the "
    "`raw`, `name`, `unit`, and `group` fields of each ingredient; copy "
    "`quantity` and `fodmap` unchanged. Keep exactly the same number of "
    "ingredients and steps, in the same order. Report `source_language` as a "
    "lowercase two-letter code."
)


class TranslateRequest(BaseModel):
    title: str
    language: str | None = None
    ingredients: list[Ingredient]
    steps: list[str]


class TranslatedContent(BaseModel):
    title: str
    ingredients: list[Ingredient]
    steps: list[str]


class TranslateResponse(BaseModel):
    source_language: str
    translations: dict[str, TranslatedContent]


_TRANSLATE_TOOL = {
    "name": "emit_translations",
    "description": "Emit the detected source language and the exact translations.",
    "input_schema": TranslateResponse.model_json_schema(),
}


def _request_text(request: TranslateRequest, targets: list[str]) -> str:
    lines = [
        f"Recipe: {request.title} (stated language: {request.language or 'unknown'})",
        f"Target languages: {', '.join(targets)}",
        "Ingredients:",
    ]
    for ing in request.ingredients:
        lines.append(
            f"- raw: {ing.raw!r} | quantity: {ing.quantity} | unit: {ing.unit!r} "
            f"| name: {ing.name!r} | group: {ing.group!r} | fodmap: {ing.fodmap!r}"
        )
    lines.append("Steps:")
    lines.extend(f"{i + 1}. {step}" for i, step in enumerate(request.steps))
    return "\n".join(lines)


def _normalize(language: str | None) -> str:
    return (language or "")[:2].lower()


async def translate_recipe(request: TranslateRequest) -> TranslateResponse:
    stated = _normalize(request.language)
    targets = [loc for loc in SUPPORTED_LOCALES if loc != stated]
    # Looked up through the module so tests can monkeypatch structure.get_anthropic_client.
    client = structure.get_anthropic_client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=16384,
        system=TRANSLATE_SYSTEM,
        tools=[_TRANSLATE_TOOL],
        tool_choice={"type": "tool", "name": "emit_translations"},
        messages=[
            {"role": "user", "content": [{"type": "text", "text": _request_text(request, targets)}]}
        ],
    )
    result = TranslateResponse.model_validate(_tool_input(response))
    result.source_language = _normalize(result.source_language) or stated or "fr"
    # Never keep a translation for the source language itself.
    result.translations.pop(result.source_language, None)
    # Fidelity guard: identical ingredient and step counts, or the reply is refused.
    for locale, content in result.translations.items():
        if len(content.ingredients) != len(request.ingredients) or len(content.steps) != len(
            request.steps
        ):
            raise ValueError(f"unfaithful translation for {locale}: count mismatch")
    return result

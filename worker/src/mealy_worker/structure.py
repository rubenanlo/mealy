"""The one LLM structuring brain (Task 4).

Every ingestion adapter produces a :class:`Verbatim`; this module turns it into
a :class:`CanonicalRecipe` with a single Anthropic tool-use call — except when
the verbatim layer already carries a complete schema.org Recipe JSON-LD, which
is mapped directly (no LLM, ``confidence=1.0``).

Verbatim rule: the captured text is included in the prompt unmodified and is
never edited here.
"""

from __future__ import annotations

import base64
import re
from functools import lru_cache
from typing import Any

import anthropic

from .models import CanonicalRecipe, Ingredient, Verbatim

MODEL = "claude-haiku-4-5"

SYSTEM_PROMPT = (
    "Extract the recipe. Copy ingredient and step text faithfully from the "
    "source; put the original ingredient line in `raw`. Never invent "
    "ingredients, quantities, or steps. Report `confidence` 0–1."
)

_RECIPE_TOOL = {
    "name": "emit_recipe",
    "description": "Emit the structured recipe extracted from the source material.",
    "input_schema": CanonicalRecipe.model_json_schema(),
}


def _image_tool() -> dict:
    """Recipe tool extended with a verbatim OCR transcription field."""
    schema = CanonicalRecipe.model_json_schema()
    schema["properties"]["ocr_text"] = {
        "type": "string",
        "description": (
            "Complete verbatim transcription of ALL text visible in the "
            "image(s), exactly as written, including headings and notes."
        ),
    }
    schema.setdefault("required", [])
    if "ocr_text" not in schema["required"]:
        schema["required"].append("ocr_text")
    return {
        "name": "emit_recipe",
        "description": (
            "Emit the structured recipe plus a verbatim transcription of all "
            "visible text."
        ),
        "input_schema": schema,
    }


@lru_cache(maxsize=1)
def _cached_client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic()


def get_anthropic_client() -> anthropic.AsyncAnthropic:
    """Indirection point so tests can monkeypatch the client."""
    return _cached_client()


# --- JSON-LD short-circuit ---------------------------------------------------

_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)


def _iso_minutes(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    m = _DURATION_RE.match(value.strip())
    if not m or not any(m.groupdict().values()):
        return None
    days = int(m.group("days") or 0)
    hours = int(m.group("hours") or 0)
    minutes = int(m.group("minutes") or 0)
    seconds = int(m.group("seconds") or 0)
    return days * 24 * 60 + hours * 60 + minutes + (1 if seconds >= 30 else 0)


def _servings(value: Any) -> int | None:
    if isinstance(value, list) and value:
        value = value[0]
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        m = re.search(r"\d+", value)
        if m:
            return int(m.group())
    return None


def _instruction_texts(value: Any) -> list[str]:
    steps: list[str] = []
    if isinstance(value, str):
        steps.append(value)
    elif isinstance(value, list):
        for item in value:
            steps.extend(_instruction_texts(item))
    elif isinstance(value, dict):
        if "itemListElement" in value:
            steps.extend(_instruction_texts(value["itemListElement"]))
        elif isinstance(value.get("text"), str):
            steps.append(value["text"])
    return steps


def _tags(value: Any) -> list[str]:
    if isinstance(value, str):
        return [t.strip() for t in value.split(",") if t.strip()]
    if isinstance(value, list):
        return [str(t).strip() for t in value if str(t).strip()]
    return []


def recipe_from_json_ld(json_ld: dict | None) -> CanonicalRecipe | None:
    """Map a complete schema.org Recipe directly — no LLM, confidence 1.0."""
    if not json_ld:
        return None
    raw_ingredients = json_ld.get("recipeIngredient")
    steps = _instruction_texts(json_ld.get("recipeInstructions"))
    if not raw_ingredients or not steps:
        return None
    nutrition = json_ld.get("nutrition")
    return CanonicalRecipe(
        title=str(json_ld.get("name") or "").strip() or "Recette sans titre",
        language=str(json_ld.get("inLanguage") or "fr")[:5],
        servings=_servings(json_ld.get("recipeYield")),
        prep_minutes=_iso_minutes(json_ld.get("prepTime")),
        cook_minutes=_iso_minutes(json_ld.get("cookTime")),
        dish_type=(
            str(json_ld["recipeCategory"][0])
            if isinstance(json_ld.get("recipeCategory"), list) and json_ld["recipeCategory"]
            else (str(json_ld["recipeCategory"]) if json_ld.get("recipeCategory") else None)
        ),
        tags=_tags(json_ld.get("keywords")),
        ingredients=[
            Ingredient(raw=str(line), name=str(line)) for line in raw_ingredients
        ],
        steps=steps,
        nutrition=nutrition if isinstance(nutrition, dict) else None,
        confidence=1.0,
    )


# --- text bundle -------------------------------------------------------------

_SOURCE_LABELS: list[tuple[str, str]] = [
    ("caption", "Caption"),
    ("transcript", "Audio transcript"),
    ("overlay_text", "On-screen overlay text"),
    ("page_text", "Page text"),
    ("ocr_text", "OCR text"),
    ("pasted", "Pasted text"),
]


def build_text_bundle(verbatim: Verbatim) -> str:
    """Concatenate all captured text streams with source labels, unmodified."""
    parts: list[str] = []
    if verbatim.url:
        parts.append(f"Source URL: {verbatim.url}")
    for field, label in _SOURCE_LABELS:
        value = getattr(verbatim, field)
        if value:
            parts.append(f"--- {label} ---\n{value}")
    return "\n\n".join(parts)


def _tool_input(response: Any) -> dict:
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            return dict(block.input)
    raise ValueError("model response contained no tool_use block")


# --- public API --------------------------------------------------------------


async def structure_text(verbatim: Verbatim, force_llm: bool = False) -> CanonicalRecipe:
    """Turn a verbatim capture into a canonical recipe.

    Complete schema.org JSON-LD is mapped directly without an LLM call —
    unless ``force_llm`` (re-extraction) demands a fresh model pass.
    """
    if not force_llm:
        direct = recipe_from_json_ld(verbatim.json_ld)
        if direct is not None:
            return direct

    bundle = build_text_bundle(verbatim)
    client = get_anthropic_client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[_RECIPE_TOOL],
        tool_choice={"type": "tool", "name": "emit_recipe"},
        messages=[{"role": "user", "content": [{"type": "text", "text": bundle}]}],
    )
    return CanonicalRecipe.model_validate(_tool_input(response))


async def structure_images(
    images: list[bytes], media_types: list[str], hint: str | None = None
) -> tuple[CanonicalRecipe, str]:
    """One multi-image vision call → (canonical recipe, verbatim OCR text)."""
    content: list[dict] = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64.b64encode(data).decode("ascii"),
            },
        }
        for data, media_type in zip(images, media_types, strict=True)
    ]
    instruction = (
        "These images together show ONE recipe. Transcribe every piece of "
        "visible text verbatim into `ocr_text`, then extract the recipe."
    )
    if hint:
        instruction += f"\n\nHint: {hint}"
    content.append({"type": "text", "text": instruction})

    client = get_anthropic_client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=8192,
        system=SYSTEM_PROMPT,
        tools=[_image_tool()],
        tool_choice={"type": "tool", "name": "emit_recipe"},
        messages=[{"role": "user", "content": content}],
    )
    payload = _tool_input(response)
    ocr_text = str(payload.pop("ocr_text", ""))
    return CanonicalRecipe.model_validate(payload), ocr_text

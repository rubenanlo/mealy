"""Low-FODMAP swap suggestions (spec Part 8).

One forced tool-use call proposes substitutions for flagged ingredient lines
and rewrites the affected steps to reference the replacements (user decision).
Only the structured layer is touched; the app decides whether to apply.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from . import structure
from .models import Ingredient
from .structure import MODEL, _tool_input

SWAP_SYSTEM = (
    "You adapt recipes to be low-FODMAP. For each flagged ingredient line, "
    "propose ONE widely available low-FODMAP substitute with a sensible "
    "quantity for the stated servings, in the recipe's language. Rewrite only "
    "the steps that mention a swapped ingredient so they reference the "
    "replacement; copy every other step verbatim. Never drop a step, never "
    "invent new ingredients beyond the replacements, and keep each "
    "replacement's `raw` equal to the original flagged line. When a flagged "
    "line lists preferred substitutes from the household's FODMAP table, pick "
    "one of those unless none fits the dish."
)


class SwapRequest(BaseModel):
    title: str
    language: str = "fr"
    servings: int | None = None
    ingredients: list[Ingredient]
    steps: list[str]
    flagged: list[str] = Field(description="raw ingredient lines flagged high/moderate FODMAP")
    hints: dict[str, list[str]] = Field(
        default_factory=dict,
        description="flagged raw line -> low-FODMAP alternates from Mealy's cited table",
    )


class IngredientSwap(BaseModel):
    raw: str
    replacement: Ingredient
    note: str


class SwapResponse(BaseModel):
    swaps: list[IngredientSwap]
    steps: list[str]


_SWAP_TOOL = {
    "name": "emit_swaps",
    "description": "Emit low-FODMAP substitutions and the rewritten steps.",
    "input_schema": SwapResponse.model_json_schema(),
}


def _request_text(request: SwapRequest) -> str:
    lines = [f"Recipe: {request.title} (language: {request.language}, servings: {request.servings})"]
    lines.append("Ingredients:")
    lines.extend(f"- {ing.raw or ing.name}" for ing in request.ingredients)
    lines.append("Steps:")
    lines.extend(f"{i + 1}. {step}" for i, step in enumerate(request.steps))
    lines.append("Flagged (high/moderate FODMAP) lines to swap:")
    for raw in request.flagged:
        preferred = request.hints.get(raw) or []
        lines.append(f"- {raw}" + (f" (preferred substitutes: {', '.join(preferred)})" if preferred else ""))
    return "\n".join(lines)


async def suggest_swaps(request: SwapRequest) -> SwapResponse:
    # Looked up through the module so tests can monkeypatch structure.get_anthropic_client.
    client = structure.get_anthropic_client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SWAP_SYSTEM,
        tools=[_SWAP_TOOL],
        tool_choice={"type": "tool", "name": "emit_swaps"},
        messages=[{"role": "user", "content": [{"type": "text", "text": _request_text(request)}]}],
    )
    return SwapResponse.model_validate(_tool_input(response))

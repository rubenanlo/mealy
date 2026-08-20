"""LLM fallback ingredient matcher (Phase 2, Task 4).

Maps raw ingredient lines the pure exact/alias matcher missed to canonical
ingredient slugs, in one forced tool-use call. Spec §4 division of labour: the
model only *maps* lines to the provided candidate slugs — it never invents a
classification. Any slug outside the candidate list is discarded server-side
(→ null), and unmatched lines stay null.
"""

from __future__ import annotations

import json
from functools import lru_cache

import anthropic
from pydantic import BaseModel

MODEL = "claude-haiku-4-5"

SYSTEM_PROMPT = (
    "You match raw recipe ingredient lines to canonical ingredient slugs. "
    "For each line, answer with exactly one slug from the provided candidate "
    "list, or null when no candidate clearly refers to the same ingredient. "
    "Never invent a slug and never guess: when unsure, answer null."
)


class IngredientMatch(BaseModel):
    line: str
    slug: str | None = None


class MatchResult(BaseModel):
    matches: list[IngredientMatch]


_MATCH_TOOL = {
    "name": "emit_matches",
    "description": (
        "Emit one match per ingredient line: the candidate slug it refers to, "
        "or null when no candidate matches."
    ),
    "input_schema": MatchResult.model_json_schema(),
}


@lru_cache(maxsize=1)
def _cached_client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic()


def get_anthropic_client() -> anthropic.AsyncAnthropic:
    """Indirection point so tests can monkeypatch the client."""
    return _cached_client()


def _build_prompt(lines: list[str], candidates: list[str]) -> str:
    return (
        "Candidate slugs (the ONLY allowed answers, besides null):\n"
        f"{json.dumps(candidates, ensure_ascii=False)}\n\n"
        "Ingredient lines to match, one per line:\n"
        + "\n".join(lines)
    )


async def match_ingredients(
    lines: list[str], candidates: list[str]
) -> list[IngredientMatch]:
    """Map each raw line to one candidate slug or ``None``.

    One LLM call for the whole batch; empty input (no lines, or no candidates
    to choose from) short-circuits without a call. The model's answers are
    re-validated here: slugs outside ``candidates`` and lines it skipped come
    back as ``None`` — code, not the model, has the final word.
    """
    if not lines:
        return []
    if not candidates:
        return [IngredientMatch(line=line, slug=None) for line in lines]

    client = get_anthropic_client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[_MATCH_TOOL],
        tool_choice={"type": "tool", "name": "emit_matches"},
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _build_prompt(lines, candidates)}
                ],
            }
        ],
    )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            reply = MatchResult.model_validate(dict(block.input))
            break
    else:
        raise ValueError("model response contained no tool_use block")

    allowed = set(candidates)
    by_line: dict[str, str | None] = {}
    for match in reply.matches:
        if match.line not in by_line:  # first answer per line wins
            by_line[match.line] = match.slug if match.slug in allowed else None
    return [IngredientMatch(line=line, slug=by_line.get(line)) for line in lines]

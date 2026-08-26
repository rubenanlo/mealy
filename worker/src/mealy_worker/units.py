"""LLM fallback unit classifier (groceries aggregation).

The app merges shopping-list quantities with a static multilingual unit
table; units it does not recognize ("knob", "sprig", "vasetto", creative
typos) come here. One forced tool-use call classifies the batch into
mass / volume / count with a conversion factor, and the app caches the
answers in unit_conversions so each unit is asked about exactly once.

Division of labour mirrors matching.py: the model proposes, code disposes —
answers outside the allowed kinds or with implausible factors are nulled.
"""

from __future__ import annotations

import json

import anthropic
from pydantic import BaseModel

from .matching import MODEL, get_anthropic_client

SYSTEM_PROMPT = (
    "You classify cooking units of measure for a grocery-list aggregator. "
    "Units may be in English, French, Spanish or Italian, and may contain "
    "typos. For each unit answer with its kind and conversion factor: "
    "kind 'mass' with factor = grams per unit; kind 'volume' with factor = "
    "milliliters per unit; kind 'count' (whole pieces, e.g. cloves, slices, "
    "sprigs, cans) with factor null. Use standard kitchen conventions "
    "(a tablespoon is 15 ml, a teaspoon 5 ml, a cup 240 ml). When a string "
    "is not a unit of measure or you are unsure, answer kind null. Never "
    "guess a factor you are not confident about."
)

# Plausibility bounds — anything outside is discarded (model error).
_MASS_G_RANGE = (0.01, 2000.0)
_VOLUME_ML_RANGE = (0.05, 2000.0)


class UnitConversion(BaseModel):
    unit: str
    kind: str | None = None
    factor: float | None = None


class UnitResult(BaseModel):
    conversions: list[UnitConversion]


_UNITS_TOOL = {
    "name": "emit_units",
    "description": "Emit one classification per unit string.",
    "input_schema": UnitResult.model_json_schema(),
}


def _validated(conversion: UnitConversion) -> UnitConversion:
    """Clamp the model's answer to something code can trust."""
    kind, factor = conversion.kind, conversion.factor
    if kind == "count":
        return UnitConversion(unit=conversion.unit, kind="count", factor=None)
    if kind == "mass" and factor is not None and _MASS_G_RANGE[0] <= factor <= _MASS_G_RANGE[1]:
        return UnitConversion(unit=conversion.unit, kind="mass", factor=factor)
    if (
        kind == "volume"
        and factor is not None
        and _VOLUME_ML_RANGE[0] <= factor <= _VOLUME_ML_RANGE[1]
    ):
        return UnitConversion(unit=conversion.unit, kind="volume", factor=factor)
    return UnitConversion(unit=conversion.unit, kind=None, factor=None)


async def classify_units(units: list[str]) -> list[UnitConversion]:
    """Classify each unit string; unknown/implausible answers come back null."""
    if not units:
        return []
    client = get_anthropic_client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[_UNITS_TOOL],
        tool_choice={"type": "tool", "name": "emit_units"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Units to classify:\n" + json.dumps(units, ensure_ascii=False),
                    }
                ],
            }
        ],
    )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            reply = UnitResult.model_validate(dict(block.input))
            break
    else:
        raise ValueError("model response contained no tool_use block")

    by_unit: dict[str, UnitConversion] = {}
    for conversion in reply.conversions:
        if conversion.unit not in by_unit:  # first answer per unit wins
            by_unit[conversion.unit] = _validated(conversion)
    return [by_unit.get(unit, UnitConversion(unit=unit)) for unit in units]

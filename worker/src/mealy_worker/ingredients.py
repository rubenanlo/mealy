"""Deterministic ingredient-line parsing for the no-LLM ingestion paths.

The JSON-LD short-circuit and the recipe-scrapers fallback map ingredient
lines directly without a model call, so quantities/units must be parsed
here. The original line is always preserved untouched in ``raw``; parsing
only fills ``quantity``/``unit`` and trims them off ``name``. A line that
doesn't start with a number passes through with ``name == raw``.
"""

from __future__ import annotations

import re

from .models import Ingredient

_UNICODE_FRACTIONS = {
    "¼": 0.25,
    "½": 0.5,
    "¾": 0.75,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
    "⅕": 0.2,
    "⅖": 0.4,
    "⅗": 0.6,
    "⅘": 0.8,
    "⅙": 1 / 6,
    "⅚": 5 / 6,
    "⅛": 0.125,
    "⅜": 0.375,
    "⅝": 0.625,
    "⅞": 0.875,
}
_FRACTION_CHARS = "".join(_UNICODE_FRACTIONS)

# Units the mobile app's aggregator recognizes (lib/aggregate.ts) — matched
# tokens are kept verbatim (lowercased), so plural forms stay plural.
# Multi-word units first: the alternation must try the longest match.
_UNIT_WORDS = [
    "cuillères à soupe",
    "cuillère à soupe",
    "cuillères à café",
    "cuillère à café",
    "c. à s.",
    "c. à c.",
    "c. à s",
    "c. à c",
    "fl oz",
    "tablespoons",
    "tablespoon",
    "teaspoons",
    "teaspoon",
    "tbsp",
    "tbs",
    "tsp",
    "cups",
    "cup",
    "ounces",
    "ounce",
    "oz",
    "pounds",
    "pound",
    "lbs",
    "lb",
    "grammes",
    "gramme",
    "grams",
    "gram",
    "gramos",
    "gramo",
    "grammi",
    "grammo",
    "kilos",
    "kilo",
    "kg",
    "gr",
    "g",
    "mg",
    "ml",
    "cl",
    "dl",
    "litres",
    "litre",
    "liters",
    "liter",
    "litros",
    "litro",
    "litri",
    "l",
    "cucharadas",
    "cucharada",
    "cucharaditas",
    "cucharadita",
    "cdta",
    "cda",
    "tazas",
    "taza",
    "cucchiai",
    "cucchiaio",
    "cucchiaini",
    "cucchiaino",
    "tazze",
    "tazza",
    "verres",
    "verre",
    "càs",
    "càc",
    "cas",
    "cac",
]

_NUMBER = rf"""
    (?:
        \d+\s+\d+\s*/\s*\d+        # mixed fraction: 1 1/2
      | \d+\s*[{_FRACTION_CHARS}]  # mixed unicode: 1½ or 1 ½
      | \d+\s*/\s*\d+              # plain fraction: 2/3
      | [{_FRACTION_CHARS}]        # unicode fraction: ⅔
      | \d+(?:[.,]\d+)?            # integer / decimal (1,5 or 1.5)
    )
"""

# Leading quantity, optionally a range ("2-3", "2 to 3", "2 à 3", "2 or 3") —
# ranges keep the first number, matching how cooks read them ("at least").
_QTY_RE = re.compile(
    rf"^\s*(?P<qty>{_NUMBER})(?:\s*(?:[-–—]|to|or|à|a|o)\s*{_NUMBER})?\s*",
    re.IGNORECASE | re.VERBOSE,
)

_UNIT_RE = re.compile(
    r"^(?P<unit>" + "|".join(re.escape(u) for u in _UNIT_WORDS) + r")(?=[\s(]|$)",
    re.IGNORECASE,
)

# Filler between unit and name: "2 cups of flour", "200 g de lardons",
# "1,5 l d'eau" (the apostrophe form binds without a space).
_OF_RE = re.compile(r"^(?:(?:of|de|di|du|des)\s+|d['’]\s*)", re.IGNORECASE)


def _parse_number(token: str) -> float:
    token = token.strip()
    m = re.fullmatch(r"(\d+)\s*([" + _FRACTION_CHARS + r"])", token)
    if m:
        return int(m.group(1)) + _UNICODE_FRACTIONS[m.group(2)]
    if token in _UNICODE_FRACTIONS:
        return _UNICODE_FRACTIONS[token]
    m = re.fullmatch(r"(?:(\d+)\s+)?(\d+)\s*/\s*(\d+)", token)
    if m:
        whole = int(m.group(1) or 0)
        return whole + int(m.group(2)) / int(m.group(3))
    return float(token.replace(",", "."))


def parse_ingredient_line(line: str) -> Ingredient:
    """Split ``"1 pound medium shrimp"`` into quantity/unit/name.

    ``raw`` always carries the untouched line (verbatim rule).
    """
    raw = str(line)
    text = raw.strip()
    qty_match = _QTY_RE.match(text)
    if not qty_match:
        return Ingredient(raw=raw, name=text or raw)
    try:
        quantity = _parse_number(qty_match.group("qty"))
    except ValueError:
        return Ingredient(raw=raw, name=text)
    rest = text[qty_match.end() :]

    unit: str | None = None
    unit_match = _UNIT_RE.match(rest)
    if unit_match:
        unit = unit_match.group("unit").lower()
        rest = rest[unit_match.end() :].lstrip()
        # Alt-measure parenthetical after a unit: "1 pound (450 g) shrimp".
        rest = re.sub(r"^\([^)]*\)\s*", "", rest)
        rest = _OF_RE.sub("", rest)

    name = rest.strip(" \t.,;:")
    if not name:
        # Bare "2" or "½ l" lines keep the raw text as the name.
        return Ingredient(raw=raw, name=text)
    return Ingredient(raw=raw, quantity=round(quantity, 4), unit=unit, name=name)

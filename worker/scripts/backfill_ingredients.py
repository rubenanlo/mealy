"""One-off backfill: parse quantities/units on ingredient lines that were
stored unparsed by the old no-LLM ingestion paths (quantity null, name ==
raw). Applies the same deterministic parser new captures use, to both
`recipes` and `recipe_translations`. `raw` is never modified, so the change
is fully reversible per line.

Run from worker/:
    uv run --env-file .env python scripts/backfill_ingredients.py --dry-run
    uv run --env-file .env python scripts/backfill_ingredients.py
"""

from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, "src")

from mealy_worker.db import SupabaseDb  # noqa: E402
from mealy_worker.ingredients import parse_ingredient_line  # noqa: E402

NUMERIC_START = tuple("0123456789¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞")


def rebuild(lines: list[dict]) -> tuple[list[dict], int]:
    """Re-parse unparsed lines; every other line passes through untouched."""
    out: list[dict] = []
    changed = 0
    for line in lines:
        raw = line.get("raw") or ""
        unparsed = (
            line.get("quantity") is None
            and line.get("name") == raw
            and raw.lstrip().startswith(NUMERIC_START)
        )
        if not unparsed:
            out.append(line)
            continue
        parsed = parse_ingredient_line(raw).model_dump()
        parsed["group"] = line.get("group")
        parsed["fodmap"] = line.get("fodmap")
        if parsed != line:
            changed += 1
        out.append(parsed)
    return out, changed


async def main() -> None:
    dry_run = "--dry-run" in sys.argv
    db = SupabaseDb()

    recipes = await db.select("recipes", {}, columns="id,title,ingredients")
    touched_recipes = 0
    for recipe in recipes:
        rebuilt, changed = rebuild(recipe["ingredients"] or [])
        if changed == 0:
            continue
        touched_recipes += 1
        print(f"recipe {recipe['id']}  {changed:>2} lines  {recipe['title'][:50]}")
        if not dry_run:
            await db.update("recipes", {"id": recipe["id"]}, {"ingredients": rebuilt})

    translations = await db.select(
        "recipe_translations", {}, columns="recipe_id,locale,ingredients"
    )
    touched_translations = 0
    for row in translations:
        rebuilt, changed = rebuild(row["ingredients"] or [])
        if changed == 0:
            continue
        touched_translations += 1
        print(f"translation {row['recipe_id']} [{row['locale']}]  {changed:>2} lines")
        if not dry_run:
            await db.update(
                "recipe_translations",
                {"recipe_id": row["recipe_id"], "locale": row["locale"]},
                {"ingredients": rebuilt},
            )

    mode = "DRY RUN — nothing written" if dry_run else "applied"
    print(f"\n{mode}: {touched_recipes} recipes, {touched_translations} translation rows")


if __name__ == "__main__":
    asyncio.run(main())

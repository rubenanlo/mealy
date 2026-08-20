"""Mealy Mac companion — seed plan history from a shared Photos album of meal plans.

Each photo of a weekly plan is read by the vision model into structured meals
(day + lunch/dinner + title). Meals are matched to library recipes by title
similarity; everything is stored as `events` rows (type 'historical_meal') with
`at` set to the photo's date so Phase 3 seasonality learning gets real dates.
The photo itself is uploaded for provenance. Idempotent via a manifest.

Usage: uv run --project ../worker python import_meal_plans.py --album "Meal plans" [--limit N]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import difflib
import json
import tempfile
import unicodedata
from pathlib import Path

from anthropic import AsyncAnthropic

from import_photos import Supa, album_photos, load_env, local_path, to_jpeg

MANIFEST = Path(__file__).parent / "processed_meal_plans.jsonl"
MODEL = "claude-haiku-4-5"
MATCH_THRESHOLD = 0.75
LLM_CONCURRENCY = 4

PLAN_TOOL = {
    "name": "record_meal_plan",
    "description": "Record the meals visible in a photographed meal plan.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_meal_plan": {"type": "boolean", "description": "false if the photo is not a meal plan"},
            "meals": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "day": {"type": ["string", "null"], "description": "day name as written, if any"},
                        "slot": {"type": "string", "enum": ["lunch", "dinner", "unknown"]},
                        "title": {"type": "string", "description": "the meal exactly as written"},
                    },
                    "required": ["slot", "title"],
                },
            },
        },
        "required": ["is_meal_plan", "meals"],
    },
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c)).strip()


def match_recipe(title: str, recipes: list[dict]) -> str | None:
    n = norm(title)
    best, best_score = None, 0.0
    for r in recipes:
        score = difflib.SequenceMatcher(None, n, norm(r["title"])).ratio()
        if score > best_score:
            best, best_score = r, score
    return best["id"] if best and best_score >= MATCH_THRESHOLD else None


async def extract(client: AsyncAnthropic, image: bytes) -> dict:
    resp = await client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[PLAN_TOOL],
        tool_choice={"type": "tool", "name": "record_meal_plan"},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                             "data": base64.b64encode(image).decode()}},
                {"type": "text", "text": "Read this photographed meal plan. Copy each meal title exactly as written; do not invent meals. If it is not a meal plan, set is_meal_plan=false."},
            ],
        }],
    )
    for block in resp.content:
        if block.type == "tool_use":
            return block.input
    return {"is_meal_plan": False, "meals": []}


def already_done() -> set[str]:
    if not MANIFEST.exists():
        return set()
    return {json.loads(l)["uuid"] for l in MANIFEST.read_text().splitlines() if l.strip()}


async def process_photo(supa: Supa, client: AsyncAnthropic, photo, recipes: list[dict],
                        tmp: str, sem: asyncio.Semaphore) -> str:
    path = local_path(photo)
    if not path:
        return f"[skip {photo.uuid[:8]}] no local file"
    image = to_jpeg(path, tmp)
    async with sem:
        plan = await extract(client, image)
    if not plan.get("is_meal_plan") or not plan.get("meals"):
        with MANIFEST.open("a") as f:
            f.write(json.dumps({"uuid": photo.uuid, "meals": 0, "note": "not a meal plan"}) + "\n")
        return f"[skip {photo.uuid[:8]}] not a meal plan"

    photo_path = f"{supa.household_id}/meal-plans/{photo.uuid}.jpg"
    supa.upload(photo_path, image)

    matched = 0
    for meal in plan["meals"]:
        recipe_id = match_recipe(meal["title"], recipes)
        matched += bool(recipe_id)
        supa.insert("events", {
            "household_id": supa.household_id,
            "recipe_id": recipe_id,
            "type": "historical_meal",
            "at": photo.date.isoformat(),
            "meta": {"raw_title": meal["title"], "day": meal.get("day"),
                     "slot": meal["slot"], "photo_path": photo_path},
        })
    with MANIFEST.open("a") as f:
        f.write(json.dumps({"uuid": photo.uuid, "meals": len(plan["meals"]), "matched": matched}) + "\n")
    return f"[ok {photo.uuid[:8]}] {len(plan['meals'])} meals, {matched} matched ({photo.date.date()})"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--album", default="Meal plans")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    load_env()
    photos = [p for p in album_photos(args.album) if p.uuid not in already_done()]
    if args.limit:
        photos = photos[: args.limit]
    print(f"processing {len(photos)} meal-plan photos")

    supa = Supa()
    r = supa.client.get(f"{supa.url}/rest/v1/recipes?select=id,title", headers=supa.headers)
    r.raise_for_status()
    recipes = r.json()
    print(f"{len(recipes)} recipes in library for matching")

    client = AsyncAnthropic()
    sem = asyncio.Semaphore(LLM_CONCURRENCY)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(0, len(photos), 8):
            results = await asyncio.gather(
                *(process_photo(supa, client, p, recipes, tmp, sem) for p in photos[i:i + 8]),
                return_exceptions=True,
            )
            for p, res in zip(photos[i:i + 8], results):
                print(res if isinstance(res, str) else f"[error {p.uuid[:8]}] {res!r}")


if __name__ == "__main__":
    asyncio.run(main())

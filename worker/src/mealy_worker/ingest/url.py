"""URL ingestion (Task 5).

Order of attack: schema.org Recipe JSON-LD (extruct) mapped directly with no
LLM → ``recipe-scrapers`` on the fetched HTML → readable-text extraction fed
to the structuring brain. Gated or empty pages return
``IngestResult(canonical=None, needs_review=True)`` so the app can offer
"paste the text".

Verbatim rule: ``verbatim.json_ld`` / ``verbatim.page_text`` store exactly
what was fetched/extracted; nothing edits them afterwards.
"""

from __future__ import annotations

import re
from typing import Any

import extruct
import httpx
import lxml.html
from recipe_scrapers import scrape_html

from ..models import CanonicalRecipe, Ingredient, IngestResult, Verbatim
from ..structure import recipe_from_json_ld, structure_text

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


def _find_recipe_json_ld(html: str, url: str) -> dict | None:
    """Extract the first schema.org Recipe node, exactly as published."""
    try:
        data = extruct.extract(html, base_url=url, syntaxes=["json-ld"])
    except Exception:
        return None
    nodes: list[Any] = list(data.get("json-ld") or [])
    # unwrap @graph containers
    for node in list(nodes):
        if isinstance(node, dict) and isinstance(node.get("@graph"), list):
            nodes.extend(node["@graph"])
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_type = node.get("@type")
        types = node_type if isinstance(node_type, list) else [node_type]
        if any(isinstance(t, str) and t.lower() == "recipe" for t in types):
            return node
    return None


def _json_ld_image_urls(json_ld: dict) -> list[str]:
    value = json_ld.get("image")
    urls: list[str] = []
    items = value if isinstance(value, list) else [value]
    for item in items:
        if isinstance(item, str):
            urls.append(item)
        elif isinstance(item, dict) and isinstance(item.get("url"), str):
            urls.append(item["url"])
    return urls


def _readable_text(html: str) -> str:
    """Best-effort readable text: strip scripts/styles, keep visible text."""
    try:
        doc = lxml.html.fromstring(html)
    except Exception:
        return html.strip()
    for el in doc.xpath("//script|//style|//noscript|//nav|//footer|//header"):
        el.drop_tree()
    text = doc.text_content()
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _first(callable_: Any) -> Any:
    try:
        return callable_()
    except Exception:
        return None


def _recipe_from_scraper(html: str, url: str) -> tuple[CanonicalRecipe | None, list[str]]:
    """Map recipe-scrapers output directly (no LLM). Returns (recipe, images)."""
    try:
        scraper = scrape_html(html, org_url=url, supported_only=False)
        raw_ingredients = scraper.ingredients()
        instructions = scraper.instructions()
    except Exception:
        return None, []
    if not raw_ingredients or not instructions:
        return None, []
    steps = [s.strip() for s in instructions.split("\n") if s.strip()]
    yields = _first(scraper.yields)
    servings = None
    if yields:
        m = re.search(r"\d+", str(yields))
        servings = int(m.group()) if m else None
    image = _first(scraper.image)
    language = _first(scraper.language) or "fr"
    recipe = CanonicalRecipe(
        title=_first(scraper.title) or "Recette sans titre",
        language=str(language)[:5],
        servings=servings,
        prep_minutes=_first(scraper.prep_time),
        cook_minutes=_first(scraper.cook_time),
        dish_type=_first(scraper.category),
        tags=[],
        ingredients=[Ingredient(raw=str(l), name=str(l)) for l in raw_ingredients],
        steps=steps,
        nutrition=None,
        confidence=1.0,
    )
    return recipe, ([str(image)] if image else [])


async def ingest_url(url: str) -> IngestResult:
    """Capture a recipe page → {verbatim, canonical}."""
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=20.0,
            headers={"User-Agent": _UA, "Accept-Language": "fr,en;q=0.8"},
        ) as client:
            response = await client.get(url)
    except Exception:
        return IngestResult(
            verbatim=Verbatim(kind="url", url=url),
            canonical=None,
            needs_review=True,
        )

    html = response.text
    if response.status_code >= 400:
        # gated / paywalled / blocked — keep whatever text came back
        return IngestResult(
            verbatim=Verbatim(kind="url", url=url, page_text=_readable_text(html) or None),
            canonical=None,
            needs_review=True,
        )

    # 1) schema.org Recipe JSON-LD → direct mapping, no LLM
    json_ld = _find_recipe_json_ld(html, url)
    if json_ld is not None:
        canonical = recipe_from_json_ld(json_ld)
        if canonical is not None:
            return IngestResult(
                verbatim=Verbatim(kind="url", url=url, json_ld=json_ld),
                canonical=canonical,
                needs_review=False,
                image_urls=_json_ld_image_urls(json_ld),
            )

    # 2) recipe-scrapers on the same HTML (microdata / site-specific), no LLM
    scraped, scraped_images = _recipe_from_scraper(html, url)
    if scraped is not None:
        return IngestResult(
            verbatim=Verbatim(
                kind="url", url=url, json_ld=json_ld, page_text=_readable_text(html) or None
            ),
            canonical=scraped,
            needs_review=False,
            image_urls=scraped_images,
        )

    # 3) readable text → the structuring brain
    page_text = _readable_text(html)
    if not page_text.strip():
        return IngestResult(
            verbatim=Verbatim(kind="url", url=url, json_ld=json_ld),
            canonical=None,
            needs_review=True,
        )
    verbatim = Verbatim(kind="url", url=url, json_ld=json_ld, page_text=page_text)
    canonical = await structure_text(verbatim)
    return IngestResult(
        verbatim=verbatim,
        canonical=canonical,
        needs_review=canonical.confidence < 0.6,
    )

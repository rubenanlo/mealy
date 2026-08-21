"""Task 5 — URL ingestion tests. HTTP is mocked with respx; LLM is mocked."""

import json
from types import SimpleNamespace

import pytest
import respx
from httpx import Response

from mealy_worker import structure
from mealy_worker.ingest import url as url_mod
from mealy_worker.models import CanonicalRecipe, Ingredient

JSON_LD = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "name": "Ratatouille",
    "image": ["https://example.com/rata.jpg"],
    "recipeIngredient": ["2 aubergines", "3 courgettes", "4 tomates"],
    "recipeInstructions": [
        {"@type": "HowToStep", "text": "Couper les légumes."},
        {"@type": "HowToStep", "text": "Mijoter 40 min."},
    ],
    "recipeYield": "4",
    "prepTime": "PT20M",
    "cookTime": "PT40M",
    "inLanguage": "fr",
}

HTML_WITH_JSON_LD = f"""<html><head>
<script type="application/ld+json">{json.dumps(JSON_LD, ensure_ascii=False)}</script>
</head><body><h1>Ratatouille</h1></body></html>"""

HTML_PLAIN = """<html><head><title>Blog</title></head><body>
<article><h1>Ma soupe</h1>
<p>Il vous faut 2 carottes et 1 oignon. Faites cuire 20 minutes.</p></article>
</body></html>"""


class NoCallAnthropicClient:
    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        raise AssertionError("Anthropic client must not be called")


async def _no_network_pick_cover(urls, limit=3):  # pragma: no cover - trivial fake
    """Stand-in for images.pick_cover: no live HTTP calls in these tests."""
    return None


@respx.mock
async def test_json_ld_page_maps_without_llm(monkeypatch):
    no_llm = NoCallAnthropicClient()
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: no_llm)
    monkeypatch.setattr(url_mod, "pick_cover", _no_network_pick_cover)
    respx.get("https://example.com/rata").mock(
        return_value=Response(200, text=HTML_WITH_JSON_LD)
    )

    result = await url_mod.ingest_url("https://example.com/rata")

    assert no_llm.calls == []
    assert result.canonical is not None
    assert result.canonical.title == "Ratatouille"
    assert result.canonical.confidence == 1.0
    assert result.needs_review is False
    assert result.verbatim.kind == "url"
    assert result.verbatim.url == "https://example.com/rata"
    # verbatim keeps the JSON-LD exactly as published
    assert result.verbatim.json_ld["recipeIngredient"] == JSON_LD["recipeIngredient"]
    assert "https://example.com/rata.jpg" in result.image_urls


@respx.mock
async def test_unstructured_page_falls_through_to_structure_text(monkeypatch):
    canned = CanonicalRecipe(
        title="Ma soupe",
        ingredients=[Ingredient(raw="2 carottes", name="carotte")],
        steps=["Faites cuire 20 minutes."],
        confidence=0.7,
    )
    seen = {}

    async def fake_structure_text(verbatim):
        seen["verbatim"] = verbatim
        return canned

    monkeypatch.setattr(url_mod, "structure_text", fake_structure_text)
    monkeypatch.setattr(url_mod, "pick_cover", _no_network_pick_cover)
    respx.get("https://example.com/blog").mock(return_value=Response(200, text=HTML_PLAIN))

    result = await url_mod.ingest_url("https://example.com/blog")

    assert result.canonical is canned
    assert result.needs_review is False
    assert seen["verbatim"].kind == "url"
    assert seen["verbatim"].json_ld is None
    assert "2 carottes" in seen["verbatim"].page_text
    assert result.verbatim.page_text == seen["verbatim"].page_text


@respx.mock
async def test_gated_page_returns_needs_review(monkeypatch):
    async def boom(verbatim):  # pragma: no cover - must not run
        raise AssertionError("structure_text must not be called for gated pages")

    monkeypatch.setattr(url_mod, "structure_text", boom)
    respx.get("https://cooking.nytimes.com/r/1").mock(
        return_value=Response(403, text="<html><body>Subscribe to continue</body></html>")
    )

    result = await url_mod.ingest_url("https://cooking.nytimes.com/r/1")

    assert result.canonical is None
    assert result.needs_review is True
    assert result.verbatim.kind == "url"
    assert result.verbatim.url == "https://cooking.nytimes.com/r/1"
    assert "Subscribe to continue" in (result.verbatim.page_text or "")


@respx.mock
async def test_network_error_returns_needs_review():
    respx.get("https://down.example.com/").mock(side_effect=ConnectionError)
    result = await url_mod.ingest_url("https://down.example.com/")
    assert result.canonical is None
    assert result.needs_review is True


def test_meta_image_urls_extracts_og_and_twitter():
    from mealy_worker.ingest.url import _meta_image_urls

    html = (
        "<html><head>"
        '<meta property="og:image" content="https://x.com/a.jpg">'
        '<meta name="twitter:image" content="https://x.com/b.jpg">'
        "</head><body></body></html>"
    )
    assert _meta_image_urls(html) == ["https://x.com/a.jpg", "https://x.com/b.jpg"]

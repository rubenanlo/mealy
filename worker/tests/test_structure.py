"""Task 4 — structuring brain tests. The Anthropic client is always mocked."""

from types import SimpleNamespace

import pytest

from mealy_worker import structure
from mealy_worker.models import CanonicalRecipe, Verbatim

PASTED = (
    "Tarte aux poireaux\n\n"
    "Ingrédients :\n- 3 poireaux\n- 200 g de lardons\n- 1 pâte brisée\n\n"
    "Étapes :\n1. Émincer les poireaux.\n2. Cuire 30 min à 180°C.\n"
)


class FakeAnthropicClient:
    """Records every messages.create call and replies with a fixed tool_use block."""

    def __init__(self, tool_input: dict):
        self.calls: list[dict] = []
        self._tool_input = tool_input
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            content=[SimpleNamespace(type="tool_use", input=self._tool_input)]
        )


def make_fake(monkeypatch, tool_input: dict) -> FakeAnthropicClient:
    fake = FakeAnthropicClient(tool_input)
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    return fake


TOOL_REPLY = {
    "title": "Tarte aux poireaux",
    "language": "fr",
    "servings": 4,
    "prep_minutes": 15,
    "cook_minutes": 30,
    "dish_type": "main",
    "tags": ["tarte"],
    "ingredients": [
        {"raw": "3 poireaux", "quantity": 3.0, "unit": None, "name": "poireau"},
        {"raw": "200 g de lardons", "quantity": 200.0, "unit": "g", "name": "lardons"},
        {"raw": "1 pâte brisée", "quantity": 1.0, "unit": None, "name": "pâte brisée"},
    ],
    "steps": ["Émincer les poireaux.", "Cuire 30 min à 180°C."],
    "nutrition": None,
    "confidence": 0.9,
}


async def test_structure_text_returns_canonical_with_raw_on_every_ingredient(monkeypatch):
    make_fake(monkeypatch, TOOL_REPLY)
    recipe = await structure.structure_text(Verbatim(kind="paste", pasted=PASTED))
    assert isinstance(recipe, CanonicalRecipe)
    assert recipe.ingredients, "expected ingredients"
    for ing in recipe.ingredients:
        assert ing.raw.strip(), "every ingredient must carry a non-empty raw line"


async def test_prompt_contains_verbatim_text_unmodified(monkeypatch):
    fake = make_fake(monkeypatch, TOOL_REPLY)
    await structure.structure_text(Verbatim(kind="paste", pasted=PASTED))
    assert len(fake.calls) == 1
    call = fake.calls[0]
    user_text = "".join(
        block["text"]
        for msg in call["messages"]
        for block in (
            msg["content"] if isinstance(msg["content"], list) else [{"type": "text", "text": msg["content"]}]
        )
        if block.get("type") == "text"
    )
    assert PASTED in user_text, "verbatim text must appear byte-for-byte in the prompt"
    assert call["model"] == "claude-haiku-4-5"
    assert call["tool_choice"]["type"] == "tool"


async def test_low_confidence_propagates(monkeypatch):
    make_fake(monkeypatch, {**TOOL_REPLY, "confidence": 0.4})
    recipe = await structure.structure_text(Verbatim(kind="paste", pasted=PASTED))
    assert recipe.confidence == 0.4
    assert recipe.confidence < 0.6


async def test_json_ld_short_circuit_makes_no_llm_call(monkeypatch):
    fake = make_fake(monkeypatch, TOOL_REPLY)
    json_ld = {
        "@type": "Recipe",
        "name": "Gratin dauphinois",
        "recipeIngredient": ["1 kg de pommes de terre", "50 cl de crème"],
        "recipeInstructions": [
            {"@type": "HowToStep", "text": "Émincer les pommes de terre."},
            {"@type": "HowToStep", "text": "Cuire 1 h à 160°C."},
        ],
        "recipeYield": "6 personnes",
        "prepTime": "PT20M",
        "cookTime": "PT1H",
        "keywords": "gratin, hiver",
        "inLanguage": "fr",
    }
    recipe = await structure.structure_text(Verbatim(kind="url", json_ld=json_ld))
    assert fake.calls == [], "JSON-LD short-circuit must not call the LLM"
    assert recipe.confidence == 1.0
    assert recipe.title == "Gratin dauphinois"
    assert [i.raw for i in recipe.ingredients] == ["1 kg de pommes de terre", "50 cl de crème"]
    assert recipe.steps == ["Émincer les pommes de terre.", "Cuire 1 h à 160°C."]
    assert recipe.servings == 6
    assert recipe.prep_minutes == 20
    assert recipe.cook_minutes == 60


async def test_incomplete_json_ld_falls_through_to_llm(monkeypatch):
    fake = make_fake(monkeypatch, TOOL_REPLY)
    await structure.structure_text(
        Verbatim(kind="url", json_ld={"@type": "Recipe", "name": "Sans ingrédients"}, page_text=PASTED)
    )
    assert len(fake.calls) == 1


async def test_force_llm_skips_json_ld_shortcut(monkeypatch):
    fake = make_fake(monkeypatch, TOOL_REPLY)
    json_ld = {
        "@type": "Recipe", "name": "X",
        "recipeIngredient": ["1 oignon"], "recipeInstructions": "Cuire.",
    }
    recipe = await structure.structure_text(
        Verbatim(kind="url", url="https://x", json_ld=json_ld), force_llm=True
    )
    assert len(fake.calls) == 1, "force_llm must reach the model"
    assert recipe.title == "Tarte aux poireaux"


async def test_structure_images_returns_canonical_and_ocr_text(monkeypatch):
    ocr = "Recette manuscrite : 3 poireaux, 200 g de lardons"
    fake = make_fake(monkeypatch, {**TOOL_REPLY, "ocr_text": ocr})
    recipe, ocr_text = await structure.structure_images(
        [b"\x89PNG fake", b"\xff\xd8 fake"], ["image/png", "image/jpeg"], hint=None
    )
    assert isinstance(recipe, CanonicalRecipe)
    assert ocr_text == ocr
    assert len(fake.calls) == 1
    content = fake.calls[0]["messages"][0]["content"]
    image_blocks = [b for b in content if b.get("type") == "image"]
    assert len(image_blocks) == 2
    assert image_blocks[0]["source"]["media_type"] == "image/png"
    assert image_blocks[1]["source"]["media_type"] == "image/jpeg"

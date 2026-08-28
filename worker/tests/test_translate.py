"""Recipe translation endpoint. The Anthropic client is always mocked."""

from types import SimpleNamespace

import pytest

from mealy_worker import structure, translate
from mealy_worker.models import Ingredient


class FakeClient:
    def __init__(self, tool_input: dict):
        self.calls: list[dict] = []
        self._tool_input = tool_input
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self._tool_input)])


def _reply(steps_es=None):
    return {
        "source_language": "fr",
        "translations": {
            "en": {
                "title": "Vegetable soup",
                "ingredients": [
                    {"raw": "1 onion", "quantity": 1.0, "unit": None,
                     "name": "onion", "group": None, "fodmap": "high"}
                ],
                "steps": ["Slice the onion.", "Cook 30 min."],
            },
            "es": {
                "title": "Sopa de verduras",
                "ingredients": [
                    {"raw": "1 cebolla", "quantity": 1.0, "unit": None,
                     "name": "cebolla", "group": None, "fodmap": "high"}
                ],
                "steps": steps_es or ["Corta la cebolla.", "Cocina 30 min."],
            },
            "it": {
                "title": "Zuppa di verdure",
                "ingredients": [
                    {"raw": "1 cipolla", "quantity": 1.0, "unit": None,
                     "name": "cipolla", "group": None, "fodmap": "high"}
                ],
                "steps": ["Affetta la cipolla.", "Cuoci 30 min."],
            },
        },
    }


def _request():
    return translate.TranslateRequest(
        title="Soupe de légumes",
        language="fr",
        ingredients=[Ingredient(raw="1 oignon", quantity=1.0, name="oignon", fodmap="high")],
        steps=["Émincer l'oignon.", "Cuire 30 min."],
    )


async def test_translate_reaches_the_model_and_validates(monkeypatch):
    fake = FakeClient(_reply())
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    response = await translate.translate_recipe(_request())
    assert len(fake.calls) == 1
    assert fake.calls[0]["model"] == "claude-haiku-4-5"
    assert response.source_language == "fr"
    assert set(response.translations) == {"en", "es", "it"}
    assert response.translations["es"].title == "Sopa de verduras"
    # The source text reaches the prompt.
    assert "1 oignon" in fake.calls[0]["messages"][0]["content"][0]["text"]


async def test_source_language_is_excluded_from_targets(monkeypatch):
    fake = FakeClient(_reply())
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    response = await translate.translate_recipe(_request())
    assert "fr" not in response.translations


async def test_fidelity_guard_rejects_dropped_steps(monkeypatch):
    # The es translation loses a step: the module must refuse rather than
    # silently persist an unfaithful translation.
    fake = FakeClient(_reply(steps_es=["Corta la cebolla."]))
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    with pytest.raises(ValueError, match="es"):
        await translate.translate_recipe(_request())

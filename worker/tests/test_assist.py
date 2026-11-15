"""Mealy AI assistant routes. The Anthropic client is always mocked."""

from types import SimpleNamespace

from mealy_worker import assist, structure
from mealy_worker.models import Ingredient


class FakeClient:
    def __init__(self, tool_input: dict):
        self.calls: list[dict] = []
        self._tool_input = tool_input
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self._tool_input)])


SOUP = dict(
    title="Red lentil soup",
    language="en",
    servings=4,
    ingredients=[
        Ingredient(raw="2 tbsp olive oil", quantity=2, unit="tbsp", name="olive oil"),
        Ingredient(raw="1 onion", quantity=1, name="onion"),
        Ingredient(raw="1 tsp salt", quantity=1, unit="tsp", name="salt"),
    ],
    steps=["Soften the onion in the oil.", "Simmer 20 min.", "Season."],
)


async def test_edit_sends_recipe_and_request_and_fixes_markers(monkeypatch):
    fake = FakeClient(
        {
            "summary": "Chorizo goes in first.",
            "title_suffix": "with chorizo",
            "ingredients": [
                # Model forgot to mark this as added.
                {"raw": "150 g chorizo", "quantity": 150, "unit": "g", "name": "chorizo", "change": "same"},
                # Model marked an untouched line as changed.
                {"raw": "1 onion", "quantity": 1, "name": "onion", "change": "changed", "was": "1 onion"},
                {"raw": "1 tsp olive oil", "quantity": 1, "unit": "tsp", "name": "olive oil", "change": "same"},
            ],
            "removed": ["1 tsp salt", "not in the recipe"],
            "steps": [
                {"text": "Fry the chorizo, then soften the onion.", "change": "same"},
                {"text": "Simmer 20 min.", "change": "changed"},
            ],
        }
    )
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await assist.edit_recipe(assist.EditRequest(**SOUP, request="add chorizo"))

    text = fake.calls[0]["messages"][0]["content"][0]["text"]
    assert "- 2 tbsp olive oil" in text and "The cook asks: add chorizo" in text
    assert fake.calls[0]["tool_choice"] == {"type": "tool", "name": "emit_adapted_recipe"}
    changes = {i.raw: (i.change, i.was) for i in reply.ingredients}
    assert changes["150 g chorizo"] == ("added", None)
    assert changes["1 onion"] == ("same", None)
    assert changes["1 tsp olive oil"] == ("changed", "2 tbsp olive oil")
    assert [s.change for s in reply.steps] == ["changed", "same"]
    assert reply.removed == ["1 tsp salt"]


async def test_edit_includes_history(monkeypatch):
    fake = FakeClient({"summary": "ok", "ingredients": [], "steps": []})
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    await assist.edit_recipe(
        assist.EditRequest(
            **SOUP,
            request="less spicy",
            history=[assist.ChatTurn(role="user", text="add chorizo")],
        )
    )
    assert "user: add chorizo" in fake.calls[0]["messages"][0]["content"][0]["text"]


async def test_ask_returns_answer_and_suggestion(monkeypatch):
    fake = FakeClient({"answer": "Yes, simmer 40 min.", "suggested_change": "Use green lentils"})
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await assist.ask_recipe(assist.AskRequest(**SOUP, question="Green lentils?"))
    assert reply.answer.startswith("Yes")
    assert reply.suggested_change == "Use green lentils"


async def test_units_clamps_to_target_system(monkeypatch):
    fake = FakeClient(
        {
            "lines": [
                {"raw": "250 g lentils", "quantity": 1.25, "unit": "cups"},
                {"raw": "1 tin tomatoes", "quantity": 400, "unit": "g"},  # wrong system
                {"raw": "invented", "quantity": 1, "unit": "cup"},
            ]
        }
    )
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await assist.estimate_units(
        assist.UnitsRequest(
            target="us",
            lines=[
                assist.UnitLine(raw="250 g lentils", quantity=250, unit="g", name="lentils"),
                assist.UnitLine(raw="1 tin tomatoes", quantity=1, unit="tin", name="tomatoes"),
            ],
        )
    )
    assert [(e.raw, e.quantity, e.unit) for e in reply.lines] == [
        ("250 g lentils", 1.25, "cups"),
        ("1 tin tomatoes", None, None),
    ]


async def test_units_empty_skips_model(monkeypatch):
    def boom():
        raise AssertionError("should not call the model")

    monkeypatch.setattr(structure, "get_anthropic_client", boom)
    reply = await assist.estimate_units(assist.UnitsRequest(target="metric", lines=[]))
    assert reply.lines == []

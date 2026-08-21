"""Part 8 — FODMAP swap suggestions. The Anthropic client is always mocked."""

from types import SimpleNamespace

from mealy_worker import fodmap, structure
from mealy_worker.models import Ingredient


class FakeClient:
    def __init__(self, tool_input: dict):
        self.calls: list[dict] = []
        self._tool_input = tool_input
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self._tool_input)])


SWAP_REPLY = {
    "swaps": [
        {
            "raw": "1 oignon",
            "replacement": {"raw": "1 oignon", "quantity": 2.0, "unit": None,
                            "name": "vert de poireau", "group": None, "fodmap": "low"},
            "note": "Le vert de poireau est pauvre en FODMAP.",
        }
    ],
    "steps": ["Émincer le vert de poireau.", "Cuire 30 min."],
}


async def test_swaps_reach_the_model_and_validate(monkeypatch):
    fake = FakeClient(SWAP_REPLY)
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    request = fodmap.SwapRequest(
        title="Soupe",
        servings=4,
        ingredients=[Ingredient(raw="1 oignon", name="oignon")],
        steps=["Émincer l'oignon.", "Cuire 30 min."],
        flagged=["1 oignon"],
    )
    response = await fodmap.suggest_swaps(request)
    assert len(fake.calls) == 1
    assert fake.calls[0]["model"] == "claude-haiku-4-5"
    assert response.swaps[0].replacement.name == "vert de poireau"
    assert "1 oignon" in fake.calls[0]["messages"][0]["content"][0]["text"]

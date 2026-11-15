"""AI week-plan change route. The Anthropic client is always mocked."""

from types import SimpleNamespace

from mealy_worker import plan_ai, structure


class FakeClient:
    def __init__(self, tool_input: dict):
        self.calls: list[dict] = []
        self._tool_input = tool_input
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self._tool_input)])


def _request(**extra):
    return plan_ai.PlanChangeRequest(
        request="No fish on Sunday",
        language="en",
        cells=[
            plan_ai.PlanCell(day=6, slot="lunch", recipe_id="r-fish", title="Merluza", category="fish"),
            plan_ai.PlanCell(day=0, slot="dinner", recipe_id="r-pork", title="Pork rice", locked=True),
            plan_ai.PlanCell(day=5, slot="dinner", going_out=True),
        ],
        candidates=[
            plan_ai.PlanCandidate(id="r-fish", title="Merluza", category="fish"),
            plan_ai.PlanCandidate(id="r-chicken", title="Poulet rôti", category="meat", weeks_since=6),
        ],
        **extra,
    )


async def test_change_keeps_valid_changes_and_sends_plan(monkeypatch):
    fake = FakeClient(
        {
            "message": "Swapped Sunday lunch for roast chicken.",
            "changes": [
                {"day": 6, "slot": "lunch", "action": "set", "recipe_id": "r-chicken"},
                # Locked meal: dropped.
                {"day": 0, "slot": "dinner", "action": "set", "recipe_id": "r-chicken"},
                # Unknown recipe and no title: dropped.
                {"day": 5, "slot": "dinner", "action": "set", "recipe_id": "nope"},
            ],
        }
    )
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await plan_ai.change_plan(_request())
    assert reply.message.startswith("Swapped")
    assert [(c.day, c.slot, c.recipe_id) for c in reply.changes] == [(6, "lunch", "r-chicken")]
    text = fake.calls[0]["messages"][0]["content"][0]["text"]
    assert "Sunday lunch: Merluza [fish]" in text
    assert "locked" in text
    assert "r-chicken | Poulet rôti | meat, last planned 6 wk ago" in text
    assert "The family asks: No fish on Sunday" in text


async def test_custom_title_and_clear(monkeypatch):
    fake = FakeClient(
        {
            "message": "Done.",
            "changes": [
                {"day": 6, "slot": "lunch", "action": "set", "recipe_id": None, "custom_title": "Leftovers"},
                {"day": 5, "slot": "dinner", "action": "clear", "recipe_id": "r-fish"},
                {"day": 6, "slot": "lunch", "action": "clear"},
            ],
        }
    )
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await plan_ai.change_plan(_request())
    assert [(c.day, c.action, c.recipe_id, c.custom_title) for c in reply.changes] == [
        (6, "set", None, "Leftovers"),
        (5, "clear", None, None),
    ]

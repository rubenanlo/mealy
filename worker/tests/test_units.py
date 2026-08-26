"""LLM fallback unit classifier tests (units.py).

Same mocked-Anthropic pattern as test_matching.py. The model proposes,
code disposes: kinds outside the enum and implausible factors are nulled.
"""

from types import SimpleNamespace

from mealy_worker import units


class FakeAnthropicClient:
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
    monkeypatch.setattr(units, "get_anthropic_client", lambda: fake)
    return fake


async def test_classifies_batch_in_one_call(monkeypatch):
    fake = make_fake(
        monkeypatch,
        {
            "conversions": [
                {"unit": "knob", "kind": "mass", "factor": 15},
                {"unit": "sprig", "kind": "count", "factor": 3},
                {"unit": "vasetto", "kind": "volume", "factor": 125},
                {"unit": "to taste", "kind": None, "factor": None},
            ]
        },
    )
    result = await units.classify_units(["knob", "sprig", "vasetto", "to taste"])
    assert len(fake.calls) == 1
    assert [(c.kind, c.factor) for c in result] == [
        ("mass", 15),
        ("count", None),  # count factors are dropped
        ("volume", 125),
        (None, None),
    ]


async def test_implausible_or_invalid_answers_are_nulled(monkeypatch):
    make_fake(
        monkeypatch,
        {
            "conversions": [
                {"unit": "handful", "kind": "mass", "factor": 90000},
                {"unit": "dash", "kind": "volume", "factor": 0.0001},
                {"unit": "weird", "kind": "temperature", "factor": 3},
                {"unit": "nofactor", "kind": "volume", "factor": None},
            ]
        },
    )
    result = await units.classify_units(["handful", "dash", "weird", "nofactor"])
    assert all(c.kind is None and c.factor is None for c in result)


async def test_units_the_model_skips_come_back_null(monkeypatch):
    make_fake(monkeypatch, {"conversions": [{"unit": "cup", "kind": "volume", "factor": 240}]})
    result = await units.classify_units(["cup", "skipped"])
    assert result[0].kind == "volume"
    assert result[1].unit == "skipped" and result[1].kind is None


async def test_empty_input_short_circuits(monkeypatch):
    fake = make_fake(monkeypatch, {"conversions": []})
    assert await units.classify_units([]) == []
    assert fake.calls == []

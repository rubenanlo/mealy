"""FODMAP list matching + alternatives chat. The Anthropic client is always mocked."""

from types import SimpleNamespace

from mealy_worker import fodmap_list, structure
from mealy_worker.fodmap_list import (
    AlternativesRequest,
    FlaggedLine,
    ListEntry,
    ListMatchRequest,
    MatchLine,
)
from mealy_worker.models import Ingredient


class FakeClient:
    def __init__(self, tool_input: dict):
        self.calls: list[dict] = []
        self._tool_input = tool_input
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self._tool_input)])


ENTRIES = [
    ListEntry(i=0, name="Garlic, peeled, raw", overall="red", green_max=None, red_qty=3),
    ListEntry(i=1, name="Oil, Garlic Infused Extra Virgin Olive Oil", overall="green", green_max=15, unit="ml"),
    ListEntry(i=2, name="Onion, spring / scallion (green tops only), raw", overall="green", green_max=75),
]


async def test_match_drops_unknown_indexes_and_keys(monkeypatch):
    fake = FakeClient({"matches": [{"key": "a", "index": 0}, {"key": "b", "index": 99}, {"key": "zz", "index": 1}]})
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await fodmap_list.match_lines(
        ListMatchRequest(lines=[MatchLine(key="a", text="2 gousses d'ail"), MatchLine(key="b", text="sel")], entries=ENTRIES)
    )
    assert [(m.key, m.index) for m in reply.matches] == [("a", 0), ("b", None)]
    system = fake.calls[0]["system"]
    assert system[1]["cache_control"] == {"type": "ephemeral"}
    assert "0: Garlic, peeled, raw" in system[1]["text"]


async def test_match_with_empty_list_skips_the_model(monkeypatch):
    def boom():
        raise AssertionError("no call expected")

    monkeypatch.setattr(structure, "get_anthropic_client", boom)
    reply = await fodmap_list.match_lines(ListMatchRequest(lines=[MatchLine(key="a", text="ail")], entries=[]))
    assert reply.matches[0].index is None


async def test_alternatives_keep_flagged_lines_valid_entries_and_one_recommended(monkeypatch):
    fake = FakeClient(
        {
            "message": "Use garlic oil.",
            "alternatives": [
                {
                    "for_raw": "2 garlic cloves",
                    "options": [
                        {"line": "1 tbsp garlic-infused oil", "entry_index": 1, "recommended": True},
                        {"line": "1 tbsp garlic-infused oil", "entry_index": 1},
                        {"line": "Leave it out", "remove": True, "entry_index": 0, "recommended": True},
                        {"line": "pinch of magic", "entry_index": 42},
                    ],
                },
                {"for_raw": "not flagged", "options": [{"line": "x", "entry_index": 0}]},
            ],
        }
    )
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await fodmap_list.suggest_alternatives(
        AlternativesRequest(
            title="Arroz chaufa",
            language="en",
            servings=4,
            ingredients=[Ingredient(raw="2 garlic cloves", quantity=2, name="garlic")],
            steps=["Fry the garlic."],
            flagged=[FlaggedLine(raw="2 garlic cloves", entry="Garlic, peeled, raw", detail="1.5 g per serving")],
            entries=ENTRIES,
            question="Can I use leek?",
        )
    )
    assert reply.message == "Use garlic oil."
    assert len(reply.alternatives) == 1
    options = reply.alternatives[0].options
    assert [o.line for o in options] == ["1 tbsp garlic-infused oil", "Leave it out", "pinch of magic"]
    assert [o.recommended for o in options] == [True, False, False]
    assert options[1].entry_index is None  # remove never points at an entry
    assert options[2].entry_index is None  # unknown index dropped
    text = fake.calls[0]["messages"][0]["content"][0]["text"]
    assert "Can I use leek?" in text and "green up to" in fake.calls[0]["system"][1]["text"]

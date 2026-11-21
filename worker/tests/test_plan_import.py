"""Week-plan import routes. The Anthropic client is always mocked."""

from types import SimpleNamespace

from mealy_worker import plan_import, structure


class FakeClient:
    def __init__(self, tool_input: dict):
        self.calls: list[dict] = []
        self._tool_input = tool_input
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self._tool_input)])


MESSAGE = """Dijous:
• amanida patates mongetes
• tacos pollastre

Divendres:
• amanida Centr? O fora...
• fora

Dilluns:
• arros chaufa (Patricia te pizzes a la feina...)
"""


def _request():
    return plan_import.PlanImportRequest(
        text=MESSAGE,
        language="en",
        people=[
            plan_import.ImportPerson(id="p", name="Patricia"),
            plan_import.ImportPerson(id="m", name="Marc"),
            plan_import.ImportPerson(id="s", name="Sindy", employee=True),
        ],
        recipes=[plan_import.ImportRecipe(id="r-tacos", title="Tacos de pollo")],
        remembered=[plan_import.RememberedMatch(phrase="arros chaufa", recipe_id="r-chaufa", title="Arroz chaufa")],
    )


def _meal(day_word, weekday, slot, main=None, **extra):
    return {"day_word": day_word, "weekday": weekday, "slot": slot, "source": "x", "main": main, **extra}


async def test_import_validates_and_numbers_days(monkeypatch):
    fake = FakeClient(
        {
            "meals": [
                _meal("Dijous", 3, "lunch", {"phrase": "amanida patates mongetes", "title": "Amanida de patates"}),
                _meal(
                    "Dijous",
                    3,
                    "dinner",
                    {"phrase": "tacos pollastre", "title": "Tacos de pollastre", "recipe_id": "r-tacos"},
                    employee_part="  patates  ",
                ),
                # Repeated meal: dropped.
                _meal("Dijous", 3, "dinner", {"phrase": "tacos", "title": "Tacos"}),
                _meal(
                    "Divendres",
                    4,
                    "lunch",
                    {"phrase": "amanida Centr", "title": "Amanida Centre", "recipe_id": "invented"},
                    undecided=True,
                    options=["Amanida Centre", "Fora", ""],
                ),
                # Eating out keeps no dish even if the model filled one.
                _meal("Divendres", 4, "dinner", {"phrase": "fora", "title": "Fora"}, eating_out=True),
                _meal(
                    "Dilluns",
                    0,
                    "lunch",
                    {"phrase": "arros chaufa", "title": "Arròs chaufa"},
                    away_names=["patricia", "Nobody"],
                    extra_dishes=[{"dish": {"phrase": "galettes", "title": "Galettes"}, "for_names": ["Marc", "x"], "for_label": "els nens"}],
                ),
                # No dish and not eating out: dropped.
                _meal("Dilluns", 0, "dinner"),
            ]
        }
    )
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await plan_import.import_plan(_request())
    meals = reply.meals
    assert [(m.day_index, m.weekday, m.slot) for m in meals] == [
        (0, 3, "lunch"),
        (0, 3, "dinner"),
        (1, 4, "lunch"),
        (1, 4, "dinner"),
        (2, 0, "lunch"),
    ]
    assert meals[1].main.recipe_id == "r-tacos"
    assert meals[1].employee_part == "patates"
    assert meals[2].main.recipe_id is None
    assert meals[2].options == ["Amanida Centre", "Fora"]
    assert meals[3].eating_out and meals[3].main is None
    assert meals[4].away_names == ["Patricia"]
    assert meals[4].extra_dishes[0].for_names == ["Marc"]
    assert meals[4].extra_dishes[0].for_label == "els nens"

    text = fake.calls[0]["messages"][0]["content"][0]["text"]
    assert "- Sindy (employee" in text
    assert "r-tacos | Tacos de pollo" in text
    assert "'arros chaufa' → r-chaufa (Arroz chaufa)" in text
    assert "<message>\nDijous:" in text


async def test_options_only_kept_when_undecided(monkeypatch):
    fake = FakeClient({"meals": [_meal("Dijous", 3, "lunch", {"phrase": "a", "title": "A"}, options=["A", "B"])]})
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await plan_import.import_plan(_request())
    assert reply.meals[0].options == []


async def test_transcribe_sends_images_in_order(monkeypatch):
    fake = FakeClient({"text": "  Dijous:\n• amanida  "})
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await plan_import.transcribe_plan([b"one", b"two"], ["image/png", "image/jpeg"])
    assert reply.text == "Dijous:\n• amanida"
    content = fake.calls[0]["messages"][0]["content"]
    assert [c["type"] for c in content] == ["image", "image", "text"]
    assert content[1]["source"]["media_type"] == "image/jpeg"


async def test_ideas_are_cleaned_and_deduplicated(monkeypatch):
    fake = FakeClient(
        {
            "meals": [_meal("Dijous", 3, "lunch", {"phrase": "a", "title": "A"})],
            "ideas": [
                {"heading": " Setmana que ve ", "when": "next_week", "source": "chana masala", "dish": {"phrase": "chana masala", "title": "Chana masala", "recipe_id": "r-tacos"}},
                {"heading": "Setmana que ve", "when": "next_week", "source": "x", "dish": {"phrase": "Chana Masala", "title": "Chana", "recipe_id": None}},
                {"heading": "Setmana que ve", "when": "next_week", "source": "caldo", "dish": {"phrase": "caldo", "title": "Caldo", "recipe_id": "made-up"}},
                {"heading": "Setmana que ve", "when": "next_week", "source": "", "dish": {"phrase": " ", "title": ""}},
            ],
        }
    )
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    reply = await plan_import.import_plan(_request())
    assert [(i.heading, i.dish.title, i.dish.recipe_id) for i in reply.ideas] == [
        ("Setmana que ve", "Chana masala", "r-tacos"),
        ("Setmana que ve", "Caldo", None),
    ]
    assert "starts a list of ideas" in fake.calls[0]["system"]

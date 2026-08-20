"""Phase 2 Task 4 — LLM fallback ingredient matcher tests.

The Anthropic client is always mocked (same pattern as test_structure.py).
Spec §4: the LLM only maps lines to provided candidate slugs — it may never
invent a slug, and anything outside the candidate list is forced to null
server-side.
"""

import time
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from mealy_worker import main, matching

LINES = [
    "200 g de carottes râpées",
    "2 oignons rouges émincés",
    "1 pincée de sumac",
]
CANDIDATES = ["carotte", "oignon", "ail", "poireau"]


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
    monkeypatch.setattr(matching, "get_anthropic_client", lambda: fake)
    return fake


TOOL_REPLY = {
    "matches": [
        {"line": "200 g de carottes râpées", "slug": "carotte"},
        {"line": "2 oignons rouges émincés", "slug": "oignon"},
        {"line": "1 pincée de sumac", "slug": None},
    ]
}


# --- matcher -----------------------------------------------------------------


async def test_maps_each_line_to_candidate_slug_or_null(monkeypatch):
    make_fake(monkeypatch, TOOL_REPLY)
    matches = await matching.match_ingredients(LINES, CANDIDATES)
    assert [(m.line, m.slug) for m in matches] == [
        ("200 g de carottes râpées", "carotte"),
        ("2 oignons rouges émincés", "oignon"),
        ("1 pincée de sumac", None),
    ]


async def test_prompt_contains_raw_lines_verbatim(monkeypatch):
    fake = make_fake(monkeypatch, TOOL_REPLY)
    await matching.match_ingredients(LINES, CANDIDATES)
    assert len(fake.calls) == 1
    call = fake.calls[0]
    user_text = "".join(
        block["text"]
        for msg in call["messages"]
        for block in (
            msg["content"]
            if isinstance(msg["content"], list)
            else [{"type": "text", "text": msg["content"]}]
        )
        if block.get("type") == "text"
    )
    for line in LINES:
        assert line in user_text, "every raw line must appear byte-for-byte in the prompt"
    for slug in CANDIDATES:
        assert slug in user_text, "candidate slugs must be offered in the prompt"
    assert call["model"] == "claude-haiku-4-5"
    assert call["tool_choice"] == {"type": "tool", "name": "emit_matches"}


async def test_out_of_candidates_slug_is_forced_to_null(monkeypatch):
    make_fake(
        monkeypatch,
        {
            "matches": [
                {"line": "200 g de carottes râpées", "slug": "carotte"},
                {"line": "2 oignons rouges émincés", "slug": "echalote"},  # invented
                {"line": "1 pincée de sumac", "slug": "sumac"},  # invented
            ]
        },
    )
    matches = await matching.match_ingredients(LINES, CANDIDATES)
    assert [m.slug for m in matches] == ["carotte", None, None]


async def test_empty_lines_returns_empty_without_llm_call(monkeypatch):
    fake = make_fake(monkeypatch, TOOL_REPLY)
    assert await matching.match_ingredients([], CANDIDATES) == []
    assert fake.calls == [], "empty input must not cost an LLM call"


async def test_line_missing_from_reply_stays_null(monkeypatch):
    make_fake(
        monkeypatch,
        {"matches": [{"line": "200 g de carottes râpées", "slug": "carotte"}]},
    )
    matches = await matching.match_ingredients(LINES, CANDIDATES)
    assert [m.line for m in matches] == LINES, "every input line must appear in the result"
    assert [m.slug for m in matches] == ["carotte", None, None]


async def test_empty_candidates_returns_all_null_without_llm_call(monkeypatch):
    fake = make_fake(monkeypatch, TOOL_REPLY)
    matches = await matching.match_ingredients(LINES, [])
    assert [m.slug for m in matches] == [None, None, None]
    assert fake.calls == [], "no candidates means nothing to match — no LLM call"


# --- route -------------------------------------------------------------------

SECRET = "test-secret-key-0123456789abcdef0123456789abcdef"


@pytest.fixture(autouse=True)
def jwt_secret(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)


@pytest.fixture
def client():
    return TestClient(main.app)


def auth():
    token = jwt.encode(
        {"sub": "user-123", "aud": "authenticated", "exp": int(time.time()) + 3600},
        SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def test_match_route_requires_token(client):
    response = client.post(
        "/match/ingredients", json={"lines": LINES, "candidates": CANDIDATES}
    )
    assert response.status_code == 401


def test_match_route_dispatches(client, monkeypatch):
    seen = {}

    async def fake_match(lines, candidates):
        seen["lines"] = lines
        seen["candidates"] = candidates
        return [
            matching.IngredientMatch(line=line, slug=slug)
            for line, slug in zip(lines, ["carotte", "oignon", None], strict=True)
        ]

    monkeypatch.setattr(main, "match_ingredients", fake_match)
    response = client.post(
        "/match/ingredients",
        json={"lines": LINES, "candidates": CANDIDATES},
        headers=auth(),
    )
    assert response.status_code == 200
    assert seen["lines"] == LINES
    assert seen["candidates"] == CANDIDATES
    assert response.json() == {
        "matches": [
            {"line": "200 g de carottes râpées", "slug": "carotte"},
            {"line": "2 oignons rouges émincés", "slug": "oignon"},
            {"line": "1 pincée de sumac", "slug": None},
        ]
    }


def test_match_route_empty_lines(client, monkeypatch):
    fake = FakeAnthropicClient(TOOL_REPLY)
    monkeypatch.setattr(matching, "get_anthropic_client", lambda: fake)
    response = client.post(
        "/match/ingredients",
        json={"lines": [], "candidates": CANDIDATES},
        headers=auth(),
    )
    assert response.status_code == 200
    assert response.json() == {"matches": []}
    assert fake.calls == []

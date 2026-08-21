"""Task 8 — API + JWT auth tests. All ingest functions are mocked."""

import time

import jwt
import pytest
from fastapi.testclient import TestClient

from mealy_worker import main
from mealy_worker.models import CanonicalRecipe, IngestResult, Ingredient, Verbatim

SECRET = "test-secret-key-0123456789abcdef0123456789abcdef"

RESULT = IngestResult(
    verbatim=Verbatim(kind="url", url="https://example.com/r", page_text="texte"),
    canonical=CanonicalRecipe(
        title="Soupe",
        ingredients=[Ingredient(raw="2 carottes", name="carotte")],
        steps=["Cuire."],
        confidence=0.9,
    ),
    needs_review=False,
    image_urls=[],
)


@pytest.fixture(autouse=True)
def jwt_secret(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)


@pytest.fixture
def client():
    return TestClient(main.app)


def make_token(secret=SECRET, aud="authenticated", exp_offset=3600):
    return jwt.encode(
        {"sub": "user-123", "aud": aud, "exp": int(time.time()) + exp_offset},
        secret,
        algorithm="HS256",
    )


def auth(token=None):
    return {"Authorization": f"Bearer {token or make_token()}"}


def test_health_is_open(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ingest_without_token_is_401(client):
    assert client.post("/ingest/url", json={"url": "https://x.com"}).status_code == 401
    assert client.post("/ingest/text", json={"text": "recette"}).status_code == 401
    assert client.post("/ingest/social", json={"url": "https://x.com"}).status_code == 401


def test_bad_signature_is_401(client):
    response = client.post(
        "/ingest/url",
        json={"url": "https://x.com"},
        headers=auth(make_token(secret="wrong-secret-0123456789abcdef0123456789abcdef")),
    )
    assert response.status_code == 401


def test_wrong_audience_is_401(client):
    response = client.post(
        "/ingest/url", json={"url": "https://x.com"}, headers=auth(make_token(aud="anon"))
    )
    assert response.status_code == 401


def test_expired_token_is_401(client):
    response = client.post(
        "/ingest/url", json={"url": "https://x.com"}, headers=auth(make_token(exp_offset=-60))
    )
    assert response.status_code == 401


def test_ingest_url_dispatches(client, monkeypatch):
    seen = {}

    async def fake_ingest_url(url):
        seen["url"] = url
        return RESULT

    monkeypatch.setattr(main, "ingest_url", fake_ingest_url)
    response = client.post(
        "/ingest/url", json={"url": "https://example.com/r"}, headers=auth()
    )
    assert response.status_code == 200
    assert seen["url"] == "https://example.com/r"
    assert response.json()["canonical"]["title"] == "Soupe"


def test_ingest_text_wraps_paste_verbatim(client, monkeypatch):
    seen = {}

    async def fake_structure_text(verbatim):
        seen["verbatim"] = verbatim
        return RESULT.canonical

    monkeypatch.setattr(main, "structure_text", fake_structure_text)
    text = "Ma recette collée\n200 g de riz\nCuire."
    response = client.post("/ingest/text", json={"text": text}, headers=auth())
    assert response.status_code == 200
    assert seen["verbatim"].kind == "paste"
    assert seen["verbatim"].pasted == text  # byte-for-byte
    body = response.json()
    assert body["verbatim"]["kind"] == "paste"
    assert body["verbatim"]["pasted"] == text


def test_ingest_social_dispatches(client, monkeypatch):
    seen = {}

    async def fake_ingest_social(url):
        seen["url"] = url
        return RESULT

    monkeypatch.setattr(main, "ingest_social", fake_ingest_social)
    response = client.post(
        "/ingest/social", json={"url": "https://instagram.com/reel/x"}, headers=auth()
    )
    assert response.status_code == 200
    assert seen["url"] == "https://instagram.com/reel/x"


def test_ingest_images_multipart(client, monkeypatch):
    seen = {}

    async def fake_ingest_images(images, media_types):
        seen["images"] = images
        seen["media_types"] = media_types
        return RESULT

    monkeypatch.setattr(main, "ingest_images", fake_ingest_images)
    response = client.post(
        "/ingest/images",
        files=[
            ("files", ("a.jpg", b"jpeg-bytes", "image/jpeg")),
            ("files", ("b.png", b"png-bytes", "image/png")),
        ],
        headers=auth(),
    )
    assert response.status_code == 200
    assert seen["images"] == [b"jpeg-bytes", b"png-bytes"]
    assert seen["media_types"] == ["image/jpeg", "image/png"]


def test_structure_route_requires_token(client):
    body = {"verbatim": {"kind": "paste", "pasted": "x"}}
    assert client.post("/structure", json=body).status_code == 401


def test_structure_route_returns_canonical(client, monkeypatch):
    async def fake_structure(verbatim, force_llm=False):
        assert force_llm is True
        return RESULT.canonical

    monkeypatch.setattr(main, "structure_text", fake_structure)
    body = {"verbatim": {"kind": "paste", "pasted": "recette"}, "force_llm": True}
    response = client.post("/structure", json=body, headers=auth())
    assert response.status_code == 200
    assert response.json()["title"] == "Soupe"


def test_ingest_pdf_multipart(client, monkeypatch):
    seen = {}

    async def fake_ingest_pdf(data):
        seen["data"] = data
        return RESULT

    monkeypatch.setattr(main, "ingest_pdf", fake_ingest_pdf)
    response = client.post(
        "/ingest/pdf",
        files={"file": ("r.pdf", b"%PDF-bytes", "application/pdf")},
        headers=auth(),
    )
    assert response.status_code == 200
    assert seen["data"] == b"%PDF-bytes"


def test_image_fetch_requires_token(client):
    assert client.post("/image/fetch", json={"url": "https://x.com/a.jpg"}).status_code == 401


def test_image_fetch_returns_validated_jpeg(client, monkeypatch):
    seen = {}

    async def fake_fetch_validated_image(url):
        seen["url"] = url
        return b"jpeg"

    monkeypatch.setattr(main, "fetch_validated_image", fake_fetch_validated_image)
    response = client.post(
        "/image/fetch", json={"url": "https://x.com/a.jpg"}, headers=auth()
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == b"jpeg"
    assert seen["url"] == "https://x.com/a.jpg"


def test_image_fetch_422_when_validation_fails(client, monkeypatch):
    async def fake_fetch_validated_image(url):
        return None

    monkeypatch.setattr(main, "fetch_validated_image", fake_fetch_validated_image)
    response = client.post(
        "/image/fetch", json={"url": "https://x.com/bad.jpg"}, headers=auth()
    )
    assert response.status_code == 422

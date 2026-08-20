"""Task 6 — reel ingestion tests. yt-dlp, OpenAI and the LLM are all mocked."""

from types import SimpleNamespace

import pytest

from mealy_worker.ingest import social
from mealy_worker.models import CanonicalRecipe, Ingredient

REEL_URL = "https://www.instagram.com/reel/abc123/"

COMPLETE_CAPTION = (
    "Pâtes crémeuses 😍\n"
    "200 g de pâtes\n"
    "10 cl de crème\n"
    "3 gousses d'ail\n"
    "Cuire les pâtes, mélanger, servir !"
)

SHORT_CAPTION = "La recette de ce soir, dispo en story !"

CANNED = CanonicalRecipe(
    title="Pâtes crémeuses",
    ingredients=[Ingredient(raw="200 g de pâtes", name="pâtes")],
    steps=["Cuire les pâtes."],
    confidence=0.8,
)


class FakeYDL:
    """Stands in for yt_dlp.YoutubeDL as a context manager."""

    info: dict | None = None
    error: Exception | None = None
    calls: list = []

    def __init__(self, opts=None):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=False):
        FakeYDL.calls.append({"url": url, "download": download, "opts": self.opts})
        if FakeYDL.error is not None:
            raise FakeYDL.error
        return FakeYDL.info


@pytest.fixture(autouse=True)
def reset_fake_ydl(monkeypatch):
    FakeYDL.info = None
    FakeYDL.error = None
    FakeYDL.calls = []
    monkeypatch.setattr(social.yt_dlp, "YoutubeDL", FakeYDL)
    yield


def forbid(name):
    def _inner(*args, **kwargs):
        raise AssertionError(f"{name} must not be called")

    return _inner


async def test_complete_caption_skips_download(monkeypatch):
    FakeYDL.info = {
        "description": COMPLETE_CAPTION,
        "thumbnail": "https://cdn.example.com/thumb.jpg",
    }
    monkeypatch.setattr(social, "_download_audio", forbid("_download_audio"))
    monkeypatch.setattr(social, "_sample_frames", forbid("_sample_frames"))

    seen = {}

    async def fake_structure_text(verbatim):
        seen["verbatim"] = verbatim
        return CANNED

    monkeypatch.setattr(social, "structure_text", fake_structure_text)

    result = await social.ingest_social(REEL_URL)

    assert result.canonical is CANNED
    assert result.needs_review is False
    assert result.verbatim.kind == "reel"
    assert result.verbatim.caption == COMPLETE_CAPTION  # byte-for-byte
    assert result.verbatim.transcript is None
    assert seen["verbatim"].caption == COMPLETE_CAPTION
    assert result.image_urls == ["https://cdn.example.com/thumb.jpg"]
    # metadata only — nothing was downloaded
    assert all(c["download"] is False for c in FakeYDL.calls)


async def test_extract_info_failure_returns_needs_review(monkeypatch):
    FakeYDL.error = RuntimeError("login required")
    monkeypatch.setattr(social, "structure_text", forbid("structure_text"))

    result = await social.ingest_social(REEL_URL)

    assert result.canonical is None
    assert result.needs_review is True
    assert result.verbatim.kind == "reel"
    assert result.verbatim.url == REEL_URL
    # 2 retries → 3 attempts
    assert len(FakeYDL.calls) == 3


async def test_transcript_path_stores_transcript_verbatim(monkeypatch, tmp_path):
    FakeYDL.info = {"description": SHORT_CAPTION, "thumbnail": None}
    audio = tmp_path / "reel.m4a"
    audio.write_bytes(b"fake-audio")
    monkeypatch.setattr(social, "_download_audio", lambda url: audio)
    monkeypatch.setattr(social, "_sample_frames", lambda url, info: [b"frame1", b"frame2"])

    transcript_text = "Alors on met 200 g de pâtes,  euh, 10 cl de crème...\n"
    fake_openai = SimpleNamespace(
        audio=SimpleNamespace(
            transcriptions=SimpleNamespace(
                create=lambda **kw: _async_return(
                    SimpleNamespace(text=transcript_text), kw, seen_openai
                )
            )
        )
    )
    seen_openai = {}
    monkeypatch.setattr(social, "get_openai_client", lambda: fake_openai)

    async def fake_structure_images(images, media_types, hint=None):
        return CANNED, "AJOUTEZ LE PARMESAN"

    monkeypatch.setattr(social, "structure_images", fake_structure_images)

    seen = {}

    async def fake_structure_text(verbatim):
        seen["verbatim"] = verbatim
        return CANNED

    monkeypatch.setattr(social, "structure_text", fake_structure_text)

    result = await social.ingest_social(REEL_URL)

    # transcript stored exactly as transcribed, never post-edited
    assert result.verbatim.transcript == transcript_text
    assert result.verbatim.caption == SHORT_CAPTION
    assert result.verbatim.overlay_text == "AJOUTEZ LE PARMESAN"
    assert seen["verbatim"] == result.verbatim
    assert seen_openai["kwargs"]["model"] == "gpt-4o-mini-transcribe"
    assert result.canonical is CANNED


async def test_download_failure_falls_back_to_caption_only(monkeypatch):
    FakeYDL.info = {"description": SHORT_CAPTION, "thumbnail": None}

    def broken_download(url):
        raise RuntimeError("rate limited")

    monkeypatch.setattr(social, "_download_audio", broken_download)
    monkeypatch.setattr(social, "_sample_frames", forbid_frames_raise)

    async def fake_structure_text(verbatim):
        return CANNED

    monkeypatch.setattr(social, "structure_text", fake_structure_text)

    result = await social.ingest_social(REEL_URL)

    assert result.verbatim.caption == SHORT_CAPTION
    assert result.verbatim.transcript is None
    assert result.needs_review is True  # incomplete capture — flag for review
    assert result.canonical is CANNED


def forbid_frames_raise(url, info):
    raise RuntimeError("no video stream")


async def _async_return(value, kwargs, sink):
    sink["kwargs"] = kwargs
    return value

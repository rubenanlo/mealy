"""Reel ingestion — Instagram / TikTok (Task 6).

Pipeline: ``yt-dlp`` metadata (caption + thumbnail) → if the caption already
looks like a complete recipe (≥3 quantity-like tokens), skip any download;
otherwise download the audio → OpenAI ``gpt-4o-mini-transcribe`` → transcript,
and sample up to 4 video frames → vision OCR for on-screen overlay text. All
captured text streams are stored verbatim and bundled into one
``structure_text`` call.

Any fetch failure degrades gracefully: caption-only fallback with
``needs_review=True``, or ``canonical=None`` when nothing was captured.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

import openai
import yt_dlp

from ..models import IngestResult, Verbatim
from ..structure import structure_images, structure_text

TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
MAX_FRAMES = 4
_RETRIES = 2  # → 3 attempts total

_QUANTITY_RE = re.compile(
    r"(?<![\w/])(?:\d+(?:[.,]\d+)?|\d+\s*/\s*\d+|[½⅓⅔¼¾])\s*"
    r"(?:g|kg|mg|ml|cl|dl|l|litres?|c\.?\s?à\s?[sc]\.?|cs|cc|cuill?[eè]res?"
    r"|tasses?|verres?|pinc[ée]es?|gousses?|tranches?|sachets?"
    r"|tbsp|tsp|cups?|oz|lbs?)?(?![\w/])",
    re.IGNORECASE,
)


def caption_looks_complete(caption: str) -> bool:
    """Heuristic: a caption with ≥3 quantity-like tokens is the full recipe."""
    return len(_QUANTITY_RE.findall(caption or "")) >= 3


@lru_cache(maxsize=1)
def _cached_openai_client() -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI()


def get_openai_client() -> openai.AsyncOpenAI:
    """Indirection point so tests can monkeypatch the client."""
    return _cached_openai_client()


def _ydl_opts(extra: dict | None = None) -> dict:
    opts: dict = {"quiet": True, "noprogress": True, "socket_timeout": 20}
    cookies = os.environ.get("YTDLP_COOKIES_FILE")
    if cookies:
        opts["cookiefile"] = cookies
    if extra:
        opts.update(extra)
    return opts


def _extract_info(url: str) -> dict:
    """Metadata only (caption + thumbnail); 2 retries."""
    last: Exception | None = None
    for _ in range(_RETRIES + 1):
        try:
            with yt_dlp.YoutubeDL(_ydl_opts()) as ydl:
                return ydl.extract_info(url, download=False) or {}
        except Exception as exc:  # noqa: BLE001 — yt-dlp raises many types
            last = exc
    raise last if last else RuntimeError("yt-dlp returned nothing")


def _download_audio(url: str) -> Path | None:
    """Download the best audio stream to a temp file; None if unavailable."""
    tmpdir = Path(tempfile.mkdtemp(prefix="mealy-reel-"))
    opts = _ydl_opts(
        {
            "format": "bestaudio/best",
            "outtmpl": str(tmpdir / "audio.%(ext)s"),
        }
    )
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=True)
    files = sorted(tmpdir.glob("audio.*"))
    return files[0] if files else None


def _sample_frames(url: str, info: dict) -> list[bytes]:
    """Download the video and grab up to MAX_FRAMES evenly spaced JPEG frames."""
    if not shutil.which("ffmpeg"):
        return []
    tmpdir = Path(tempfile.mkdtemp(prefix="mealy-frames-"))
    opts = _ydl_opts({"format": "mp4/bestvideo*+bestaudio/best", "outtmpl": str(tmpdir / "video.%(ext)s")})
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=True)
    videos = sorted(tmpdir.glob("video.*"))
    if not videos:
        return []
    video = videos[0]
    duration = float(info.get("duration") or 30.0)
    frames: list[bytes] = []
    for i in range(MAX_FRAMES):
        ts = duration * (i + 1) / (MAX_FRAMES + 1)
        out = tmpdir / f"frame{i}.jpg"
        proc = subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{ts:.2f}", "-i", str(video), "-frames:v", "1", "-q:v", "3", str(out)],
            capture_output=True,
            timeout=60,
        )
        if proc.returncode == 0 and out.exists():
            frames.append(out.read_bytes())
    return frames


async def _transcribe(audio_path: Path) -> str:
    client = get_openai_client()
    with open(audio_path, "rb") as fh:
        result = await client.audio.transcriptions.create(model=TRANSCRIBE_MODEL, file=fh)
    return result.text


async def ingest_social(url: str) -> IngestResult:
    """Capture a reel → {verbatim caption/transcript/overlay, canonical}."""
    try:
        info = _extract_info(url)
    except Exception:
        return IngestResult(
            verbatim=Verbatim(kind="reel", url=url),
            canonical=None,
            needs_review=True,
        )

    caption = info.get("description") or ""
    thumbnail = info.get("thumbnail")
    image_urls = [thumbnail] if thumbnail else []

    if caption_looks_complete(caption):
        verbatim = Verbatim(kind="reel", url=url, caption=caption)
        canonical = await structure_text(verbatim)
        return IngestResult(
            verbatim=verbatim,
            canonical=canonical,
            needs_review=canonical.confidence < 0.6,
            image_urls=image_urls,
        )

    # caption alone is not enough — go after audio + on-screen text
    capture_failed = False

    transcript: str | None = None
    try:
        audio_path = _download_audio(url)
        if audio_path is not None:
            transcript = await _transcribe(audio_path)
        else:
            capture_failed = True
    except Exception:
        capture_failed = True

    overlay_text: str | None = None
    try:
        frames = _sample_frames(url, info)
        if frames:
            _, ocr = await structure_images(
                frames,
                ["image/jpeg"] * len(frames),
                hint="Transcribe the on-screen text overlays of these video frames.",
            )
            overlay_text = ocr or None
    except Exception:
        capture_failed = True

    verbatim = Verbatim(
        kind="reel",
        url=url,
        caption=caption or None,
        transcript=transcript,
        overlay_text=overlay_text,
    )

    if not any([caption, transcript, overlay_text]):
        return IngestResult(verbatim=verbatim, canonical=None, needs_review=True, image_urls=image_urls)

    canonical = await structure_text(verbatim)
    needs_review = capture_failed or canonical.confidence < 0.6
    return IngestResult(
        verbatim=verbatim,
        canonical=canonical,
        needs_review=needs_review,
        image_urls=image_urls,
    )

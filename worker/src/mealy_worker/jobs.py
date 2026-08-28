"""Background capture job runner (true background capture).

The app inserts a ``capture_jobs`` row and POSTs ``/jobs/run``; this module
fetches the job, runs the same ingestion pipeline as the synchronous routes,
and persists the recipe itself with the service role. The row mapping
mirrors the app's ``persistIngestResult`` (app/src/lib/worker.ts) for the
no-local-media case, and the translation pass mirrors ``translateAndStore``
(app/src/lib/translations.ts).

Status transitions: pending → processing → done | failed. A failed job can
be re-queued (the app resets it to pending and pings again).
"""

from __future__ import annotations

from datetime import datetime, timezone

from .db import SupabaseDb
from .ingest.media import ingest_images, ingest_pdf
from .ingest.social import ingest_social
from .ingest.url import ingest_url
from .models import IngestResult, Verbatim
from .structure import structure_text
from .translate import TranslateRequest, translate_recipe

MEDIA_BUCKET = "recipe-media"

ERROR_NO_RECIPE = "no_recipe"


def get_db() -> SupabaseDb:
    """Indirection point so tests can monkeypatch the client."""
    return SupabaseDb()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def recipe_rows(
    result: IngestResult,
    *,
    household_id: str,
    created_by: str,
    source_url: str | None,
    media_paths: list[str] | None = None,
) -> tuple[dict, dict, list[dict]]:
    """Pure mirror of the app's persistIngestResult row shapes: recipes +
    source + gallery rows. ``media_paths`` are Storage paths of uploaded
    photos/PDF pages; like the app, they lead the gallery and become the
    cover when no remote image exists.

    The verbatim layer passes through byte-identical (spec §3.1): one
    ``model_dump`` of the exact object the pipeline produced.
    """
    canonical = result.canonical
    if canonical is None:
        raise ValueError("recipe_rows requires a canonical recipe")
    media_paths = media_paths or []
    remote_images = [u for u in result.image_urls if u.startswith("https://")]
    gallery = media_paths + remote_images
    recipe = {
        "household_id": household_id,
        "title": canonical.title,
        "language": canonical.language,
        "servings": canonical.servings,
        "prep_minutes": canonical.prep_minutes,
        "cook_minutes": canonical.cook_minutes,
        "dish_type": canonical.dish_type,
        "tags": canonical.tags,
        "ingredients": [i.model_dump() for i in canonical.ingredients],
        "steps": canonical.steps,
        "nutrition": canonical.nutrition,
        "cover_image_path": remote_images[0] if remote_images else (media_paths[0] if media_paths else None),
        "needs_review": result.needs_review,
        "created_by": created_by,
    }
    source = {
        "kind": result.verbatim.kind,
        "url": result.verbatim.url or source_url,
        "verbatim": result.verbatim.model_dump(),
        "media_paths": media_paths,
    }
    images = [
        {"storage_path": path, "position": i, "is_cover": i == 0}
        for i, path in enumerate(gallery)
    ]
    return recipe, source, images


async def _ingest(db: SupabaseDb, job: dict) -> IngestResult:
    kind = job["kind"]
    payload = job["input"]
    if kind == "social":
        return await ingest_social(payload)
    if kind == "url":
        return await ingest_url(payload)
    if kind in ("images", "pdf"):
        media = job.get("media") or []
        if not media:
            raise ValueError("media job has no uploaded files")
        blobs = [await db.download(MEDIA_BUCKET, m["path"]) for m in media]
        if kind == "pdf":
            return await ingest_pdf(blobs[0])
        return await ingest_images(blobs, [m.get("mime") or "image/jpeg" for m in media])
    verbatim = Verbatim(kind="paste", pasted=payload)
    canonical = await structure_text(verbatim)
    return IngestResult(
        verbatim=verbatim,
        canonical=canonical,
        needs_review=canonical.confidence < 0.6,
    )


async def _store_translations(db: SupabaseDb, recipe_id: str, recipe: dict) -> None:
    """Best-effort derived translation layer; the caller swallows failures."""
    reply = await translate_recipe(
        TranslateRequest(
            title=recipe["title"],
            language=recipe["language"],
            ingredients=recipe["ingredients"],
            steps=recipe["steps"],
        )
    )
    rows = [
        {
            "recipe_id": recipe_id,
            "locale": locale,
            "title": t.title,
            "ingredients": [i.model_dump() for i in t.ingredients],
            "steps": t.steps,
            "translated_at": _now(),
        }
        for locale, t in reply.translations.items()
    ]
    if rows:
        await db.insert("recipe_translations", rows)
    if reply.source_language and reply.source_language != recipe["language"]:
        await db.update("recipes", {"id": recipe_id}, {"language": reply.source_language})


async def _mark(db: SupabaseDb, job_id: str, values: dict) -> None:
    await db.update("capture_jobs", {"id": job_id}, {**values, "updated_at": _now()})


async def run_capture_job(job_id: str, user_id: str) -> None:
    """Process one job end to end. Never raises — failures land on the row."""
    db = get_db()
    jobs = await db.select("capture_jobs", {"id": job_id})
    if not jobs:
        return
    job = jobs[0]
    if job["status"] not in ("pending", "failed"):
        return
    # The service role bypasses RLS, so membership is enforced here: the
    # caller must belong to the job's household.
    members = await db.select(
        "household_members",
        {"household_id": job["household_id"], "user_id": user_id},
        "user_id",
    )
    if not members:
        return

    # Atomic claim: the app re-pings jobs that look stuck, so two tasks may
    # race here — only the one whose conditional update returns a row runs.
    claimed = await db.update(
        "capture_jobs",
        {"id": job_id, "status": ("pending", "failed")},
        {"status": "processing", "error": None, "updated_at": _now()},
        returning=True,
    )
    if not claimed:
        return
    try:
        result = await _ingest(db, job)
        if result.canonical is None:
            await _mark(db, job_id, {"status": "failed", "error": ERROR_NO_RECIPE})
            return
        recipe, source, images = recipe_rows(
            result,
            household_id=job["household_id"],
            created_by=job["created_by"],
            source_url=job["input"] if job["kind"] in ("url", "social") else None,
            media_paths=[m["path"] for m in (job.get("media") or [])],
        )
        inserted = await db.insert("recipes", recipe, returning=True)
        recipe_id = inserted[0]["id"]
        await db.insert("recipe_sources", {**source, "recipe_id": recipe_id})
        if images:
            await db.insert("recipe_images", [{**img, "recipe_id": recipe_id} for img in images])
        # Done as soon as the recipe exists — the library card clears now.
        # Translations are a derived layer and must never hold the capture up
        # (parity with the app's queueRecipeTranslation fire-and-forget).
        await _mark(db, job_id, {"status": "done", "recipe_id": recipe_id})
        try:
            await _store_translations(db, recipe_id, {**recipe, "ingredients": result.canonical.ingredients})
        except Exception:  # noqa: BLE001 — translations never fail the capture
            pass
    except Exception as exc:  # noqa: BLE001 — surface anything on the job row
        await _mark(db, job_id, {"status": "failed", "error": str(exc)[:500]})

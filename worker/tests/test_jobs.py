"""Background capture job runner (jobs.py)."""

from __future__ import annotations

import pytest

from mealy_worker import jobs
from mealy_worker.models import CanonicalRecipe, Ingredient, IngestResult, Verbatim


def _result(**overrides) -> IngestResult:
    base = dict(
        verbatim=Verbatim(kind="reel", url="https://instagram.com/reel/x", caption="hi"),
        canonical=CanonicalRecipe(
            title="Tarte",
            language="fr",
            servings=4,
            ingredients=[Ingredient(raw="200 g farine", name="farine", quantity=200, unit="g")],
            steps=["Mélanger."],
            confidence=0.9,
        ),
        needs_review=False,
        image_urls=["https://cdn.example.com/cover.jpg", "file:///local.jpg"],
    )
    base.update(overrides)
    return IngestResult(**base)


class TestRecipeRows:
    def test_maps_canonical_to_rows(self):
        recipe, source, images = jobs.recipe_rows(
            _result(), household_id="hh-1", created_by="u-1", source_url="https://in.put"
        )
        assert recipe["household_id"] == "hh-1"
        assert recipe["created_by"] == "u-1"
        assert recipe["title"] == "Tarte"
        assert recipe["ingredients"][0]["raw"] == "200 g farine"
        # only https urls make the gallery; the first is the cover
        assert recipe["cover_image_path"] == "https://cdn.example.com/cover.jpg"
        assert images == [
            {"storage_path": "https://cdn.example.com/cover.jpg", "position": 0, "is_cover": True}
        ]
        # verbatim passes through as one model_dump, url from the verbatim
        assert source["url"] == "https://instagram.com/reel/x"
        assert source["verbatim"]["caption"] == "hi"
        assert source["media_paths"] == []

    def test_source_url_fallback_when_verbatim_lacks_one(self):
        result = _result(verbatim=Verbatim(kind="paste", pasted="text"))
        _, source, _ = jobs.recipe_rows(
            result, household_id="hh", created_by="u", source_url="https://fallback"
        )
        assert source["url"] == "https://fallback"

    def test_requires_canonical(self):
        with pytest.raises(ValueError):
            jobs.recipe_rows(
                _result(canonical=None), household_id="hh", created_by="u", source_url=None
            )


class FakeDb:
    """Records writes; serves canned rows for selects."""

    def __init__(self, job: dict | None, member: bool = True):
        self.job = job
        self.member = member
        self.inserts: list[tuple[str, object]] = []
        self.updates: list[tuple[str, dict, dict]] = []

    async def select(self, table, match, columns="*"):
        if table == "capture_jobs":
            return [self.job] if self.job else []
        if table == "household_members":
            return [{"user_id": "u-1"}] if self.member else []
        return []

    async def insert(self, table, rows, returning=False):
        self.inserts.append((table, rows))
        return [{"id": "recipe-1"}] if returning else []

    async def update(self, table, match, values, returning=False):
        self.updates.append((table, match, values))
        if not returning:
            return []
        # the claim: only succeeds while the stored status still allows it
        allowed = match.get("status")
        if allowed is not None and self.job and self.job["status"] not in allowed:
            return []
        if self.job:
            self.job["status"] = values.get("status", self.job["status"])
        return [dict(self.job)] if self.job else []

    async def delete(self, table, match):
        pass

    async def download(self, bucket, path):
        return b"bytes:" + path.encode()


JOB = {
    "id": "job-1",
    "household_id": "hh-1",
    "created_by": "u-1",
    "kind": "social",
    "input": "https://instagram.com/reel/x",
    "status": "pending",
}


@pytest.fixture
def fake_db(monkeypatch):
    db = FakeDb(dict(JOB))
    monkeypatch.setattr(jobs, "get_db", lambda: db)
    # never hit the real translation model in tests
    monkeypatch.setattr(jobs, "_store_translations", _no_translations)
    return db


async def _no_translations(db, recipe_id, recipe):
    return None


async def test_happy_path_persists_and_marks_done(fake_db, monkeypatch):
    async def fake_ingest(db, job):
        assert (job["kind"], job["input"]) == ("social", JOB["input"])
        return _result()

    monkeypatch.setattr(jobs, "_ingest", fake_ingest)
    await jobs.run_capture_job("job-1", "u-1")

    tables = [t for t, _ in fake_db.inserts]
    assert tables == ["recipes", "recipe_sources", "recipe_images"]
    statuses = [v.get("status") for _, _, v in fake_db.updates if v.get("status")]
    assert statuses == ["processing", "done"]
    done = fake_db.updates[-1][2]
    assert done["recipe_id"] == "recipe-1"


async def test_no_canonical_marks_failed_no_recipe(fake_db, monkeypatch):
    async def fake_ingest(db, job):
        return _result(canonical=None)

    monkeypatch.setattr(jobs, "_ingest", fake_ingest)
    await jobs.run_capture_job("job-1", "u-1")

    assert fake_db.inserts == []
    assert fake_db.updates[-1][2]["status"] == "failed"
    assert fake_db.updates[-1][2]["error"] == jobs.ERROR_NO_RECIPE


async def test_pipeline_crash_marks_failed(fake_db, monkeypatch):
    async def fake_ingest(db, job):
        raise RuntimeError("boom")

    monkeypatch.setattr(jobs, "_ingest", fake_ingest)
    await jobs.run_capture_job("job-1", "u-1")

    assert fake_db.updates[-1][2]["status"] == "failed"
    assert "boom" in fake_db.updates[-1][2]["error"]


async def test_non_member_is_rejected(monkeypatch):
    db = FakeDb(dict(JOB), member=False)
    monkeypatch.setattr(jobs, "get_db", lambda: db)
    await jobs.run_capture_job("job-1", "intruder")
    assert db.updates == [] and db.inserts == []


async def test_done_jobs_are_not_reprocessed(monkeypatch):
    db = FakeDb({**JOB, "status": "done"})
    monkeypatch.setattr(jobs, "get_db", lambda: db)
    await jobs.run_capture_job("job-1", "u-1")
    assert db.updates == [] and db.inserts == []


async def test_media_job_downloads_and_ingests_images(fake_db, monkeypatch):
    fake_db.job.update(
        {
            "kind": "images",
            "input": "Photos (2)",
            "media": [
                {"path": "hh-1/jobs/f1/0", "mime": "image/jpeg"},
                {"path": "hh-1/jobs/f1/1", "mime": "image/png"},
            ],
        }
    )
    seen = {}

    async def fake_ingest_images(blobs, mimes):
        seen["blobs"], seen["mimes"] = blobs, mimes
        return _result(
            verbatim=Verbatim(kind="photo", ocr_text="200 g farine"), image_urls=[]
        )

    monkeypatch.setattr(jobs, "ingest_images", fake_ingest_images)
    await jobs.run_capture_job("job-1", "u-1")

    assert seen["blobs"] == [b"bytes:hh-1/jobs/f1/0", b"bytes:hh-1/jobs/f1/1"]
    assert seen["mimes"] == ["image/jpeg", "image/png"]
    # the uploaded files become the source media, gallery, and cover
    recipe = fake_db.inserts[0][1]
    source = fake_db.inserts[1][1]
    gallery = fake_db.inserts[2][1]
    assert recipe["cover_image_path"] == "hh-1/jobs/f1/0"
    assert source["media_paths"] == ["hh-1/jobs/f1/0", "hh-1/jobs/f1/1"]
    assert source["url"] is None
    assert [g["storage_path"] for g in gallery] == ["hh-1/jobs/f1/0", "hh-1/jobs/f1/1"]
    assert fake_db.updates[-1][2]["status"] == "done"


async def test_media_job_without_files_fails(fake_db, monkeypatch):
    fake_db.job.update({"kind": "pdf", "input": "menu.pdf", "media": []})
    await jobs.run_capture_job("job-1", "u-1")
    assert fake_db.updates[-1][2]["status"] == "failed"

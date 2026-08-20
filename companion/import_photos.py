"""Mealy Mac companion — import recipes from a shared Photos album.

Reads photos from an iCloud shared album, groups shots taken close together
into one recipe (spec §3.2), runs each group through the worker's vision
ingestion (spec §3.3), and persists recipe + verbatim source + images to
Supabase as the signed-in user (RLS applies; no service key involved).

Usage:
  uv run --project ../worker python import_photos.py --album Receptes --limit 30
  uv run --project ../worker python import_photos.py --album Receptes          # full run

Env (from ../worker/.env): ANTHROPIC_API_KEY. Plus MEALY_EMAIL / MEALY_PASSWORD
for the Supabase sign-in, MEALY_SUPABASE_URL, MEALY_SUPABASE_ANON_KEY.

A manifest (processed_groups.jsonl) makes re-runs idempotent: a group whose
photo UUIDs were already imported is skipped.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker" / "src"))
from mealy_worker.ingest.media import ingest_images  # noqa: E402

GROUP_GAP_SECONDS = 180
MAX_EDGE_PX = 1568
MANIFEST = Path(__file__).parent / "processed_groups.jsonl"
LLM_CONCURRENCY = 4


def load_env() -> None:
    env_file = Path(__file__).resolve().parent.parent / "worker" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k, v)


def album_photos(album: str) -> list:
    import osxphotos

    db = osxphotos.PhotosDB()
    for info in db.album_info_shared:
        if info.title.lower() == album.lower():
            photos = [p for p in info.photos if not p.ismovie]
            return sorted(photos, key=lambda p: p.date)
    raise SystemExit(f"Shared album {album!r} not found")


def group_by_time(photos: list) -> list[list]:
    groups: list[list] = []
    for p in photos:
        if groups and (p.date - groups[-1][-1].date).total_seconds() <= GROUP_GAP_SECONDS:
            groups[-1].append(p)
        else:
            groups.append([p])
    return groups


def group_key(group: list) -> str:
    return hashlib.sha256("|".join(p.uuid for p in group).encode()).hexdigest()[:16]


def local_path(photo) -> str | None:
    if photo.path:
        return photo.path
    if photo.path_derivatives:
        return max(photo.path_derivatives, key=lambda f: Path(f).stat().st_size)
    return None


def to_jpeg(path: str, out_dir: str) -> bytes:
    """Convert/downscale to JPEG ≤ MAX_EDGE_PX using macOS sips."""
    out = Path(out_dir) / (hashlib.sha256(path.encode()).hexdigest()[:12] + ".jpg")
    subprocess.run(
        ["sips", "-s", "format", "jpeg", "-Z", str(MAX_EDGE_PX), path, "--out", str(out)],
        check=True, capture_output=True,
    )
    return out.read_bytes()


class Supa:
    def __init__(self) -> None:
        self.url = os.environ["MEALY_SUPABASE_URL"].rstrip("/")
        self.anon = os.environ["MEALY_SUPABASE_ANON_KEY"]
        self.client = httpx.Client(timeout=60)
        r = self.client.post(
            f"{self.url}/auth/v1/token?grant_type=password",
            headers={"apikey": self.anon},
            json={"email": os.environ["MEALY_EMAIL"], "password": os.environ["MEALY_PASSWORD"]},
        )
        r.raise_for_status()
        self.token = r.json()["access_token"]
        self.uid = r.json()["user"]["id"]
        self.headers = {"apikey": self.anon, "Authorization": f"Bearer {self.token}"}
        r = self.client.get(
            f"{self.url}/rest/v1/household_members?select=household_id&user_id=eq.{self.uid}",
            headers=self.headers,
        )
        r.raise_for_status()
        self.household_id = r.json()[0]["household_id"]

    def insert(self, table: str, row: dict) -> dict:
        r = self.client.post(
            f"{self.url}/rest/v1/{table}",
            headers={**self.headers, "Prefer": "return=representation"},
            json=row,
        )
        r.raise_for_status()
        return r.json()[0]

    def upload(self, path: str, data: bytes) -> None:
        r = self.client.post(
            f"{self.url}/storage/v1/object/recipe-media/{path}",
            headers={**self.headers, "Content-Type": "image/jpeg"},
            content=data,
        )
        r.raise_for_status()


def already_done() -> set[str]:
    if not MANIFEST.exists():
        return set()
    return {json.loads(l)["key"] for l in MANIFEST.read_text().splitlines() if l.strip()}


async def process_group(supa: Supa, group: list, tmp: str, sem: asyncio.Semaphore) -> str:
    key = group_key(group)
    paths = [lp for p in group if (lp := local_path(p))]
    if not paths:
        return f"[skip {key}] no local files"
    images = [to_jpeg(p, tmp) for p in paths]
    async with sem:
        result = await ingest_images(images, ["image/jpeg"] * len(images))
    c = result.canonical
    recipe = supa.insert("recipes", {
        "household_id": supa.household_id,
        "title": (c.title if c and c.title else "Untitled recipe"),
        "language": (c.language if c else "fr") or "fr",
        "servings": c.servings if c else None,
        "prep_minutes": c.prep_minutes if c else None,
        "cook_minutes": c.cook_minutes if c else None,
        "dish_type": c.dish_type if c else None,
        "tags": c.tags if c else [],
        "ingredients": [i.model_dump() for i in c.ingredients] if c else [],
        "steps": c.steps if c else [],
        "needs_review": result.needs_review or c is None,
        "created_by": supa.uid,
    })
    media_paths = []
    for idx, data in enumerate(images):
        path = f"{supa.household_id}/{recipe['id']}/{idx}.jpg"
        supa.upload(path, data)
        media_paths.append(path)
        supa.insert("recipe_images", {
            "recipe_id": recipe["id"], "storage_path": path,
            "position": idx, "is_cover": idx == 0,
        })
    supa.client.patch(
        f"{supa.url}/rest/v1/recipes?id=eq.{recipe['id']}",
        headers=supa.headers, json={"cover_image_path": media_paths[0]},
    ).raise_for_status()
    supa.insert("recipe_sources", {
        "recipe_id": recipe["id"], "kind": "photo",
        "verbatim": result.verbatim.model_dump(),
        "media_paths": media_paths,
    })
    with MANIFEST.open("a") as f:
        f.write(json.dumps({"key": key, "recipe_id": recipe["id"],
                            "title": recipe["title"], "photos": len(group)}) + "\n")
    flag = " [needs review]" if (result.needs_review or c is None) else ""
    return f"[ok {key}] {recipe['title']} ({len(group)} photos){flag}"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--album", default="Receptes")
    ap.add_argument("--limit", type=int, default=None, help="max photo groups this run")
    args = ap.parse_args()

    load_env()
    photos = album_photos(args.album)
    groups = group_by_time(photos)
    done = already_done()
    todo = [g for g in groups if group_key(g) not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(photos)} photos → {len(groups)} groups; {len(done)} done; processing {len(todo)}")

    supa = Supa()
    sem = asyncio.Semaphore(LLM_CONCURRENCY)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(0, len(todo), 8):
            batch = todo[i : i + 8]
            results = await asyncio.gather(
                *(process_group(supa, g, tmp, sem) for g in batch),
                return_exceptions=True,
            )
            for g, res in zip(batch, results):
                print(res if isinstance(res, str) else f"[error {group_key(g)}] {res!r}")


if __name__ == "__main__":
    asyncio.run(main())

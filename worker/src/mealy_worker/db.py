"""Service-role PostgREST client (background capture jobs).

The synchronous capture routes stay stateless — the app persists their
results itself. Only the background job runner (jobs.py) writes to the
database, using the service role key. That role bypasses RLS, so jobs.py
must enforce household membership explicitly before touching anything.

Env: ``MEALY_SUPABASE_URL`` (falls back to ``SUPABASE_URL``) and
``SUPABASE_SERVICE_ROLE_KEY``.
"""

from __future__ import annotations

import os

import httpx

_TIMEOUT = 15.0


class SupabaseDb:
    def __init__(self) -> None:
        base = os.environ.get("MEALY_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not base or not key:
            raise RuntimeError(
                "Background capture needs MEALY_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
            )
        self._rest = f"{base.rstrip('/')}/rest/v1"
        self._storage = f"{base.rstrip('/')}/storage/v1"
        self._headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    async def select(self, table: str, match: dict, columns: str = "*") -> list[dict]:
        params = {"select": columns, **{k: f"eq.{v}" for k, v in match.items()}}
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(
                f"{self._rest}/{table}", params=params, headers=self._headers
            )
            response.raise_for_status()
            return response.json()

    async def insert(
        self, table: str, rows: dict | list[dict], returning: bool = False
    ) -> list[dict]:
        headers = {
            **self._headers,
            "Prefer": "return=representation" if returning else "return=minimal",
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(f"{self._rest}/{table}", json=rows, headers=headers)
            response.raise_for_status()
            return response.json() if returning else []

    async def update(
        self, table: str, match: dict, values: dict, returning: bool = False
    ) -> list[dict]:
        """PATCH matching rows. Tuple/list match values become ``in.(...)``
        filters; with ``returning`` the updated rows come back, which makes a
        conditional update usable as an atomic claim."""
        params = {
            k: f"in.({','.join(v)})" if isinstance(v, (tuple, list)) else f"eq.{v}"
            for k, v in match.items()
        }
        headers = {
            **self._headers,
            "Prefer": "return=representation" if returning else "return=minimal",
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.patch(
                f"{self._rest}/{table}", params=params, json=values, headers=headers
            )
            response.raise_for_status()
            return response.json() if returning else []

    async def download(self, bucket: str, path: str) -> bytes:
        """Fetch an object from Storage (service role bypasses policies)."""
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                f"{self._storage}/object/{bucket}/{path}", headers=self._headers
            )
            response.raise_for_status()
            return response.content

    async def delete(self, table: str, match: dict) -> None:
        params = {k: f"eq.{v}" for k, v in match.items()}
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.delete(
                f"{self._rest}/{table}", params=params, headers=self._headers
            )
            response.raise_for_status()

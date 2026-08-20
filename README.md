# Mealy

Private meal planner for the household and a small circle of family and friends. Captures recipes from anywhere (URLs, Instagram reels, photos, PDFs), stores the original text verbatim, plans lunch + dinner weekly per person, builds a grams-first shopping list aimed at Mon Marché, and serves a dedicated Spanish cooking page for the household's employee.

The authoritative product & technical spec is [`docs/spec.md`](docs/spec.md). Implementation plans live in [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Layout

| Path | What it is |
|---|---|
| `app/` | Expo / React Native mobile app (expo-router, TypeScript) |
| `worker/` | Python 3.12 FastAPI ingestion & AI worker (`recipe-scrapers`, `yt-dlp`, Claude) |
| `supabase/` | Database migrations (Postgres + RLS on Supabase managed) |
| `companion/` | (Phase 4) Mac Photos-album import job |
| `docs/` | Spec and plans |

## Dev quickstart

- **Worker:** `cd worker && uv sync && uv run pytest` · run: `uv run uvicorn mealy_worker.main:app --reload` (env: see `worker/.env.example`)
- **App:** `cd app && npm install && npx expo start` (env: see `app/.env.example`)
- **DB:** migrations in `supabase/migrations/`, applied to the managed project via MCP/CLI.

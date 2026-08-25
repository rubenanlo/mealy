# Mealy

Private meal planner for the household and a small circle of family and friends. Captures
recipes from anywhere (URLs, Instagram reels, photos, PDFs), stores the **original text
verbatim** alongside a derived **canonical** form, plans lunch + dinner weekly per person,
builds a grams-first shopping list aimed at Mon Marché, and serves a public Spanish cooking
page for the household's employee. Authoritative product/tech spec: `docs/spec.md`. Plans:
`docs/superpowers/plans/`.

## The four surfaces

- `app/` — Expo (React Native) mobile app, TypeScript, expo-router. This is the product.
- `worker/` — Python 3.12 FastAPI ingestion + AI worker (recipe-scrapers, yt-dlp, Claude, OpenAI).
- `supabase/` — Postgres schema (migrations, RLS), plus Deno **edge functions**.
- `workers/employee-menu-proxy/` — Cloudflare Worker that fronts the `employee-menu` edge function.

There is **no CI** (`.github` absent) and no CMS. Deploys are all manual (see below).

## Commands (canonical package manager for `app/` is pnpm)

- **App:** `cd app && pnpm install`; dev `pnpm start` (or `pnpm ios` / `pnpm android` / `pnpm web`).
  Checks: `pnpm test` (jest-expo), `pnpm typecheck` (tsc --noEmit), `pnpm lint`.
  `pnpm start:backend` runs the Python worker from inside `app/`.
- **Worker:** `cd worker && uv sync`; test `uv run pytest`;
  run `uv run --env-file .env uvicorn mealy_worker.main:app --host 0.0.0.0` (add `--reload` for dev).
- **Proxy:** `cd workers/employee-menu-proxy && npx wrangler dev`; deploy `npx wrangler deploy`.
- **DB / edge functions:** migrations via `supabase db push` **or** the Supabase MCP
  `apply_migration`; functions via `supabase functions deploy <name>`.

There is no "build"/"preview" step for the mobile app in this repo — EAS is not configured;
`pnpm start` (Expo Go) is how you run it. `app/dist/` is a stale web export, not a deploy target.

## Conventions that differ from defaults

- **App source lives in `app/src/`**, not the Expo default root. Routes are under
  `app/src/app/` (expo-router); shared code in `app/src/lib/`, components in `app/src/components/`.
- `typedRoutes` and `reactCompiler` experiments are **on** (`app.json`).
- Ingestion always produces `{verbatim, canonical}`: the scraped/pasted text is preserved
  literally and the canonical structured form is derived from it. Don't collapse the two.
- Two similarly named dirs: `worker/` (Python FastAPI) vs `workers/` (Cloudflare). Don't confuse them.

## Pitfalls

- **Expo SDK 54 is pinned** for Expo Go compatibility. Do **not** bump Expo/React Native
  versions. Read the v54 docs (https://docs.expo.dev/versions/v54.0.0/) before writing app code.
- **Worker Python is pinned `>=3.12,<3.13`** — 3.13 will not resolve.
- **Migrations are append-only, numbered SQL** (`supabase/migrations/NNNN_*.sql`). A schema
  change is not live until you run a separate deploy step (`supabase db push` / MCP `apply_migration`).
- The employee page **must** be served through the Cloudflare proxy: `*.supabase.co` refuses to
  render unauthenticated HTML (rewrites Content-Type to text/plain + nosniff). The upstream
  Supabase URL is **hardcoded** in `workers/employee-menu-proxy/src/index.js` — update it there.
- The employee page has **no auth**: the share token in the URL *is* the credential.
- Edge functions use the Supabase runtime's auto-injected `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY`; don't hardcode those.
- `app/` has both a `package-lock.json` and a `pnpm-lock.yaml`. **pnpm is canonical** — the
  `package-lock.json` is stale; don't feed npm changes back into it.
- Generated / do-not-edit: `app/dist/`, `app/.expo/`, `worker/.venv/`, `**/__pycache__/`,
  `companion/*.jsonl` (import run logs).

## Environment variables (names only — values live in gitignored `.env` files)

- **App** (`EXPO_PUBLIC_*`, bundled into the client): `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_WORKER_URL`,
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
- **Worker:** `MEALY_SUPABASE_URL` (falls back to `SUPABASE_URL`), `SUPABASE_JWT_SECRET`,
  `YTDLP_COOKIES_FILE`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (the last two read implicitly by
  the Anthropic/OpenAI SDKs).
- **Edge functions:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (injected by Supabase).

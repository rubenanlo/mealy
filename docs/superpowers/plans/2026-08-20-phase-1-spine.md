# Mealy Phase 1 — "The Spine" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1 spine: Supabase backend (schema + RLS + invite-only auth), a Python ingestion worker (URL / paste / reel / photo / PDF → one LLM structuring brain, verbatim two-layer output), and the Expo app (capture, library, recipe detail with original-source view, manual 7×2 weekly planner with per-person entries and assigned cook, settings).

**Architecture:** The app talks to Supabase directly for all CRUD (RLS-scoped) and calls the worker only for *capture* (turn raw material into `{verbatim, canonical}`); the app then persists both layers itself, so the worker stays stateless and holds no DB credentials. LLM keys live only in the worker.

**Tech Stack:** Expo SDK 52+/React Native/expo-router/TypeScript; Supabase (Postgres 15 + Auth + Storage + RLS); Python 3.12, FastAPI, `recipe-scrapers`, `yt-dlp`, Anthropic SDK (Claude Haiku 4.5 for structuring), OpenAI transcription API; `uv` for Python env; pytest; jest-expo.

**Spec:** `docs/spec.md` (authoritative; overrides the research report where they differ).

## Global Constraints

- Python 3.12 pinned for the worker (`requires-python = ">=3.12,<3.13"`); Node ≥ 20 for the app.
- **Verbatim rule (spec §3.1):** captured text is stored byte-for-byte and never edited by any code path. The structured layer is derived and re-generatable; every structured ingredient keeps its `raw` string.
- **LLM keys server-side only** — never in the Expo app bundle or Supabase client config.
- All tables RLS-enabled, household-scoped; no open signup (invite-only).
- Structuring model: `claude-haiku-4-5`. Worker env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_JWT_SECRET`.
- App copy: French UI labels are fine to hardcode for now; no i18n framework in Phase 1.
- Commit after every green test cycle; conventional-commit messages; every commit ends with the Claude Code co-author trailer.

## File Structure

```
mealy/
  docs/spec.md                              # authoritative spec (exists)
  supabase/migrations/0001_core.sql         # Task 2
  worker/
    pyproject.toml                          # Task 3
    src/mealy_worker/
      __init__.py
      models.py                             # Task 3 — canonical Recipe/Verbatim pydantic models
      structure.py                          # Task 4 — the one LLM structuring brain
      ingest/__init__.py
      ingest/url.py                         # Task 5 — JSON-LD / recipe-scrapers / readable-text
      ingest/social.py                      # Task 6 — yt-dlp caption+audio+frames
      ingest/media.py                       # Task 7 — photos & PDFs → vision
      auth.py                               # Task 8 — Supabase JWT verification
      main.py                               # Task 8 — FastAPI app + routes
    tests/ (mirrors src)
  app/                                      # Task 9 — Expo project root
    app/(auth)/sign-in.tsx                  # Task 10
    app/(tabs)/_layout.tsx                  # Task 10
    app/(tabs)/library/index.tsx            # Task 12
    app/(tabs)/library/[id].tsx             # Task 12
    app/(tabs)/plan/index.tsx               # Task 13
    app/(tabs)/settings/index.tsx           # Task 14
    app/capture.tsx                         # Task 11
    src/lib/supabase.ts                     # Task 9
    src/lib/theme.ts                        # Task 9
    src/lib/worker.ts                       # Task 11 — worker API client
    src/lib/plan.ts                         # Task 13 — pure slot/coverage logic (unit-tested)
    src/lib/quotas.ts                       # Task 14 — pure quota progress logic (unit-tested)
```

---

### Task 1: Repo scaffold

**Files:** Create `README.md`, `.gitignore` (root).

- [ ] Step 1: Write `README.md` — one paragraph (Mealy: private household meal planner; see `docs/spec.md`), layout table (`app/`, `worker/`, `supabase/`, `docs/`), and dev quickstart placeholders per package.
- [ ] Step 2: Write root `.gitignore`: `node_modules/`, `.expo/`, `dist/`, `.venv/`, `__pycache__/`, `.pytest_cache/`, `*.egg-info/`, `.env`, `.env.*`, `!.env.example`, `.DS_Store`, `ios/`, `android/`.
- [ ] Step 3: `git add -A && git commit -m "chore: scaffold Mealy monorepo with spec and plan"`.

### Task 2: Supabase project + core schema + RLS

**Files:** Create `supabase/migrations/0001_core.sql`.

**Interfaces — Produces (later tasks rely on these exact names):** tables `households`, `persons`, `household_members`, `invites`, `recipes`, `recipe_sources`, `recipe_images`, `meal_plans`, `plan_entries`, `events`; helper `fn my_household_ids() returns setof uuid`; enums `meal_slot ('lunch','dinner')`, `cook_type ('family','employee')`, `source_kind ('url','reel','photo','pdf','paste')`, `plan_status ('draft','approved')`.

- [ ] Step 1: Create the Supabase project via MCP (org → `get_cost` → `confirm_cost` → `create_project`, name `mealy`, region `eu-west-3` or nearest EU). Record project ref in README.
- [ ] Step 2: Write `supabase/migrations/0001_core.sql`:

```sql
create type meal_slot as enum ('lunch','dinner');
create type cook_type as enum ('family','employee');
create type source_kind as enum ('url','reel','photo','pdf','paste');
create type plan_status as enum ('draft','approved');

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  other_requirements text not null default '',
  created_at timestamptz not null default now()
);

create table persons (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  is_employee boolean not null default false,
  diet_profile jsonb not null default '{}',      -- spec §2 DietProfile shape
  other_requirements text not null default '',
  created_at timestamptz not null default now()
);

create table household_members (                  -- user account ↔ household/person link
  user_id uuid primary key references auth.users on delete cascade,
  household_id uuid not null references households on delete cascade,
  person_id uuid references persons on delete set null,
  role text not null default 'member' check (role in ('owner','member'))
);

create table invites (
  email text primary key,
  household_id uuid not null references households on delete cascade,
  person_id uuid references persons on delete set null,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now()
);

-- invite-only: on signup, attach the user to their invited household
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invites%rowtype;
begin
  select * into inv from invites where email = new.email;
  if found then
    insert into household_members(user_id, household_id, person_id, role)
    values (new.id, inv.household_id, inv.person_id, inv.role);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create table recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  title text not null,
  language text not null default 'fr',
  servings int,
  prep_minutes int,
  cook_minutes int,
  dish_type text,
  tags text[] not null default '{}',
  ingredients jsonb not null default '[]',        -- [{raw,quantity,unit,name,group,fodmap}]
  steps jsonb not null default '[]',              -- [text]
  nutrition jsonb,
  seasonality real[],                             -- 12-month curve, null until Phase 3
  cover_image_path text,
  needs_review boolean not null default false,
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipe_sources (                     -- VERBATIM LAYER — immutable
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes on delete cascade,
  kind source_kind not null,
  url text,
  verbatim jsonb not null,                        -- {json_ld?, page_text?, caption?, transcript?, overlay_text?, ocr_text?, pasted?}
  media_paths text[] not null default '{}',       -- storage paths of originals
  captured_at timestamptz not null default now()
);
create or replace function forbid_source_mutation() returns trigger
language plpgsql as $$ begin raise exception 'recipe_sources is immutable'; end $$;
create trigger recipe_sources_immutable before update on recipe_sources
  for each row execute function forbid_source_mutation();

create table recipe_images (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes on delete cascade,
  storage_path text not null,
  position int not null default 0,
  is_cover boolean not null default false
);

create table meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  week_start date not null,                       -- always a Monday
  status plan_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (household_id, week_start)
);

create table plan_entries (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans on delete cascade,
  day smallint not null check (day between 0 and 6),
  slot meal_slot not null,
  recipe_id uuid not null references recipes,
  person_ids uuid[] not null default '{}',        -- empty = whole household
  assigned_cook cook_type not null default 'family',
  position int not null default 0
);

create table events (                             -- preference/training signal log
  id bigint generated always as identity primary key,
  household_id uuid not null references households on delete cascade,
  person_id uuid references persons,
  recipe_id uuid references recipes,
  type text not null,                             -- cooked|planned|swapped_out|rated|featured_tap|...
  meta jsonb not null default '{}',
  at timestamptz not null default now()
);

create or replace function my_household_ids() returns setof uuid
language sql security definer stable set search_path = public as
$$ select household_id from household_members where user_id = auth.uid() $$;

alter table households enable row level security;
alter table persons enable row level security;
alter table household_members enable row level security;
alter table invites enable row level security;
alter table recipes enable row level security;
alter table recipe_sources enable row level security;
alter table recipe_images enable row level security;
alter table meal_plans enable row level security;
alter table plan_entries enable row level security;
alter table events enable row level security;

create policy hh_all on households for all
  using (id in (select my_household_ids()));
create policy persons_all on persons for all
  using (household_id in (select my_household_ids()));
create policy members_self on household_members for select
  using (user_id = auth.uid() or household_id in (select my_household_ids()));
create policy invites_owner on invites for all
  using (household_id in (select my_household_ids()));
create policy recipes_all on recipes for all
  using (household_id in (select my_household_ids()));
create policy sources_all on recipe_sources for all
  using (recipe_id in (select id from recipes where household_id in (select my_household_ids())));
create policy images_all on recipe_images for all
  using (recipe_id in (select id from recipes where household_id in (select my_household_ids())));
create policy plans_all on meal_plans for all
  using (household_id in (select my_household_ids()));
create policy entries_all on plan_entries for all
  using (meal_plan_id in (select id from meal_plans where household_id in (select my_household_ids())));
create policy events_all on events for all
  using (household_id in (select my_household_ids()));

insert into storage.buckets (id, name, public) values ('recipe-media','recipe-media', false);
create policy media_rw on storage.objects for all
  using (bucket_id = 'recipe-media' and auth.uid() is not null)
  with check (bucket_id = 'recipe-media' and auth.uid() is not null);
```

- [ ] Step 3: Apply via MCP `apply_migration` (name `core`). Verify with `list_tables` that all 10 tables exist with `rls_enabled: true`.
- [ ] Step 4: Seed the household: insert `households` row ("Andino"), a `persons` row per family member placeholder, and an `invites` row for `ruben.raw.dev@gmail.com` with role `owner` (via `execute_sql`).
- [ ] Step 5: Commit the migration file: `git commit -m "feat(db): core schema, RLS, invite-only trigger"`.

### Task 3: Worker scaffold + canonical models

**Files:** Create `worker/pyproject.toml`, `worker/src/mealy_worker/__init__.py`, `worker/src/mealy_worker/models.py`, `worker/tests/test_models.py`.

**Interfaces — Produces:** `Ingredient(raw:str, quantity:float|None, unit:str|None, name:str, group:str|None, fodmap:str|None)`; `CanonicalRecipe(title, language, servings, prep_minutes, cook_minutes, dish_type, tags:list[str], ingredients:list[Ingredient], steps:list[str], nutrition:dict|None, confidence:float)`; `Verbatim(kind:Literal['url','reel','photo','pdf','paste'], url:str|None, json_ld:dict|None, page_text:str|None, caption:str|None, transcript:str|None, overlay_text:str|None, ocr_text:str|None, pasted:str|None)`; `IngestResult(verbatim:Verbatim, canonical:CanonicalRecipe|None, needs_review:bool, image_urls:list[str])`.

- [ ] Step 1: `pyproject.toml` with `[project] name="mealy-worker"`, `requires-python=">=3.12,<3.13"`, deps: `fastapi`, `uvicorn`, `pydantic>=2`, `anthropic`, `openai`, `recipe-scrapers`, `yt-dlp`, `httpx`, `extruct`, `python-multipart`, `pyjwt`, `pypdf`; dev deps `pytest`, `pytest-asyncio`, `respx`. Set up env: `cd worker && uv sync`.
- [ ] Step 2: Write failing `tests/test_models.py`: `CanonicalRecipe` round-trips from a dict; `Ingredient` requires `raw` and `name`; `IngestResult` serialises with `model_dump_json()`.
- [ ] Step 3: Run `uv run pytest` → FAIL (module missing). Implement `models.py` with the pydantic models above. Run → PASS.
- [ ] Step 4: Commit `feat(worker): scaffold + canonical recipe models`.

### Task 4: The structuring brain

**Files:** Create `worker/src/mealy_worker/structure.py`, `worker/tests/test_structure.py`.

**Interfaces — Consumes:** models from Task 3. **Produces:** `async def structure_text(verbatim: Verbatim) -> CanonicalRecipe` and `async def structure_images(images: list[bytes], media_types: list[str], hint: str|None) -> tuple[CanonicalRecipe, str]` (returns canonical + verbatim OCR text). Uses Anthropic tool-use forced structured output against the `CanonicalRecipe` JSON schema; model `claude-haiku-4-5`.

- [ ] Step 1: Write failing tests mocking the Anthropic client (`respx`/monkeypatch): given a `Verbatim` with `pasted` text, `structure_text` returns a `CanonicalRecipe` whose every ingredient has a non-empty `raw`; prompt must contain the verbatim text unmodified; `confidence < 0.6` in the model reply propagates to the result.
- [ ] Step 2: Implement: build the text bundle in priority order (`json_ld` → mapped directly without LLM when complete; else caption+transcript+overlay/page/ocr/pasted concatenated with source labels), one `messages.create` call with `tool_choice` forcing the schema tool, system prompt: *"Extract the recipe. Copy ingredient and step text faithfully from the source; put the original ingredient line in `raw`. Never invent ingredients, quantities, or steps. Report `confidence` 0–1."* JSON-LD short-circuit: if `verbatim.json_ld` has `recipeIngredient` + `recipeInstructions`, map fields directly (no LLM) with `confidence=1.0`.
- [ ] Step 3: Run tests → PASS. Commit `feat(worker): LLM structuring brain with JSON-LD short-circuit`.

### Task 5: URL ingestion

**Files:** Create `worker/src/mealy_worker/ingest/url.py`, tests.

**Produces:** `async def ingest_url(url: str) -> IngestResult` — tries `recipe-scrapers`; falls back to fetching HTML + `extruct` JSON-LD extraction; falls back to readable text; gated/empty pages → `IngestResult(canonical=None, needs_review=True)` so the app offers "paste the text". Collects the JSON-LD `image` URL(s) into `image_urls`.

- [ ] Step 1: Failing tests with `respx`-mocked HTML fixtures: a page with full schema.org JSON-LD → canonical without any LLM call (assert the Anthropic mock was NOT called); a page with no structured data → falls through to `structure_text` (mocked); a 403/paywall page → `needs_review=True, canonical=None`, verbatim keeps whatever text was fetched.
- [ ] Step 2: Implement. Verbatim rule: `verbatim.json_ld`/`page_text` store exactly what was fetched. Run → PASS. Commit `feat(worker): URL ingestion with JSON-LD first, paste fallback signal`.

### Task 6: Reel ingestion (Instagram/TikTok)

**Files:** Create `worker/src/mealy_worker/ingest/social.py`, tests.

**Produces:** `async def ingest_social(url: str) -> IngestResult` — `yt-dlp` metadata (caption + thumbnail) → if caption looks complete (heuristic: contains ≥3 quantity-like tokens), skip download; else download audio → OpenAI `gpt-4o-mini-transcribe` → transcript; sample up to 4 frames → `structure_images` OCR pass for overlay text; bundle all streams → `structure_text`. Any fetch failure → `needs_review=True` with whatever was captured (caption-only fallback).

- [ ] Step 1: Failing tests: mock `yt_dlp.YoutubeDL.extract_info` returning a caption-with-recipe → no download attempted, canonical produced from caption; extract_info raising → `IngestResult(needs_review=True, canonical=None)`; transcript path stores transcript verbatim in `verbatim.transcript`.
- [ ] Step 2: Implement with cookie-jar path from env `YTDLP_COOKIES_FILE` (optional), 2 retries. Run → PASS. Commit `feat(worker): reel ingestion — caption, transcript, overlay OCR, caption-only fallback`.

### Task 7: Photo & PDF ingestion

**Files:** Create `worker/src/mealy_worker/ingest/media.py`, tests.

**Produces:** `async def ingest_images(images: list[bytes], media_types: list[str]) -> IngestResult` (multi-image = one recipe, per spec §3.2) and `async def ingest_pdf(data: bytes) -> IngestResult` (text layer via `pypdf`; if empty → rasterise pages with `pypdfium2` → `ingest_images`).

- [ ] Step 1: Failing tests: two images in → exactly one `structure_images` call with both; canonical `confidence < 0.6` → `needs_review=True`; text-layer PDF → `structure_text` with `verbatim.ocr_text` = extracted text.
- [ ] Step 2: Implement (add `pypdfium2` dep). Run → PASS. Commit `feat(worker): photo and PDF ingestion, multi-image grouping`.

### Task 8: Worker API + JWT auth

**Files:** Create `worker/src/mealy_worker/auth.py`, `worker/src/mealy_worker/main.py`, tests; `worker/.env.example`.

**Produces (the app's Task 11 client calls these):** `POST /ingest/url {url}` · `POST /ingest/text {text}` · `POST /ingest/social {url}` · `POST /ingest/images` (multipart, N files) · `POST /ingest/pdf` (multipart) — all return `IngestResult` JSON, all require `Authorization: Bearer <supabase access token>` verified against `SUPABASE_JWT_SECRET` (HS256, audience `authenticated`). `GET /health` open.

- [ ] Step 1: Failing tests via `fastapi.testclient`: no token → 401; valid HS256 token (signed in-test with a test secret) → 200 and routes dispatch to the (mocked) ingest functions; `/health` → 200.
- [ ] Step 2: Implement `auth.py` (`verify_token` dependency) + `main.py` wiring routes to Tasks 5–7 + `/ingest/text` (wraps `structure_text` with `Verbatim(kind='paste', pasted=text)`). Write `.env.example` listing the three env vars + `YTDLP_COOKIES_FILE`. Run → PASS. Commit `feat(worker): FastAPI surface with Supabase JWT auth`.

### Task 9: Expo app scaffold + theme + Supabase client

**Files:** Create `app/` via `npx create-expo-app@latest app --template default` (TypeScript, expo-router). Create `app/src/lib/supabase.ts`, `app/src/lib/theme.ts`, `app/.env.example`. Add deps: `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `react-native-url-polyfill`, `expo-secure-store`; dev: `jest-expo`, `@testing-library/react-native`.

**Produces:** `supabase` client singleton (AsyncStorage session persistence, env `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`); `useTheme()` hook returning `{colors, dark}` — palette tokens `bg, card, text, textMuted, accent, danger` for light and dark, following `useColorScheme()` with a manual override persisted in AsyncStorage (spec §13: system theme + override).

- [ ] Step 1: Scaffold, clear the template's example screens, verify `npx expo export --platform ios` type-checks/builds.
- [ ] Step 2: Failing jest test for `theme.ts` (resolves dark palette when scheme dark and override 'system'; override 'light' wins). Implement. PASS.
- [ ] Step 3: Implement `supabase.ts`. Commit `feat(app): Expo scaffold, theme system with dark/light override, Supabase client`.

### Task 10: Auth + tab navigation

**Files:** Create `app/app/_layout.tsx`, `app/app/(auth)/sign-in.tsx`, `app/app/(tabs)/_layout.tsx` (+ placeholder index screens for the three tabs).

**Produces:** root layout redirects by session (no session → `(auth)/sign-in`); sign-in = email field → `supabase.auth.signInWithOtp({email})` → 6-digit OTP entry → `verifyOtp` (magic-link OTP flow works in Expo without deep-link config); tabs: **Recettes** (library), **Semaine** (plan), **Réglages** (settings). Large-type, high-contrast styles from `useTheme()` (kitchen-readable rule).

- [ ] Step 1: Implement; smoke-test render of sign-in with testing-library. Manual check in Expo Go: sign in with the invited owner email, land on tabs.
- [ ] Step 2: Commit `feat(app): invite-only OTP auth and tab shell`.

### Task 11: Capture flow

**Files:** Create `app/src/lib/worker.ts`, `app/app/capture.tsx`; register `expo-share-intent` config plugin in `app.json` (inert until an EAS dev client is built — paste flow is the Phase-1 daily path).

**Consumes:** worker endpoints (Task 8). **Produces:** `captureFromUrl(url)`, `captureFromText(text)`, `captureFromImages(assets[])`, `captureFromPdf(asset)` in `worker.ts` — each: call worker with the session token → receive `IngestResult` → upload any local media to Storage bucket `recipe-media` → insert `recipes` row (from `canonical`, `needs_review` flag) + `recipe_sources` row (verbatim + media paths) + `recipe_images` rows → return recipe id. Capture screen: paste field (URL or text, auto-detected), photo picker (multi-select → one recipe), PDF picker; on `needs_review`/`canonical:null` → show "Impossible de récupérer — collez le texte ?" fallback path.

- [ ] Step 1: Jest test for the URL/text auto-detect helper and for the insert payload builder (pure function `buildRecipeRows(result: IngestResult): {recipe, source}` — assert verbatim passes through byte-identical).
- [ ] Step 2: Implement + wire a "＋" button in the library header to open `capture.tsx`. Commit `feat(app): capture via paste/photos/PDF with verbatim persistence`.

### Task 12: Library + recipe detail

**Files:** Create `app/app/(tabs)/library/index.tsx`, `app/app/(tabs)/library/[id].tsx`.

**Produces:** library list (cover thumbnail, title, tags, `needs_review` badge "à vérifier", search-by-title filter); detail screen with two views — **Recette** (structured: image gallery, servings, times, ingredients showing `name + quantity + unit` with the original `raw` line beneath in muted small text, steps) and **Source originale** (verbatim layer rendered read-only, per source kind). Edit affordance: structured fields editable and saved back to `recipes` (never touches `recipe_sources`).

- [ ] Step 1: Implement both screens with signed URLs for images (`createSignedUrl`, 1 h). Smoke render test for the detail ingredient row.
- [ ] Step 2: Commit `feat(app): library and recipe detail with original-source view`.

### Task 13: Manual weekly planner

**Files:** Create `app/src/lib/plan.ts`, `app/app/(tabs)/plan/index.tsx`, `app/src/lib/__tests__/plan.test.ts`.

**Consumes:** `meal_plans`/`plan_entries` schema (Task 2). **Produces (pure, unit-tested in `plan.ts`):** `weekStart(date): string` (Monday ISO date); `slotEntries(entries, day, slot)`; `slotCoverage(entries, day, slot, persons): {covered: PersonId[], uncovered: PersonId[]}` (empty `person_ids` ⇒ everyone); `upsertEntry`/`removeEntry` payload builders. UI: two-column 7×2 week grid; tap slot → recipe picker (library search) → optional person subset + cook toggle (`famille`/`employée`); split slots render stacked chips per entry with person initials + a chef-hat marker for employee-assigned; uncovered persons show as hollow chips; week navigation ◀ ▶ creates `meal_plans` rows on demand; "Valider la semaine" sets `status='approved'` and logs `events(type='planned')` per (entry, person).

- [ ] Step 1: Failing tests for `weekStart` (Wednesday → that week's Monday; Sunday belongs to the week started 6 days prior), `slotCoverage` with empty/partial/overlapping `person_ids`. Implement → PASS.
- [ ] Step 2: Build the grid UI. Commit `feat(app): manual 7×2 weekly planner with per-person entries and assigned cook`.

### Task 14: Settings

**Files:** Create `app/src/lib/quotas.ts`, `app/app/(tabs)/settings/index.tsx` (+ `app/app/(tabs)/settings/person/[id].tsx`), test.

**Produces:** Settings sections per spec §13 — **Foyer** (persons list: add/rename/remove, employee flag; per-person editor: FODMAP mode picker, allergens list, dislikes list); **Planification** (per-person protein quota steppers writing `diet_profile.proteinQuotas` — fish/meat/vegetarian rows, min–max); **Autres exigences** (free-text field on household + per person, saved verbatim; structured-proposal parsing deferred to Phase 3 — field is stored and displayed now); **Apparence** (Système/Clair/Sombre selector wired to Task 9 override); sign-out. Pure helper `quotaProgress(entries, personId, recipes): {category, planned, min, max}[]` in `quotas.ts` (used by planner header later).

- [ ] Step 1: Failing test for `quotaProgress` (counts only entries covering the person; empty `person_ids` counts for all). Implement → PASS.
- [ ] Step 2: Build screens; commit `feat(app): settings — household, quotas, requirements, appearance`.

### Task 15: Verify end-to-end + tag

- [ ] Step 1: Worker: `uv run pytest` all green. App: `npx jest` all green; `npx tsc --noEmit` clean.
- [ ] Step 2: Live smoke test (worker running locally with real keys): ingest one real recipe URL end-to-end → appears in library with original source intact; place it in a plan slot; approve week; confirm `events` row exists (MCP `execute_sql`).
- [ ] Step 3: Update README quickstarts with real commands; `git tag phase-1-spine`; commit `chore: phase 1 spine complete`.

## Self-Review

- **Spec coverage (Phase 1 scope, spec §14):** capture URL/paste ✓(5,8,11) reels ✓(6) photos/PDF ✓(7,11) share-intent config ✓(11, inert until EAS) verbatim two-layer ✓(2,4,11,12) library+detail+source view ✓(12) 7×2 planner, per-person, cook ✓(13) settings incl. quotas/free-text/theme ✓(14) invite-only auth ✓(2,10) RLS ✓(2) events log ✓(2,13). Deferred by design: FODMAP (P2), shopping list (P2), AI draft/Featured/seasonality (P3), employee page/translation (P4), Mac companion (P4), device app-lock (P4).
- **Type consistency:** `IngestResult` produced (T3) consumed (T5–8, 11); `plan_entries.person_ids`/`assigned_cook` names match T2↔T13; quota shape matches spec §2 ↔ T14.
- **Placeholder scan:** clean — every task names exact files, signatures, and test assertions.

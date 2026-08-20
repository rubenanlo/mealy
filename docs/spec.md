# Mealy — Product & Technical Specification

**Status:** authoritative spec, 2026-08-20.
**Sources:** deep-research report at `.research/20260804-meal-planner-plan-q3f8/polished_report.md` (in `~/Developer/Projects`), plus design decisions made in conversation on 2026-08-20. Where this spec and the report differ, this spec wins.

Mealy is a mobile-first meal planner for one household plus a small circle of family and friends. It captures recipes from anywhere, stores them verbatim, learns each person's tastes, respects FODMAP and other dietary rules, drafts weekly lunch+dinner plans on request, builds a grams-first shopping list aimed at Mon Marché, and gives the household's employee a dedicated, fully-Spanish cooking page.

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Build strategy | Greenfield, mobile-first. No forking Mealie/Tandoor/KitchenOwl (AGPL). Reuse MIT-licensed `recipe-scrapers` library only. |
| Backend | **Supabase (managed)**: Postgres + pgvector + Auth + Storage + Realtime + Row-Level Security. |
| Mobile client | Expo (SDK 52+) / React Native + expo-router. TestFlight (iOS) + internal APK (Android). `expo-share-intent` for share-sheet capture (requires EAS dev client — share extensions do not work in Expo Go). |
| Worker | Small Python (3.12) FastAPI service for ingestion + AI orchestration (`recipe-scrapers`, `yt-dlp`, transcription, LLM calls). One container (Fly.io / Railway / Cloud Run). |
| LLM keys | Server-side only, never in the app. |
| Auth | Invite-only. Magic-link / email OTP (Supabase Auth). Optional email+password if ever wanted. Optional device-level app lock (Face ID / passcode). |
| Grocery | Mon Marché **deep-links only** (`https://www.mon-marche.fr/recherche?q=<item>`). No cart automation, ever, unless explicitly revisited. |
| Planner AI | Hybrid: rules/SQL filter → embedding score → one LLM arrange call → **code validator has the final word**. |
| Embeddings | OpenAI `text-embedding-3-small` behind a swappable backend function; pgvector HNSW, cosine. Upgrade path: Voyage `voyage-3` or self-hosted `bge-m3`. |
| Structuring/draft/translate LLM | Claude — Haiku 4.5 (`claude-haiku-4-5`) default for extraction/translation, Sonnet 5 (`claude-sonnet-5`) for the weekly arrangement call. |
| Cost target | ~$40–70/mo managed all-in. AI usage is a few €/month. |

---

## 2. Household model — Person ≠ User

- One **household** contains **persons**. A person is anyone the planner cooks for (including children and the employee's beneficiaries); a **user** is a person with an app account. Not every person has an account.
- Settings asks for the number of family members and creates a person + editable profile for each.
- Invite-only: accounts are created only via invitation from the household owner.
- Row-Level Security scopes all data to the household.

### DietProfile (one per person)

```jsonc
{
  "fodmap": {
    "mode": "off | elimination | reintroduction | personalized",
    "strictness": "strict | relaxed",           // how to treat unknown/amber
    "avoidGroups": ["fructan","gos","lactose","excess_fructose","polyol"],
    "tolerances": { "lactose": {"status":"tolerated"} },
    "checkStacking": true
  },
  "proteinQuotas": {                             // per planning week, per person
    "period": "week",
    "targets": [
      {"category":"fish","min":2,"max":2},
      {"category":"meat","min":0,"max":3},
      {"category":"vegetarian","min":1,"max":null},
      {"category":"legume","min":0,"max":2}
    ]
  },
  "allergens": [],                               // HARD exclude — never drafted, never featured
  "dislikes": [],                                // soft exclude (score penalty)
  "cuisines": {"preferred": []},
  "dietLayers": [],                              // stackable: low_fodmap, vegetarian, gluten_free, ...
  "maxCookMinutesWeeknight": 30,
  "language": "fr",                              // UI/content language for this person
  "spanishVariant": null                         // "es-ES" | "es-419" — set for Spanish recipients
}
```

- **Other requirements (free text)** per household and per person: stored verbatim, injected into the LLM arrange step as context. On save, the app parses it and *proposes* structured equivalents ("no pork → add pork to excluded ingredients?"). Only structured constraints are code-enforced; free text remains soft guidance. Principle: **the validator can only guarantee structured constraints.**

---

## 3. Recipe ingestion — one brain, many adapters

Every source produces **raw material**; one structured-output LLM call emits the canonical recipe. Adding a source = writing one small adapter.

### 3.1 Verbatim two-layer storage (hard requirement)

1. **Verbatim layer (immutable):** the exact captured text — page text/JSON-LD, caption, transcript, OCR output — stored byte-for-byte, never edited, displayed in-app as "original source." Original media (photos, optionally audio) stored in Supabase Storage. A transcript is stored exactly as transcribed, never post-edited; the audio is the true original.
2. **Structured layer (derived):** parsed title/ingredients/steps/tags used by search, FODMAP, planning, shopping. Re-generatable at any time from the verbatim layer. Every structured ingredient keeps its `raw` original string.

### 3.2 Sources

- **URLs:** parse schema.org/Recipe JSON-LD first (no LLM). `recipe-scrapers` (649 sites + generic fallback). No structured data → readable-text extraction → LLM structuring.
- **NYT Cooking:** best-effort, user-initiated, one at a time. Parse JSON-LD when present; when gated, fall back to "paste the recipe text." Never bulk, never republished.
- **Instagram / TikTok reels:** `yt-dlp` → caption (often the full recipe; skip transcription when so) + audio → Whisper transcription + **frame sampling → vision OCR for on-screen text overlays**. All three text streams stored verbatim and fed together to structuring. Mitigations for anti-bot breakage: logged-in cookie jar, retries, pinned+auto-updated `yt-dlp`, caption-only fallback, and a "couldn't fetch — paste the text?" escape hatch.
- **Photos:** multimodal LLM does OCR + structuring in one call (handles handwriting, multi-column). **Multiple photos per recipe:** photos are grouped (time-proximity auto-grouping + manual split/merge review) and sent as one multi-image request → one recipe. All source photos stay attached.
- **PDFs:** text-layer → extract text → LLM; scanned → rasterise pages → treat as photos.

### 3.3 Mac companion (Photos app pipeline)

A scheduled `launchd` job on the user's Mac: `osxphotos` exports new photos from a dedicated album ("Recipes to import") → local vision LLM (Ollama + Qwen2.5-VL) **or** Claude API → pushes verbatim OCR + original images to Supabase via the worker. Low-confidence extractions are flagged `needs_review` in the app. Lives in `companion/` in the repo; optional, Phase 4.

### 3.4 Canonical recipe model

Superset of schema.org/Recipe: detected `language`; `ingredients[]` as `{raw, quantity, unit, name, group, fodmap}`; free + controlled `tags`; dish type; `embedding` slot; `nutrition` when provided; `servings`; times; `source` provenance blob (type, url, raw text refs, media refs); **`seasonality`: 12-month suitability curve** (see §6); image gallery with one cover. Quantities stored metric; original strings always kept; user-correction affordance on every extracted field.

### 3.5 Images

Every recipe gets an ordered gallery + cover, stored in Supabase Storage. Sources by priority: (1) user's "snap what you cooked" photo (prompted when marking a recipe cooked), (2) JSON-LD `image`, (3) reel thumbnail / sharp mid-video frame, (4) the captured photo itself. AI generation is last-resort and off by default (a clean placeholder beats a wrong generated dish).

---

## 4. FODMAP & dietary constraints

- **No licensable dataset exists.** Build a curated ingredient→FODMAP table (~few hundred rows), assembled only from publicly published Monash educational content + peer-reviewed literature; every row cited; versioned. Open Food Facts (ODbL) + USDA FDC (CC0) provide the ingredient/nutrition backbone (no FODMAP values there).
- **Dose-dependent:** tag at `(ingredient, quantity)` level; per-portion load = quantity ÷ servings vs threshold; roll up per meal with a **stacking** heuristic warning (defensible heuristic, not a precise sum).
- **Division of labour:** the LLM parses and maps ingredient lines to table rows and explains flags; **the deterministic table assigns tier and threshold. The LLM never invents a classification.**
- Ship as best-effort, not medical advice: explicit disclaimer; always show which ingredient + assumed serving drove a flag; unknown defaults to "check" (false-positive over false-negative); user can override and record tolerance.
- Other diets (vegetarian, gluten-free, halal, …) are ingredient-tag exclusion layers in the same engine.
- **Constraint boundary:** FODMAP is a **hard constraint in the draft engine** but only a **display toggle in discovery surfaces** (§7). Allergens are hard everywhere.

---

## 5. AI core — taste learning & weekly draft

- **Embeddings:** embed title + cuisine + ingredient names (no quantities) + tags + one-line description. FODMAP tier, protein type, times-cooked stay as structured columns beside the vector. pgvector HNSW/cosine, server-side single source of truth.
- **Taste vectors:** per person, weighted average of embeddings of recipes they reacted to (cooked/repeated/rated/swapped-out; Featured taps/saves count too). EMA so recent tastes dominate. 2–4 facets via tiny k-means. Score = cosine-to-nearest-facet + tag matches − recency penalty − monotony penalty + circle-prior for cold start. One **wildcard slot** per week outside the facets. No model training — arithmetic only.
- **Weekly draft (per week, covering all persons):**
  1. **FILTER (SQL+rules):** hard constraints — FODMAP mode, allergens, dislikes-as-hard-where-configured, no-repeat window → per-protein candidate pools *per person-group*.
  2. **SCORE (embeddings):** taste + **seasonal fit** (§6) + quota-awareness → shortlist ~20–30.
  3. **ARRANGE (one Claude call):** shortlist IDs + quotas + taste profiles + free-text other-requirements + recent-weeks summary → picks the week, one-line rationale per meal. May only return shortlist IDs.
  4. **VALIDATE (code):** re-check every hard constraint and per-person quota; swap or re-ask on violation. **Code, not the model, has the final word.**
- **Shared-first drafting:** prefer one recipe the whole table can eat; split a slot only when constraints genuinely conflict. Quotas and learning are evaluated per person against the meals that person actually eats.

---

## 6. Seasonality

Per-recipe **12-month suitability curve** (not a binary flag).

- **Phase A — content-based at ingestion:** (1) `season` column on the canonical ingredient vocabulary (French produce calendar), (2) dish type + cooking method (soups/stews/gratins/long-oven → winter; salads/cold/grill/no-cook → summer), (3) explicit cues in verbatim source text ("plat d'été"). LLM proposes the curve; stored as structured data; user-editable.
- **Phase B — behavioral:** monthly histogram of when each recipe was planned/cooked, circularly smoothed; blended with the content prior (prior dominates early, behavior dominates with evidence). Pooling to fight sparsity: whole-circle, dish-type, and ingredient levels.
- Seasonal score plugs into draft SCORE (soft) and Featured ranking. Season is taste, not law.

---

## 7. Featured section

- **Pool:** recipes not used in previous meal plans (or not in last N months). **FODMAP does NOT filter the pool.** Allergens do (hard, always). Dislikes soften score only.
- **FODMAP toggle** on the section: FODMAP-friendly ↔ all recipes (display filter using Phase-2 flags; defaults from the viewer's profile; invisible for `mode: off` users).
- **Ranking:** taste match + seasonal fit + novelty boost − staleness penalty. ~5–8 recipes, weekly refresh.
- All interactions (tap/save/add-to-plan, toggle usage) are recorded as preference signal.

---

## 8. Meal planner

- **Weekly**, 7 days × **lunch + dinner** = 14 slots. No breakfast. Every plan stored permanently — history is the training data (feeds taste vectors, no-repeat, seasonality Phase B).
- **Plan entry** = `(week, day, lunch|dinner, recipe, [persons], assigned_cook)`. Default: one entry per slot covering the household; any slot can split into per-person entries as long as everyone is covered. Multiple lunches per slot supported.
- **Assigned cook:** family (default) or the **employee**. Employee-assigned meals drive her page (§10) and annotate the shopping list.
- **Three build modes on one screen:** manual drag/pick; per-slot ranked suggestions (same scoring engine, quota-aware); **"Let AI plan my week"** button → full hybrid draft → lands as an editable draft the user approves. Acceptances/swaps/rejections are all recorded signal.

---

## 9. Shopping list

- One tap from an approved plan: collect every ingredient line from all selected recipes (including employee meals).
- Normalise to the **canonical ingredient vocabulary** (~300–500 items, FR + ES labels) so duplicates merge across recipes; sum per ingredient; keep per-recipe breakdown visible ("300 g from bolognese + 100 g from salad").
- **Grams-first display:** convert via the density/average-weight table when known ("2 carottes" → ~250 g; "200 ml cream" → ~200 g). When unknown, show the original unit and **flag un-summable mixes rather than guessing**. Household corrections feed the table.
- Aisle grouping mapped to Mon Marché `/categorie/*` taxonomy. High-FODMAP annotations from the same canonical table. Employee-meal items annotated.
- Surfaces: in-app checklist (grouped by aisle, realtime-synced across the circle, per-item editable), plain-text WhatsApp/Notes export, per-item "🔎 Mon Marché" deep-link + "search all" flow.

---

## 10. Employee page (Spanish)

- **One stable, private, unguessable URL** — server-rendered from Supabase, no app, no account, no login. "Add to home screen" behaves like an app icon. Always shows the current week; reflects plan edits on next open.
- **Today-first layout:** opens on "Hoy — Almuerzo / Cena"; rest of week one scroll down. Tap a meal → full recipe: photo, servings for the persons eating it, ingredients in grams, steps as large tappable checkboxes (state saved locally on her phone). Optional per-day "lo que necesito" ingredient list.
- **100% Spanish, two layers:** recipe content via the §11 translation pipeline; page chrome hardcoded Spanish ("Hoy", "Almuerzo", "Cena", "Ingredientes", "Pasos", error states). Zero non-Spanish text anywhere, no language toggle. Her variant (`es-ES` vs `es-419`) stored on her person profile — confirm before Phase 4.
- **Scoped token:** the URL grants access to exactly her assigned meals + those recipes — nothing else. Revocable/regenerable from settings. `noindex`.
- Ease-of-use rules: large type, one column, huge tap targets, no navigation beyond scroll + tap.

---

## 11. Translation

- **LLM, not dedicated MT.** Translate the structured recipe field-by-field (JSON in → identical-schema JSON out); only free-text fields (`title`, ingredient `name`/`note`, `steps`, `tags`); quantities/units pass through untouched.
- **Units localise in code, not the LLM** (°F→°C, cups→ml; cups→grams only with known density).
- Persisted **glossary** (`source_term → target_term` per variant) injected into the prompt; grows from corrections.
- **Cache per `(recipe, language variant, source-hash)`**; recipe edits change the hash → auto-retranslate.
- Share links (per-recipe and the employee page) are private, unguessable, `noindex`.

---

## 12. Security

- Invite-only accounts (no open signup). Magic-link/OTP auth; email+password available as an option. RLS on every table. LLM/API keys server-side only. TLS everywhere. Unguessable `noindex` share tokens, revocable. Optional device app lock (Face ID/passcode) in the mobile app. Supabase managed backups; verify a restore once.

---

## 13. Design

- **Dark + light mode:** follow system theme, manual override in Settings.
- Simple, mobile-first, **kitchen-readable at arm's length**: large touch targets, high contrast, no dense grids. The two daily-driver screens — this week's plan and the shopping list — get priority; everything else serves them. The employee page applies these rules even more strictly.
- **Settings sections:** Household (members, per-person diet profiles, employee + her link management), Meal planning (per-person protein quotas: fish ×/week, meat ×/week, …), Other requirements (free text + structured proposals), Appearance (theme).

---

## 14. Phased roadmap (adjusted)

- **Phase 1 — the spine:** monorepo; Supabase project + schema + RLS + auth; worker with URL/social/photo/PDF ingestion behind the one structuring brain; verbatim two-layer store; Expo app: capture (paste + share-intent), library, recipe detail (structured + original source views), manual 7×2 weekly planner with per-person entries + assigned cook; Settings (household, quotas, free text, theme).
- **Phase 2 — FODMAP + shopping list:** curated cited FODMAP table; per-recipe flags; canonical ingredient vocabulary + matching; aggregated grams-first realtime shopping list; aisle grouping; WhatsApp export.
- **Phase 3 — AI:** embeddings; taste vectors + facets; hybrid weekly draft with validator; Featured + FODMAP toggle; seasonality curves (content-based) + behavioral blending; wildcard slot.
- **Phase 4 — sharing + integrations:** employee page (Spanish); translation pipeline + glossary; Mon Marché deep-links; Mac Photos companion; device app lock polish.

Each phase ships independently useful software; each phase's data improves the next.

## 15. Open questions

1. Does the household own the Monash app (as a personal verification reference for the FODMAP table)?
2. Employee's Spanish variant: `es-ES` or `es-419`?
3. Apple Developer account status (needed for TestFlight + share extension; $99/yr).

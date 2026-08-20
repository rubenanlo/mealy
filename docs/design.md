# Mealy — Design System ("Carnet de cuisine")

The app should feel like a well-kept family recipe notebook, not a startup product. Warm paper in light mode, warm cast-iron in dark mode, print-cookbook serif for titles only, system type for everything else. Kitchen-readable is the quality floor: base font 17+, tap targets ≥48, one-hand reach, high contrast in both modes.

## Signature element — the category spine

Everywhere a recipe appears (library row, planner chip, suggestion, shopping context), the card carries a 4px rounded **left spine** colored by protein category. This encodes the quota system (fish 2×/meat 3×) visually: a week grid's balance is legible at a glance without reading.

- fish → `spineFish` slate blue
- meat → `spineMeat` brick
- vegetarian → `spineVeg` olive
- legume → `spineLegume` ochre
- unknown/other → transparent (no spine — absence is information)

Category derives from `recipe.tags` (Phase 1 stand-in, same rule as quotaProgress).

## Color tokens (theme.ts)

| Token | Light | Dark |
|---|---|---|
| bg | `#F6F2EA` | `#1C1B18` |
| card | `#FFFDF8` | `#2A2721` |
| cardPressed | `#F0EAD9` | `#332F27` |
| text | `#2B2925` | `#EFEAE0` |
| textMuted | `#7A7468` | `#A39B8B` |
| accent (actions, active tab, links) | `#44582F` | `#8FA96B` |
| accentText (on accent) | `#FFFDF8` | `#1C1B18` |
| saffron (featured/seasonal highlights, badges) | `#D9A441` | `#D9A441` |
| danger (errors, allergens only) | `#B3402F` | `#D06A54` |
| border | `#E4DCCB` | `#3A352B` |
| spineFish | `#4E6E8E` | `#6E8DAB` |
| spineMeat | `#9C4A38` | `#B56A55` |
| spineVeg | `#5F7040` | `#84955F` |
| spineLegume | `#B08432` | `#C29A4A` |

Existing token names (bg, card, text, textMuted, accent, danger) keep their names — extend, don't rename, so screens keep compiling.

## Type

- **Display: Fraunces** (`@expo-google-fonts/fraunces`, weights 600 + 400italic), used ONLY for: app wordmark, screen titles, recipe titles, day names in the planner header. Load via `useFonts` in root layout; render nothing until loaded (splash covers it).
- **Body: system font** (SF Pro/Roboto) — everything else. Base 17, secondary 15, never below 13.
- **Quantities/numbers:** system with `fontVariant: ['tabular-nums']`, right-aligned in ingredient rows.
- Scale: wordmark 34, screenTitle 28 (Fraunces 600), recipeTitle 22 (Fraunces 600), body 17, secondary 15, eyebrow 13 uppercase +0.8 letter-spacing.

## Layout & components (components/ui)

- Screen padding 20 horizontal. Card radius 14, border 1px `border`, no heavy shadows (max iOS shadowOpacity 0.06).
- `Screen` — SafeArea + bg + optional scroll, consistent header slot.
- `Eyebrow` — 13/uppercase/muted; used for section labels ("THIS WEEK", "INGREDIENTS") and the date line "Wednesday, August 20" on Week.
- `Card` — surface with radius/border; `spine` prop takes a category color.
- `Button` — primary: accent bg, accentText label, radius 12, height 52, weight 600. Secondary: transparent, 1px border, text color. Destructive: danger text, no fill. Loading = ActivityIndicator replacing label.
- `Field` — card bg, 1px border, radius 12, height 52, focus border accent (2px). Placeholder textMuted.
- `Tag` — small pill, border only, 13pt.
- `EmptyState` — centered Fraunces italic line + one primary action. Empty states direct, never apologize: "No recipes yet." + button "Add a recipe".
- Tab bar: bg card, top border, active tint accent, inactive textMuted, Ionicons: Recipes `book-outline`, Week `calendar-outline`, Groceries `cart-outline`, Settings `settings-outline`. Labels always visible.

## Screens

**Sign in** — wordmark "Mealy" in Fraunces 600 34 + eyebrow "The family cooking notebook" beneath; form in a single Card (fields + primary button); secondary actions as text buttons below the card. Error text under the card in danger, prefixed by nothing (no ⚠ emoji).

### Tab structure (4 tabs)

1. **Recipes** (home) — recipes + suggestions. Ionicons `book-outline`.
2. **Week** — the planner. `calendar-outline`.
3. **Groceries** — shopping list. `cart-outline`.
4. **Settings** — settings. `settings-outline`.

**Recipes (home)** — header: screen title "Recipes" + ＋ button (52px circle, accent). Then a **Suggestions section**: eyebrow "SUGGESTIONS" + horizontally scrolling cards (160×200: thumbnail top, title 15/600 2-line clamp, spine) showing up to 6 recipes **not present in any plan entry**, newest first (simple Phase-1 heuristic; the real Featured engine with taste/season ranking and the FODMAP toggle arrives in Phase 3 on this same surface). Hide the section entirely when empty. Below: search field + the full library list. Rows as Cards with spine: 72px thumbnail (radius 10) left, recipe title 17/600 (Fraunces reserved for detail), tags row, "needs review" badge in saffron. List separators 12px gaps, not hairlines.

**Groceries (shopping list)** — Phase-1 honest version: reads the current week's plan (approved or draft) and lists every ingredient **grouped by recipe** (eyebrow = recipe title, rows = ingredient name left, quantity+unit right in tabular figures). Each row has a 28px checkbox (checked = struck-through, textMuted); checked state persists locally (AsyncStorage keyed by week). Header: title "Groceries" + eyebrow with the week ("Week of August 24"). Empty state: "No meals planned this week." + button "Open the week" (navigates to the Week tab). No merging/summing yet — Phase 2 brings canonical-ingredient aggregation and grams; the layout must not promise it (no totals row).

**Recipe detail** — hero image full-bleed top (radius 0, height 260) with back button overlay; title Fraunces 22-26; meta row (servings · prep · cuisson) as eyebrow; INGREDIENTS section: rows name-left / quantity-right (tabular), raw original string beneath in textMuted 13; STEPS: numbered 1..n — number in Fraunces 600 accent, step body 17, generous 16 gap. "Original source" toggle stays, styled as segmented text buttons.

**Week (planner)** — top: eyebrow date "Wednesday, August 20" + title "Week" + week nav ◀ ▶ (48px targets). Days as vertical sections; **today's section gets a saffron eyebrow "TODAY"** and card border accent. Each day: two labeled slots (Lunch / Dinner) as dashed-border empty targets ("Add") or filled chips (Card+spine, title + person initials chips + 👩‍🍳 marker for employee-assigned). Quota strip under the header: small pills per category "Fish 1/2 · Meat 2/3" using spine colors — fed by quotaProgress.
**"Approve week"** as sticky bottom primary button when the week is draft and non-empty.

**Settings** — grouped Cards with Eyebrow group labels (HOUSEHOLD, MEAL PLANNING, OTHER REQUIREMENTS, APPEARANCE), rows 52px with chevron. Theme selector as 3 segmented options.

**Capture** — modal keeps focus: title "Add a recipe", one Field ("Paste a link or text"), primary button, then two secondary buttons Photos / PDF as horizontal cards with icons. Failure state text is directive: "Could not fetch the recipe. Paste the text below."

## Motion & floor

- One deliberate motion: planner day sections and library rows fade+rise 12px on first mount (staggered 30ms, ≤300ms total); respect `useReducedMotion` — skip entirely.
- Press feedback: cards scale 0.98 + cardPressed bg.
- No other animation. No gradients anywhere. No emoji in UI copy except the 👩‍🍳 cook marker.
- Copy rules: sentence case, **English** (app chrome is English; recipe content keeps its source language; the employee page is 100% Spanish per spec §10), verbs on buttons ("Add a recipe", "Approve week"), errors say what to do next, empty states invite action.

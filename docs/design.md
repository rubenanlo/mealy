# Mealy — Design System v2 ("Cooking editorial", NYT Cooking-inspired)

Direction: the NYT Cooking app. Photography does the selling; the chrome is quiet, white, and typographic. Chunky slab-serif headlines over clean sans UI, hairline dividers, monochrome icons, one editorial red used sparingly. The app opens on a **recipes landing feed** — a browsable, magazine-like home — not a utility list. Kitchen-readable floor stays: base 16–17, tap targets ≥48, both modes high-contrast.

This replaces v1 ("carnet de cuisine"). Keep all v1 *functional* behavior (4 tabs, suggestions logic, groceries checklist, quota data, three sign-in flows); only the visual language changes.

## Color tokens (theme.ts — same token names, new values)

| Token | Light | Dark |
|---|---|---|
| bg | `#FFFFFF` | `#121212` |
| card | `#FFFFFF` | `#1C1C1C` |
| cardPressed | `#F5F5F4` | `#262626` |
| text | `#121212` | `#F5F5F4` |
| textMuted | `#72716D` | `#9C9A94` |
| accent (brand red — links, active save states, primary buttons) | `#C7442E` | `#E0604A` |
| accentText | `#FFFFFF` | `#121212` |
| saffron → repurpose as `badge` (needs-review, TODAY) | `#B58A2A` | `#D9A441` |
| danger | `#C7442E` | `#E0604A` |
| border (hairlines) | `#E5E3DE` | `#333230` |
| spineFish | `#4E6E8E` | `#6E8DAB` |
| spineMeat | `#9C4A38` | `#B56A55` |
| spineVeg | `#5F7040` | `#84955F` |
| spineLegume | `#B08432` | `#C29A4A` |

Chrome is monochrome (black/white/gray + hairlines). Red appears only on: primary buttons, active/save states, small "editorial" links ("See all"). Category spine colors survive **only** as small 8px dots + 12pt labels on cards and in the Week quota chips — no more 4px side bars (photography carries the cards now).

## Type

- **Display: Bitter** (`@expo-google-fonts/bitter`, 700 + 600) — the Karnak stand-in. Wordmark, section headlines, recipe titles, day names. Tight line-height (1.15), slight negative letter-spacing (-0.3) at ≥22.
- **UI/body: Libre Franklin** (`@expo-google-fonts/libre-franklin`, 400/500/600) — all UI text, meta lines, buttons, ingredients, steps.
- Numbers: Libre Franklin with `tabular-nums`.
- Scale: wordmark 30 (Bitter 700), sectionHead 24 (Bitter 700), heroTitle 26 (Bitter 700), cardTitle 17 (Bitter 600), body 16, meta 13 (Franklin 500, textMuted), eyebrow 12 uppercase +1.2 tracking (Franklin 600).
- Replace Fraunces entirely; remove its package.

## Chrome components

- Hairline dividers (`StyleSheet.hairlineWidth`, border color) between list sections — the NYT texture. Cards have **no borders and no shadows**; images and whitespace define them. radius 8 on standalone images/cards, 0 on full-bleed.
- **Bottom tab bar (the one to get right):** bg `bg`, top hairline, height comfortable (labels 11 Franklin 500), thin-outline Ionicons 24: Recipes `restaurant-outline`… no — use: Recipes `home-outline`, Week `calendar-clear-outline`, Groceries `basket-outline`, Settings `person-circle-outline`. Active = `text` color (black/white), NOT red; inactive = textMuted. No pill, no background blob. iOS: subtle blur optional — skip, plain bg is fine.
- Buttons: primary = red bg, white 600 label, radius 6 (squarer than v1), height 48. Secondary = 1px `text` border, text label, transparent. Tertiary/link = red 600 text, no chrome.
- Field: bg cardPressed (light gray fill, NYT search style), radius 6, no border until focus (2px text color), height 48, leading search icon where relevant.
- SectionHeader component: Bitter 24 + optional red "See all" link right-aligned.
- Save/plan affordance on cards: bookmark-outline icon top-right of image, filled red when the recipe is in the current week.

## Screens

**Recipes (home / landing page)** — the NYT Cooking feed:
1. Header row: wordmark "Mealy" (Bitter 700, 30) left; search icon + ＋ icon right (48px targets, monochrome). Tapping search expands a full-width Field beneath (collapsible); ＋ opens capture.
2. **Hero**: the first suggestion as a full-bleed card — image 4:3 full width, then below (not overlaid): title Bitter 26, meta line "35 min · Fish · 4 servings" (13 muted), hairline beneath. Tapping opens the recipe.
3. **"Suggested for you"** section (SectionHeader) — horizontal carousel of 150×190 cards: image 150×110 radius 8, title Bitter 600 17 two-line clamp, meta 13 with category dot. Same data rule as v1 (recipes in no plan entry, newest first, max 6, hero takes the first).
4. **"This week"** section — small horizontal row of the current week's planned recipes (image 110×82 + title 15) linking to Week; hidden when empty.
5. **"All recipes"** section — vertical list rows: 96×72 image left radius 6, title Bitter 600 17, meta line (time · category dot+label · "needs review" badge in `badge` color), hairline between rows (no gaps, no cards — NYT list style).
Empty library: full-bleed empty state, Bitter headline "Your cooking notebook starts here.", red primary "Add your first recipe".

**Recipe detail** — NYT recipe page: full-bleed 4:3 image; title Bitter 26 below; byline-style meta line; then a red primary row button "Add to this week" (opens day/slot picker) next to bookmark; INGREDIENTS as sectionHead with hairline rows (name left, quantity right tabular, raw string beneath 13 muted); STEPS sectionHead, steps as "Step 1" eyebrow + body 16 paragraphs (NYT style — eyebrow "STEP 1", not decorative numerals); "Original source" as a tertiary link under meta. Edit/mark-reviewed kept, monochrome.

**Week** — keep structure (date eyebrow, title "Week", chevrons, TODAY badge, Lunch/Dinner slots, sticky "Approve week" in red), restyled: day cards → day *sections* separated by hairlines, day name Bitter 600 20, slots as rows with 64×48 thumbnails; empty slot = "+ Add" tertiary red link, not dashed boxes. Quota chips: outlined, 8px category dot + "Fish 1/2" Franklin 500 13. Employee marker stays 👩‍🍳.

**Groceries** — keep behavior; restyle: recipe groups as sectionHead 20 Bitter, hairline rows, 26px round checkbox (red fill + white check when done, strike-through muted), week eyebrow up top.

**Settings** — NYT-style: plain rows with hairlines (no cards), group eyebrows (HOUSEHOLD / MEAL PLANNING / OTHER REQUIREMENTS / APPEARANCE), 52px rows, chevron, segmented theme control monochrome.

**Sign in** — white page, wordmark Bitter 30 centered-left, eyebrow "The family cooking notebook", plain fields (gray fill style), red primary button. Three flows unchanged.

**Capture** — sheet: title Bitter 24 "Add a recipe", gray-fill field, red primary, Photos/PDF as two bordered secondary buttons side by side with icons.

## Motion & floor

- Keep it stiller than v1: no entrance staggers. Only: pressed state (cardPressed bg, no scale), bookmark fill animation (single 150ms), search field expand/collapse (200ms). Respect reduced motion (skip the two animated ones).
- Copy rules unchanged: English chrome, sentence case, verbs on buttons; recipe content keeps source language; employee page (Phase 4) 100% Spanish.
- Accessibility floor unchanged: labels on all touchables, focus visible, contrast AA in both modes (gray meta 13 only on plain bg).


---

# v3 addendum — NYT Cooking IA + navbar ("ease-of-use pass", supersedes conflicting v2 items)

## Tab bar (5 tabs, the NYT pattern)
Home · Search · Week · Groceries · Settings. Ionicons pairs, **outline when inactive → filled when active**: home-outline/home, search-outline/search, calendar-outline/calendar, basket-outline/basket, person-circle-outline/person-circle. Active = icon+label in `text`; inactive = `textMuted`. Labels 11 Franklin 500, always visible. bg `bg`, top hairline, no blur, no red.

## IA: Search is its own tab
- **Home** = discovery only: wordmark row ("Mealy" Bitter 30 left, ＋ capture icon right — the collapsible search field is REMOVED); hero (first suggestion, 4:3 full-bleed); "Suggested for you" carousel; "This week" strip; "Recently added" carousel (last 10 by created_at). No full list on Home.
- **Search (new screen, src/app/(tabs)/search/index.tsx)** = the workhorse: large gray-fill search field (not autofocused) with search icon; beneath it a horizontally scrolling chip row of filters: All · Fish · Meat · Vegetarian · Legume · Needs review (single-select, chip = 1px border pill, active = text-color fill/bg-inverted text); then the full hairline recipe list (v2 row style), filtered by chip + query, newest first. Empty results: "No recipes match." + "Clear filters" tertiary.

## Signature: the bookmark chip on every photo
36px circle, `bg` fill (dark: card), subtle 1px border, bookmark-outline icon — overlaid top-right on EVERY recipe image (hero, carousel cards, list-row thumbnails 40px×28 rows may omit, detail hero). In-this-week → red filled bookmark. Tap = AddToWeekSheet (or removes when already planned this week — confirm via small action sheet). Same affordance everywhere; 150ms fill pop kept, reduced-motion gated.

## Recipe page: sticky action bar
"Add to this week" moves to a sticky bottom bar (bg + top hairline, safe-area padded): red primary full-width. The FODMAP summary (Phase 2 Task 7) renders ABOVE the ingredients section, not in the bar.

## Everything else
v2 stands: tokens, Bitter/Libre Franklin, hairline lists, Week/Groceries/Settings layouts, copy rules, motion floor. Week rows: minimum row height 56 for glanceable tapping.

---

# v3.1 correction — the real NYT tab bar (per user screenshot, supersedes v3 "Tab bar")

The NYT Cooking bar is a **floating capsule**, not a flat edge-to-edge strip:
- Container: absolute-positioned above the bottom safe area, inset ~12 horizontal, borderRadius 999 (full capsule), bg `bg` (white / #1C1C1C dark), soft shadow (iOS: opacity 0.12 radius 16 offset y4; Android elevation 8; web boxShadow), height ~64, content row space-evenly. Content scrolls behind it — screens need bottom padding ≈ 88 so lists aren't hidden.
- Items: **filled Ionicons for all states** (home, search, calendar, basket, person-circle) 22px + label 11 Franklin 500 beneath. Active ≠ icon swap: the **active item gets a rounded-pill blob** (cardPressed bg, radius 999, padding ~10×16) behind its icon+label; inactive items plain, `textMuted`; active `text`.
- Exactly 5 tabs: Home, Search, Week, Groceries, Settings. Nested routes (library/[id], settings/person/[id], etc.) must never appear as tabs.

# Brand lockup
Home header: the Mealy brand icon (assets/images/brand-icon-source.png, transparent bg) at 28×28, then "Mealy" Bitter 700 30, 8px gap — the "T | Cooking" lockup pattern. Also on the sign-in screen above the wordmark at 44×44.

# Web icon reliability
Ionicons must render on web (current bug: triangle placeholders): load the icon font explicitly via expo-font in the root layout (`useFonts({ ...Ionicons.font })` style) alongside the text fonts, and keep the splash until loaded.

---

# v3.2 — recipe page interactions

## Bottom-sheet recipe presentation
Tapping a recipe anywhere presents the detail as a card from the bottom: covers 95% of the screen (top 5% shows the dimmed screen behind), top corners radius 16 (top only), slide-up 280ms ease-out (reduced-motion: fade). Implementation: move the detail route OUT of the tab group to a root modal route (`src/app/recipe/[id].tsx`); iOS native uses stack `presentation: 'modal'` (pageSheet gives the peek + rounded top natively); Android/web use slide_from_bottom + a 5%-top-inset rounded container over a dimmed backdrop; swipe-down (iOS) and backdrop-tap/close chevron dismiss. All entry points (home hero/carousels, search rows, week entries, groceries parts, This-week strip) navigate to the new route. The sticky "Add to this week" bar stays inside the sheet, above its bottom edge.

## Pinned ingredients while reading steps
When the STEPS section header scrolls past the top of the sheet, a pinned bar appears (bg, bottom hairline, 44px): "Ingredients" + chevron. Tap → 200ms expand of a panel (max-height 60% of sheet, internally scrollable) listing ingredients name-left / quantity-right (tabular), raw line omitted here for density; tap the bar again or any step to collapse. Panel and bar disappear when scrolled back above the steps. Reduced-motion: instant toggle. The bar must not overlap the close affordance.

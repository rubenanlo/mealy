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

# Recipe folders (Recipe Box) — design

2026-08-24. Approved in chat; this document records the design.

## Goal

Users save recipes into personal folders (NYT Cooking "Recipe Box" style).
Folders are owned by one user, readable by everyone in the household, and
editable only by the owner. The library home gains a folders section; recipe
cards gain a second action so planning-this-week and saving-to-folders are
separate, single-tap affordances.

## Data model — migration `0007_folders`

```sql
create table folders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table folder_recipes (
  folder_id uuid not null references folders on delete cascade,
  recipe_id uuid not null references recipes on delete cascade,
  added_at timestamptz not null default now(),
  primary key (folder_id, recipe_id)
);
```

RLS (both tables enabled):

- **Read**: any member of the folder's household (same membership check the
  existing household-scoped tables use).
- **Write** (`folders` insert/update/delete): `owner_id = auth.uid()`, and the
  insert's `household_id` must be the caller's household.
- **Write** (`folder_recipes` insert/delete): the parent folder's
  `owner_id = auth.uid()`.

Deleting a user cascades their folders away (membership row and folders both
reference the deleted auth user); household deletion cascades everything.

## Recipe-card actions

Every recipe card (hero, row, tile) shows two chips:

- **Calendar chip** — opens the existing add-to-week day/slot/people sheet.
  Filled when the recipe is planned this week; tapping while planned asks to
  remove it from the week (existing `removeRecipeFromCurrentWeek`). This is
  the current bookmark behavior under a new icon.
- **Bookmark chip** — opens the save sheet (below). Filled when the recipe is
  in at least one of *my* folders.

## Save sheet — `components/save-sheet.tsx`

Modal in the style of the existing add-to-week sheet:

1. `Add to this week ›` row — opens the add-to-week sheet (kept even though
   the card has a calendar chip, so the sheet works from contexts without one).
2. **Your folders** — checklist of the caller's folders; toggling a row
   inserts/deletes the `folder_recipes` row immediately. No save button.
3. `+ New folder` — inline name field; creating the folder immediately saves
   the recipe into it. Duplicate name (unique violation) shows an inline error.

Only the caller's own folders are listed here (others' folders are view-only).

## Library home — "Your folders" section

New section at the bottom of the library home:

- Header `Your folders` with a `+ New` link (creates an empty folder via a
  name prompt).
- One row per folder: 2×2 collage of the four most recently added recipes'
  covers (fewer → blank tiles), name, `N recipes`.
- Below the caller's folders: other household members' folders grouped under
  their email (view-only rows, same layout).
- Empty state (no folders anywhere): a single muted hint row.

## Folder page — `app/folder/[id].tsx`

Pushed from a folder row. Shows the folder name, owner (when not mine), count,
and its recipes as standard recipe cards (tap → recipe page; both chips work).
Owner-only actions: rename (inline field) and delete folder (confirm alert).
Removing a recipe happens by unchecking the folder in the recipe's save sheet.

## Out of scope (YAGNI)

Grid/list layout toggle, folder search, reordering, cover selection, sharing
outside the household, offline caching.

## Testing

- Pure-logic unit tests: save-sheet toggle reducer (which inserts/deletes to
  issue), collage cover selection, "is saved" derivation for the bookmark fill.
- Existing suites stay green; typecheck and lint clean.
- RLS verified with SQL probes after the migration is applied (owner can
  write, member can only read, non-member sees nothing).

## Rollout

1. Migration `0007_folders` applied to the production project (with explicit
   user go-ahead, as before).
2. App code ships behind nothing — the feature is additive.

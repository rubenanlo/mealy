# Recipe Folders (Recipe Box) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-user recipe folders (NYT Recipe Box style): save-to-folder sheet from the card bookmark, a "Your folders" home section, a folder page, and a separate calendar chip for add-to-week.

**Architecture:** Two new Postgres tables (`folders`, `folder_recipes`) with owner-write / household-read RLS. Pure derivation helpers live in `app/src/lib/folders.ts` (unit-tested); screens query Supabase directly, matching the existing codebase style. Recipe cards grow a second chip: calendar = existing add-to-week flow, bookmark = new SaveSheet modal.

**Tech Stack:** Expo SDK 54 / React Native, expo-router, Supabase (Postgres + RLS), Jest.

**Spec:** `docs/superpowers/specs/2026-08-24-recipe-folders-design.md`

## Global Constraints

- Expo SDK is pinned to 54 (Expo Go compatibility) — no new native modules.
- Package manager is pnpm (`app/pnpm-workspace.yaml` exists); run commands from `app/`.
- Fonts/colors/tokens come from `@/lib/theme`; follow existing component idioms in `@/components/ui`.
- Commits are signed via 1Password's SSH agent; if `git commit` fails with `failed to fill whole buffer`, pause and ask Ruben to unlock 1Password.
- The production migration is NOT applied by the implementer — Task 7 requires Ruben's explicit go-ahead.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration file `0007_folders`

**Files:**
- Create: `supabase/migrations/0007_folders.sql`

**Interfaces:**
- Consumes: `households`, `recipes`, `my_household_ids()` from `0001_core.sql`.
- Produces: tables `folders(id, household_id, owner_id, name, created_at)` and `folder_recipes(folder_id, recipe_id, added_at)` used by Tasks 2–6.

- [ ] **Step 1: Write the migration**

```sql
-- Recipe folders (spec 2026-08-24): per-user folders, household-readable.

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

alter table folders enable row level security;
alter table folder_recipes enable row level security;

-- Household members read; only the owner writes.
create policy folders_read on folders for select
  using (household_id in (select my_household_ids()));
create policy folders_insert on folders for insert
  with check (owner_id = auth.uid() and household_id in (select my_household_ids()));
create policy folders_update on folders for update
  using (owner_id = auth.uid());
create policy folders_delete on folders for delete
  using (owner_id = auth.uid());

create policy folder_recipes_read on folder_recipes for select
  using (folder_id in (select id from folders where household_id in (select my_household_ids())));
create policy folder_recipes_insert on folder_recipes for insert
  with check (folder_id in (select id from folders where owner_id = auth.uid()));
create policy folder_recipes_delete on folder_recipes for delete
  using (folder_id in (select id from folders where owner_id = auth.uid()));
```

- [ ] **Step 2: Sanity-check the SQL** — read it against `0001_core.sql` policy style (`select my_household_ids()` subquery form). No runner exists locally; application happens in Task 7.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_folders.sql
git commit -m "feat(db): folders + folder_recipes with owner-write RLS"
```

---

### Task 2: Pure folder helpers in `lib/folders.ts`

**Files:**
- Create: `app/src/lib/folders.ts`
- Test: `app/src/lib/__tests__/folders.test.ts`

**Interfaces:**
- Produces (used by Tasks 4–6):
  - `interface FolderRow { id: string; household_id: string; owner_id: string; name: string; created_at: string }`
  - `interface FolderLink { folder_id: string; recipe_id: string; added_at: string }`
  - `interface FolderSummary extends FolderRow { recipeIds: string[] }` — `recipeIds` newest-first
  - `summarizeFolders(folders: FolderRow[], links: FolderLink[]): FolderSummary[]`
  - `savedRecipeIds(summaries: FolderSummary[], ownerId: string): Set<string>`
  - `groupByOwner(summaries: FolderSummary[], myId: string): { mine: FolderSummary[]; others: { ownerId: string; folders: FolderSummary[] }[] }`
  - `collageCovers(folder: FolderSummary, coverByRecipe: Map<string, string | null>): (string | null)[]` — always length 4

- [ ] **Step 1: Write the failing tests**

```ts
import {
  collageCovers,
  groupByOwner,
  savedRecipeIds,
  summarizeFolders,
  type FolderLink,
  type FolderRow,
} from '../folders';

const folder = (id: string, owner: string, name = id): FolderRow => ({
  id,
  household_id: 'h1',
  owner_id: owner,
  name,
  created_at: '2026-08-01T00:00:00Z',
});
const link = (folder_id: string, recipe_id: string, added_at: string): FolderLink => ({
  folder_id,
  recipe_id,
  added_at,
});

describe('summarizeFolders', () => {
  it('attaches recipe ids newest-first and keeps empty folders', () => {
    const out = summarizeFolders(
      [folder('f1', 'u1'), folder('f2', 'u1')],
      [link('f1', 'r-old', '2026-08-01T00:00:00Z'), link('f1', 'r-new', '2026-08-02T00:00:00Z')]
    );
    expect(out.find((f) => f.id === 'f1')?.recipeIds).toEqual(['r-new', 'r-old']);
    expect(out.find((f) => f.id === 'f2')?.recipeIds).toEqual([]);
  });
});

describe('savedRecipeIds', () => {
  it('collects only my folders', () => {
    const summaries = summarizeFolders(
      [folder('f1', 'me'), folder('f2', 'other')],
      [link('f1', 'r1', '2026-08-01T00:00:00Z'), link('f2', 'r2', '2026-08-01T00:00:00Z')]
    );
    expect(savedRecipeIds(summaries, 'me')).toEqual(new Set(['r1']));
  });
});

describe('groupByOwner', () => {
  it('splits mine (sorted by name) from others (grouped, stable)', () => {
    const summaries = summarizeFolders(
      [folder('fb', 'me', 'Beta'), folder('fa', 'me', 'alpha'), folder('fx', 'u2', 'X')],
      []
    );
    const { mine, others } = groupByOwner(summaries, 'me');
    expect(mine.map((f) => f.name)).toEqual(['alpha', 'Beta']);
    expect(others).toEqual([{ ownerId: 'u2', folders: [expect.objectContaining({ id: 'fx' })] }]);
  });
});

describe('collageCovers', () => {
  it('returns the four newest covers, padding with null', () => {
    const summary = summarizeFolders(
      [folder('f1', 'me')],
      [
        link('f1', 'r1', '2026-08-05T00:00:00Z'),
        link('f1', 'r2', '2026-08-04T00:00:00Z'),
        link('f1', 'r3', '2026-08-03T00:00:00Z'),
      ]
    )[0];
    const covers = new Map<string, string | null>([
      ['r1', 'a.jpg'],
      ['r2', null],
      ['r3', 'c.jpg'],
    ]);
    expect(collageCovers(summary, covers)).toEqual(['a.jpg', null, 'c.jpg', null]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx jest src/lib/__tests__/folders.test.ts`
Expected: FAIL — module `../folders` not found.

- [ ] **Step 3: Implement `app/src/lib/folders.ts`**

```ts
/** Recipe folders (spec 2026-08-24): per-user, household-readable. */

export interface FolderRow {
  id: string;
  household_id: string;
  owner_id: string;
  name: string;
  created_at: string;
}

export interface FolderLink {
  folder_id: string;
  recipe_id: string;
  added_at: string;
}

export interface FolderSummary extends FolderRow {
  /** Recipe ids, newest added first. */
  recipeIds: string[];
}

export function summarizeFolders(folders: FolderRow[], links: FolderLink[]): FolderSummary[] {
  const byFolder = new Map<string, FolderLink[]>();
  for (const l of links) {
    const list = byFolder.get(l.folder_id) ?? [];
    list.push(l);
    byFolder.set(l.folder_id, list);
  }
  return folders.map((f) => ({
    ...f,
    recipeIds: (byFolder.get(f.id) ?? [])
      .slice()
      .sort((a, b) => (a.added_at < b.added_at ? 1 : -1))
      .map((l) => l.recipe_id),
  }));
}

/** Recipes in at least one of MY folders — drives the bookmark fill. */
export function savedRecipeIds(summaries: FolderSummary[], ownerId: string): Set<string> {
  const out = new Set<string>();
  for (const f of summaries) {
    if (f.owner_id !== ownerId) continue;
    for (const id of f.recipeIds) out.add(id);
  }
  return out;
}

export function groupByOwner(
  summaries: FolderSummary[],
  myId: string
): { mine: FolderSummary[]; others: { ownerId: string; folders: FolderSummary[] }[] } {
  const byName = (a: FolderSummary, b: FolderSummary) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const mine = summaries.filter((f) => f.owner_id === myId).sort(byName);
  const others: { ownerId: string; folders: FolderSummary[] }[] = [];
  for (const f of summaries) {
    if (f.owner_id === myId) continue;
    let group = others.find((g) => g.ownerId === f.owner_id);
    if (!group) {
      group = { ownerId: f.owner_id, folders: [] };
      others.push(group);
    }
    group.folders.push(f);
  }
  for (const g of others) g.folders.sort(byName);
  return { mine, others };
}

/** Four newest cover paths (null-padded) for the 2×2 collage. */
export function collageCovers(
  folder: FolderSummary,
  coverByRecipe: Map<string, string | null>
): (string | null)[] {
  const covers = folder.recipeIds.slice(0, 4).map((id) => coverByRecipe.get(id) ?? null);
  while (covers.length < 4) covers.push(null);
  return covers;
}
```

- [ ] **Step 4: Run tests** — `cd app && npx jest src/lib/__tests__/folders.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/folders.ts app/src/lib/__tests__/folders.test.ts
git commit -m "feat(app): folder summary/grouping/collage helpers"
```

---

### Task 3: Calendar chip + two-chip recipe cards

**Files:**
- Modify: `app/src/components/ui.tsx` (add `CalendarChip` next to `BookmarkChip`)
- Modify: `app/src/components/recipe-cards.tsx` (`Hero`, `CarouselCard`: add `saved`/`onSave`; calendar keeps `planned`/`onBookmark` renamed `onPlan`)

**Interfaces:**
- Produces: `CalendarChip({ planned, onPress, accessibilityLabel?, style? })` in `@/components/ui`; `Hero`/`CarouselCard` props gain `saved: boolean; onSave: () => void` and rename `onBookmark` → `onPlan`.
- Consumers updated in this task: `app/src/app/(tabs)/library/index.tsx` call sites compile with the new prop names (temporary wiring: `saved={false}` `onSave={() => {}}` until Task 5).

- [ ] **Step 1: Add `CalendarChip` to `ui.tsx`** (below `BookmarkChip`)

```tsx
/** 36px calendar chip — add/remove this week's plan (folders own the bookmark). */
export function CalendarChip({
  planned,
  onPress,
  accessibilityLabel,
  style,
}: {
  planned: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          position: 'absolute',
          top: 8,
          right: 8,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? (planned ? 'Planned this week' : 'Add to this week')}
        accessibilityState={{ selected: planned }}
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons
          name={planned ? 'calendar' : 'calendar-outline'}
          size={18}
          color={planned ? colors.accent : colors.text}
        />
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: Rework the two cards in `recipe-cards.tsx`.** In `Hero` and `CarouselCard`: rename prop `onBookmark` → `onPlan`; add `saved: boolean; onSave: () => void`. Render both chips (import `CalendarChip`): calendar first, bookmark offset left of it.

```tsx
// Hero (was: <BookmarkChip saved={planned} onPress={onBookmark} style={{ top: 12, right: 12 }} />)
<CalendarChip planned={planned} onPress={onPlan} style={{ top: 12, right: 12 }} />
<BookmarkChip saved={saved} onPress={onSave} style={{ top: 12, right: 56 }} />

// CarouselCard (was top: 6, right: 6)
<CalendarChip planned={planned} onPress={onPlan} style={{ top: 6, right: 6 }} />
<BookmarkChip saved={saved} onPress={onSave} style={{ top: 6, right: 50 }} />
```

The third `onBookmark` usage (`recipe-cards.tsx:208`, ThisWeekCard-adjacent) stays as-is if it belongs to `ThisWeekCard` (week items are already planned; check the component and leave its semantics alone unless it renders `BookmarkChip` on library cards — then apply the same rename).

- [ ] **Step 3: Update call sites in `library/index.tsx`** so it compiles: replace `onBookmark={...}` with `onPlan={...}` (same handler) and add `saved={false} onSave={() => {}}` placeholders (Task 5 wires them).

- [ ] **Step 4: Verify** — `cd app && npx tsc --noEmit && npm test --silent` — Expected: clean, all suites pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/ui.tsx app/src/components/recipe-cards.tsx "app/src/app/(tabs)/library/index.tsx"
git commit -m "feat(app): calendar chip; cards carry plan + save actions"
```

---

### Task 4: SaveSheet component

**Files:**
- Create: `app/src/components/save-sheet.tsx`

**Interfaces:**
- Consumes: `FolderRow`, `summarizeFolders` not needed here; queries `folders` (mine only) and `folder_recipes` for one recipe directly via supabase.
- Produces: `SaveSheet({ visible, recipeId, recipeTitle, householdId, userId, onClose, onAddToWeek, onChanged })` — `onAddToWeek()` lets the caller open `AddToWeekSheet`; `onChanged()` fires after any insert/delete so the caller refreshes saved state.

- [ ] **Step 1: Implement the component** (mirror `AddToWeekSheet`'s Modal scaffolding in `add-to-week.tsx` — transparent modal, bottom sheet card, `SafeAreaView edges={['bottom']}`):

```tsx
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Eyebrow, Field, Hairline, Muted, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { minTapTarget, radius, screenPadding, useTheme } from '@/lib/theme';

interface FolderOption {
  id: string;
  name: string;
  hasRecipe: boolean;
}

/** Bookmark tap: save the recipe into my folders (spec 2026-08-24). */
export function SaveSheet({
  visible,
  recipeId,
  recipeTitle,
  householdId,
  userId,
  onClose,
  onAddToWeek,
  onChanged,
}: {
  visible: boolean;
  recipeId: string;
  recipeTitle: string;
  householdId: string;
  userId: string;
  onClose: () => void;
  onAddToWeek: () => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: mine }, { data: links }] = await Promise.all([
      supabase.from('folders').select('id, name').eq('owner_id', userId).order('name'),
      supabase.from('folder_recipes').select('folder_id').eq('recipe_id', recipeId),
    ]);
    const has = new Set((links ?? []).map((l) => l.folder_id));
    setFolders(((mine ?? []) as { id: string; name: string }[]).map((f) => ({ ...f, hasRecipe: has.has(f.id) })));
  }, [recipeId, userId]);

  useEffect(() => {
    if (visible) {
      setError(null);
      setNewName('');
      void load();
    }
  }, [visible, load]);

  const toggle = async (folder: FolderOption) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folder.id ? { ...f, hasRecipe: !f.hasRecipe } : f))
    );
    if (folder.hasRecipe) {
      await supabase
        .from('folder_recipes')
        .delete()
        .eq('folder_id', folder.id)
        .eq('recipe_id', recipeId);
    } else {
      await supabase.from('folder_recipes').insert({ folder_id: folder.id, recipe_id: recipeId });
    }
    onChanged();
  };

  const createAndSave = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const { data, error: err } = await supabase
      .from('folders')
      .insert({ household_id: householdId, owner_id: userId, name })
      .select('id')
      .single();
    if (err || !data) {
      setError(err?.code === '23505' ? 'You already have a folder with that name.' : 'Could not create the folder.');
      return;
    }
    await supabase.from('folder_recipes').insert({ folder_id: data.id, recipe_id: recipeId });
    setNewName('');
    onChanged();
    await load();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.card * 2,
          borderTopRightRadius: radius.card * 2,
          maxHeight: '75%',
        }}
      >
        <SafeAreaView edges={['bottom']}>
          <ScrollView
            contentContainerStyle={{ padding: screenPadding, gap: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            <Title>Save recipe</Title>
            <Muted numberOfLines={1}>{recipeTitle}</Muted>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add to this week"
              onPress={onAddToWeek}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: minTapTarget,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.text} />
              <Body style={{ flex: 1 }}>Add to this week</Body>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
            <Hairline />

            <Eyebrow>Your folders</Eyebrow>
            {folders.map((folder) => (
              <Pressable
                key={folder.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: folder.hasRecipe }}
                accessibilityLabel={folder.name}
                onPress={() => void toggle(folder)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: minTapTarget,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons
                  name={folder.hasRecipe ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={folder.hasRecipe ? colors.accent : colors.textMuted}
                />
                <Body style={{ flex: 1 }}>{folder.name}</Body>
              </Pressable>
            ))}
            {folders.length === 0 ? <Muted>No folders yet — create one below.</Muted> : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Field
                value={newName}
                onChangeText={setNewName}
                placeholder="New folder name"
                style={{ flex: 1 }}
                onSubmitEditing={() => void createAndSave()}
              />
              <Button label="Create" kind="secondary" onPress={() => void createAndSave()} />
            </View>
            {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify** — `cd app && npx tsc --noEmit` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/save-sheet.tsx
git commit -m "feat(app): SaveSheet — save recipe to my folders"
```

---

### Task 5: Library wiring — chips, saved state, "Your folders" section

**Files:**
- Modify: `app/src/app/(tabs)/library/index.tsx`

**Interfaces:**
- Consumes: `SaveSheet` (Task 4), `summarizeFolders` / `savedRecipeIds` / `groupByOwner` / `collageCovers` (Task 2), `CalendarChip` cards (Task 3), existing `AddToWeekSheet`, `useAuth` (`session.user.id`), `useHousehold`.
- Produces: routes pushed to `/folder/[id]` (Task 6).

- [ ] **Step 1: Load folder data alongside recipes.** In the screen's `load` callback add two queries and state:

```ts
const { session } = useAuth();           // add to existing destructuring
const userId = session?.user.id ?? '';
const [folders, setFolders] = useState<FolderSummary[]>([]);
const [memberEmails, setMemberEmails] = useState<Map<string, string>>(new Map());

// inside load():
const [{ data: folderRows }, { data: linkRows }, { data: memberRows }] = await Promise.all([
  supabase.from('folders').select('id, household_id, owner_id, name, created_at').eq('household_id', householdId),
  supabase.from('folder_recipes').select('folder_id, recipe_id, added_at'),
  supabase.from('household_members').select('user_id, email').eq('household_id', householdId),
]);
setFolders(summarizeFolders((folderRows as FolderRow[]) ?? [], (linkRows as FolderLink[]) ?? []));
setMemberEmails(new Map(((memberRows ?? []) as { user_id: string; email: string | null }[]).map((m) => [m.user_id, m.email ?? 'Family member'])));
```

- [ ] **Step 2: Derive saved state and wire chips.**

```ts
const savedSet = useMemo(() => savedRecipeIds(folders, userId), [folders, userId]);
const [saveRecipe, setSaveRecipe] = useState<RecipeListItem | null>(null);
```

Replace the Task 3 placeholders on every Hero/CarouselCard call site:
`saved={savedSet.has(recipe.id)} onSave={() => setSaveRecipe(recipe)}`. Keep `onPlan` as the existing plan/remove handler (`onBookmark` function body unchanged, renamed `onPlan`).

- [ ] **Step 3: Render the SaveSheet** next to the existing `AddToWeekSheet` JSX:

```tsx
{saveRecipe ? (
  <SaveSheet
    visible
    recipeId={saveRecipe.id}
    recipeTitle={saveRecipe.title}
    householdId={householdId}
    userId={userId}
    onClose={() => setSaveRecipe(null)}
    onAddToWeek={() => {
      const r = saveRecipe;
      setSaveRecipe(null);
      if (r) setSheetRecipe(r);   // existing add-to-week sheet state
    }}
    onChanged={() => void load()}
  />
) : null}
```

- [ ] **Step 4: Add the "Your folders" section** at the bottom of the ScrollView (after the last section, before `</ScrollView>`), with a small local `FolderRowItem` component in the same file:

```tsx
<View style={{ marginTop: 28, gap: 12 }}>
  <SectionHeader title="Your folders" linkLabel="+ New" onLinkPress={createFolderPrompt} />
  {mine.map((f) => (
    <FolderRowItem key={f.id} folder={f} covers={collageCovers(f, coverByRecipe)} onPress={() => router.push(`/folder/${f.id}`)} />
  ))}
  {mine.length === 0 ? <Muted>Save any recipe with the bookmark to start a folder.</Muted> : null}
  {others.map((group) => (
    <View key={group.ownerId} style={{ gap: 12 }}>
      <Eyebrow>{memberEmails.get(group.ownerId) ?? 'Family member'}</Eyebrow>
      {group.folders.map((f) => (
        <FolderRowItem key={f.id} folder={f} covers={collageCovers(f, coverByRecipe)} onPress={() => router.push(`/folder/${f.id}`)} />
      ))}
    </View>
  ))}
</View>
```

with:

```tsx
const { mine, others } = useMemo(() => groupByOwner(folders, userId), [folders, userId]);
const coverByRecipe = useMemo(
  () => new Map(recipes.map((r) => [r.id, r.cover_image_path ?? null])),
  [recipes]
);

const createFolderPrompt = () => {
  // Alert.prompt is iOS-only; fall back to opening the save-less flow on Android/web.
  // Simplest cross-platform: a folder is created from the SaveSheet; here use prompt when available.
  if (Platform.OS === 'ios') {
    Alert.prompt('New folder', undefined, (name) => {
      const trimmed = name?.trim();
      if (!trimmed) return;
      void supabase
        .from('folders')
        .insert({ household_id: householdId, owner_id: userId, name: trimmed })
        .then(() => void load());
    });
  } else {
    Alert.alert('New folder', 'Create folders from any recipe’s bookmark for now.');
  }
};
```

`FolderRowItem` (same file, bottom): pressable row — 72×72 collage (2×2 grid of `RecipeImage`-style `Image`s with `colors.cardPressed` placeholders), name in `fonts.displaySemi`/`fontSize.cardTitle`, `Muted` count `${f.recipeIds.length} recipes`, chevron. Follow `ThisWeekCard`'s image styling for `Image` + `mediaUrl` resolution used elsewhere in the file (reuse however the file already resolves `cover_image_path` to a URL — search for `cover_image_path` usage in the file and copy that mechanism).

- [ ] **Step 5: Verify** — `cd app && npx tsc --noEmit && npm test --silent` — Expected: clean/pass.

- [ ] **Step 6: Commit**

```bash
git add "app/src/app/(tabs)/library/index.tsx"
git commit -m "feat(app): save sheet wiring + Your folders home section"
```

---

### Task 6: Folder page

**Files:**
- Create: `app/src/app/folder/[id].tsx`
- Modify: `app/src/app/_layout.tsx` (register `folder/[id]` inside the `hasHousehold` Stack.Protected block, plain push screen)

**Interfaces:**
- Consumes: `useLocalSearchParams` id; `folders`/`folder_recipes`/`recipes` tables; `useAuth` for ownership; `RecipeRow` from `@/components/recipe-cards` for the list; `confirmRemoveFromWeek` not needed here.
- Produces: none (leaf screen).

- [ ] **Step 1: Register the route** in `_layout.tsx` next to `settings`:

```tsx
<Stack.Screen name="folder/[id]" />
```

- [ ] **Step 2: Implement the screen.** Structure mirrors `settings/account.tsx` (back button, Title, grouped background not needed — use `colors.bg` like other content screens):

```tsx
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecipeRow, type RecipeListItem } from '@/components/recipe-cards';
import { Body, Button, Field, Muted, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { fonts, minTapTarget, screenPadding, useTheme } from '@/lib/theme';

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();

  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [renaming, setRenaming] = useState(false);

  const isMine = ownerId !== null && ownerId === session?.user.id;

  const load = useCallback(async () => {
    if (!id) return;
    const { data: folder } = await supabase
      .from('folders')
      .select('name, owner_id, household_id')
      .eq('id', id)
      .single();
    if (!folder) return;
    setName(folder.name);
    setOwnerId(folder.owner_id);
    const [{ data: links }, { data: member }] = await Promise.all([
      supabase.from('folder_recipes').select('recipe_id, added_at').eq('folder_id', id).order('added_at', { ascending: false }),
      supabase.from('household_members').select('email').eq('user_id', folder.owner_id).maybeSingle(),
    ]);
    setOwnerEmail(member?.email ?? null);
    const ids = (links ?? []).map((l) => l.recipe_id);
    if (ids.length === 0) {
      setRecipes([]);
      return;
    }
    const { data: recipeRows } = await supabase
      .from('recipes')
      .select('id, title, tags, needs_review, cover_image_path, servings, prep_minutes, cook_minutes, created_at, ingredients')
      .in('id', ids);
    const order = new Map(ids.map((rid, i) => [rid, i]));
    setRecipes(
      ((recipeRows as RecipeListItem[]) ?? []).slice().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    );
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const rename = async () => {
    const trimmed = name.trim();
    if (!trimmed || !id) return;
    const { error } = await supabase.from('folders').update({ name: trimmed }).eq('id', id);
    if (error) {
      Alert.alert('Could not rename', error.code === '23505' ? 'You already have a folder with that name.' : 'Try again.');
      return;
    }
    setRenaming(false);
  };

  const removeFolder = () => {
    Alert.alert('Delete this folder?', `“${name}” will be deleted. Recipes stay in your library.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await supabase.from('folders').delete().eq('id', id);
            router.back();
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: screenPadding, gap: 16, paddingBottom: 48 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: minTapTarget,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Body style={{ fontFamily: fonts.uiSemi }}>Back</Body>
        </Pressable>

        {renaming ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field value={name} onChangeText={setName} style={{ flex: 1 }} onSubmitEditing={() => void rename()} autoFocus />
            <Button label="Save" kind="secondary" onPress={() => void rename()} />
          </View>
        ) : (
          <Title>{name || 'Folder'}</Title>
        )}
        <Muted>
          {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
          {!isMine && ownerEmail ? ` · ${ownerEmail}` : ''}
        </Muted>

        <View>
          {recipes.map((recipe) => (
            <RecipeRow key={recipe.id} recipe={recipe} onPress={() => router.push(`/recipe/${recipe.id}`)} />
          ))}
          {recipes.length === 0 ? (
            <Muted>Nothing saved here yet{isMine ? ' — use the bookmark on any recipe.' : '.'}</Muted>
          ) : null}
        </View>

        {isMine ? (
          <View style={{ gap: 10 }}>
            {!renaming ? <Button label="Rename folder" kind="secondary" onPress={() => setRenaming(true)} /> : null}
            <Button label="Delete folder" kind="danger" onPress={removeFolder} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
```

Check `RecipeRow`'s actual props in `recipe-cards.tsx` before use (`{ recipe, onPress }` per current code) and adjust if it differs.

- [ ] **Step 3: Verify** — `cd app && npx tsc --noEmit && npm test --silent` — Expected: clean/pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/folder/\[id\].tsx app/src/app/_layout.tsx
git commit -m "feat(app): folder page — view, rename, delete"
```

---

### Task 7: Apply migration + RLS verification (GATED)

**Files:** none (production database).

- [ ] **Step 1: Ask Ruben** for explicit go-ahead to apply `0007_folders` to Supabase project `fcqtywqwhddlyirhwbzq`. Do not proceed without it.

- [ ] **Step 2: Apply** via MCP `apply_migration` (name `folders`, query = file contents).

- [ ] **Step 3: RLS probe** via MCP `execute_sql` (service role bypasses RLS, so verify policy definitions instead):

```sql
select tablename, policyname, cmd from pg_policies
where tablename in ('folders', 'folder_recipes') order by 1, 2;
```

Expected: 4 policies on `folders` (select/insert/update/delete), 3 on `folder_recipes`.

- [ ] **Step 4: End-to-end check in the app** — create a folder from a recipe's bookmark, confirm it appears in "Your folders", open it, rename, delete.

- [ ] **Step 5: Final verify** — `cd app && npx tsc --noEmit && npm test --silent && npm run lint --silent` — all clean; then final commit if any file drifted.

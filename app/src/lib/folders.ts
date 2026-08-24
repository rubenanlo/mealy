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

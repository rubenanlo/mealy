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

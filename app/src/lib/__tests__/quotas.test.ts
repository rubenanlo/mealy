import { entryCoversPerson, quotaProgress } from '../quotas';

const recipes = [
  { id: 'saumon', tags: ['fish', 'rapide'] },
  { id: 'boeuf', tags: ['meat'] },
  { id: 'curry', tags: ['vegetarian'] },
];

const targets = [
  { category: 'fish', min: 2, max: 2 },
  { category: 'meat', min: 0, max: 3 },
  { category: 'vegetarian', min: 1, max: null },
];

describe('entryCoversPerson', () => {
  it('treats empty person_ids as covering everyone', () => {
    expect(entryCoversPerson({ recipe_id: 'r', person_ids: [] }, 'anyone')).toBe(true);
  });
  it('checks membership otherwise', () => {
    expect(entryCoversPerson({ recipe_id: 'r', person_ids: ['a'] }, 'a')).toBe(true);
    expect(entryCoversPerson({ recipe_id: 'r', person_ids: ['a'] }, 'b')).toBe(false);
  });
});

describe('quotaProgress', () => {
  it('counts only entries covering the person; empty person_ids counts for all', () => {
    const entries = [
      { recipe_id: 'saumon', person_ids: [] }, // everyone → counts for alice
      { recipe_id: 'saumon', person_ids: ['bob'] }, // not alice
      { recipe_id: 'boeuf', person_ids: ['alice', 'bob'] }, // alice
      { recipe_id: 'curry', person_ids: ['alice'] }, // alice
    ];
    expect(quotaProgress(entries, 'alice', recipes, targets)).toEqual([
      { category: 'fish', planned: 1, min: 2, max: 2 },
      { category: 'meat', planned: 1, min: 0, max: 3 },
      { category: 'vegetarian', planned: 1, min: 1, max: null },
    ]);
    expect(quotaProgress(entries, 'bob', recipes, targets)[0].planned).toBe(2);
  });

  it('ignores entries whose recipe is unknown or untagged', () => {
    const entries = [{ recipe_id: 'mystery', person_ids: [] }];
    for (const row of quotaProgress(entries, 'alice', recipes, targets)) {
      expect(row.planned).toBe(0);
    }
  });

  it('returns one row per target with min/max passed through', () => {
    const rows = quotaProgress([], 'alice', recipes, targets);
    expect(rows.map((r) => r.category)).toEqual(['fish', 'meat', 'vegetarian']);
    expect(rows[2].max).toBeNull();
  });
});

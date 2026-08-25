import { supabase } from '@/lib/supabase';

import { BLANK_RECIPE_TITLE, createBlankRecipe, isRecipeUntouched } from '../recipes';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const mockFrom = supabase.from as jest.Mock;

const blank = {
  ingredients: [],
  steps: [],
  cover_image_path: null,
  servings: null,
  prep_minutes: null,
  cook_minutes: null,
};

describe('isRecipeUntouched', () => {
  it('is true for a freshly created blank recipe', () => {
    expect(isRecipeUntouched(blank)).toBe(true);
  });

  it('is true even when only the title was set (title is not content)', () => {
    // The row has a title but no ingredients/steps/cover/times.
    expect(isRecipeUntouched(blank)).toBe(true);
  });

  it('is false once an ingredient is added', () => {
    expect(isRecipeUntouched({ ...blank, ingredients: [{ name: 'salt' }] })).toBe(false);
  });

  it('is false once a step is added', () => {
    expect(isRecipeUntouched({ ...blank, steps: ['Mix'] })).toBe(false);
  });

  it('is false once a cover, servings, or a time is set', () => {
    expect(isRecipeUntouched({ ...blank, cover_image_path: 'p.jpg' })).toBe(false);
    expect(isRecipeUntouched({ ...blank, servings: 4 })).toBe(false);
    expect(isRecipeUntouched({ ...blank, prep_minutes: 10 })).toBe(false);
    expect(isRecipeUntouched({ ...blank, cook_minutes: 20 })).toBe(false);
  });
});

describe('createBlankRecipe', () => {
  beforeEach(() => jest.clearAllMocks());

  function insertReturning(id: string) {
    return {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id }, error: null }),
    };
  }

  it('inserts a minimal recipe and returns its id', async () => {
    const q = insertReturning('r-1');
    mockFrom.mockReturnValue(q);
    const id = await createBlankRecipe({ householdId: 'hh-1', userId: 'u-1', title: 'Tacos' });
    expect(id).toBe('r-1');
    expect(mockFrom).toHaveBeenCalledWith('recipes');
    expect(q.insert).toHaveBeenCalledWith({
      household_id: 'hh-1',
      title: 'Tacos',
      created_by: 'u-1',
    });
  });

  it('falls back to a placeholder title when none is given', async () => {
    const q = insertReturning('r-2');
    mockFrom.mockReturnValue(q);
    await createBlankRecipe({ householdId: 'hh-1' });
    expect(q.insert).toHaveBeenCalledWith({
      household_id: 'hh-1',
      title: BLANK_RECIPE_TITLE,
      created_by: null,
    });
  });

  it('throws when the insert fails', async () => {
    const q = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'nope' } }),
    };
    mockFrom.mockReturnValue(q);
    await expect(createBlankRecipe({ householdId: 'hh-1' })).rejects.toMatchObject({
      message: 'nope',
    });
  });
});

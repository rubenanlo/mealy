import { defaultTargetWeek, ideaCounts, ideaPayload, isPastDay, weekChoices } from '../plan-ideas';

describe('plan ideas helpers', () => {
  it('opens on this week, except on Sunday', () => {
    expect(defaultTargetWeek(new Date(2026, 10, 12))).toBe('2026-11-09'); // Thursday
    expect(defaultTargetWeek(new Date(2026, 10, 15))).toBe('2026-11-16'); // Sunday
  });

  it('offers this week plus the next seven', () => {
    const weeks = weekChoices(new Date(2026, 10, 15));
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toBe('2026-11-09');
    expect(weeks[1]).toBe('2026-11-16');
    expect(weeks[7]).toBe('2026-12-28');
  });

  it('flags days before today as past', () => {
    const now = new Date(2026, 10, 12, 18, 0); // Thursday evening
    expect(isPastDay('2026-11-09', 2, now)).toBe(true); // Wednesday
    expect(isPastDay('2026-11-09', 3, now)).toBe(false); // today
    expect(isPastDay('2026-11-16', 0, now)).toBe(false);
  });

  it('builds a recipe or custom idea payload, never both', () => {
    expect(
      ideaPayload({ householdId: 'h', weekStart: '2026-11-23', recipeId: 'r', note: '  ' })
    ).toEqual({ household_id: 'h', week_start: '2026-11-23', recipe_id: 'r', custom_title: null, note: null });
    expect(
      ideaPayload({ householdId: 'h', weekStart: '2026-11-23', customTitle: ' Raclette ', note: 'Sunday' })
    ).toMatchObject({ recipe_id: null, custom_title: 'Raclette', note: 'Sunday' });
    expect(() => ideaPayload({ householdId: 'h', weekStart: '2026-11-23' })).toThrow();
    expect(() =>
      ideaPayload({ householdId: 'h', weekStart: '2026-11-23', recipeId: 'r', customTitle: 'x' })
    ).toThrow();
  });

  it('counts ideas per week', () => {
    const counts = ideaCounts([{ week_start: 'a' }, { week_start: 'b' }, { week_start: 'a' }]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
  });
});

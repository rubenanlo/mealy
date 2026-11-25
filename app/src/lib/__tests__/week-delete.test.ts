import { weekDeleteSummary } from '@/lib/week-delete';

describe('weekDeleteSummary', () => {
  const entries = [
    { day: 0, slot: 'lunch' as const, assigned_cook: 'family' as const },
    { day: 0, slot: 'lunch' as const, assigned_cook: 'family' as const },
    { day: 0, slot: 'dinner' as const, assigned_cook: 'employee' as const },
    { day: 2, slot: 'lunch' as const, assigned_cook: 'employee' as const },
  ];

  it('counts meals, eating out, employee meals and tasks', () => {
    const summary = weekDeleteSummary({
      entries,
      absences: [
        { day: 1, slot: 'lunch', person_id: 'm' },
        { day: 1, slot: 'lunch', person_id: 'r' },
        { day: 3, slot: 'dinner', person_id: 'p' },
        { day: 4, slot: 'dinner', person_id: 'sindy' },
      ],
      eaterIds: ['r', 'm', 'p'],
      employeeNotes: ['Ironing', '  '],
      approved: true,
      employeeHasLink: true,
      ideas: 2,
    });
    expect(summary).toEqual({
      meals: 3,
      eatingOut: 2,
      employeeMeals: 2,
      tasks: 1,
      warnEmployee: true,
      ideas: 2,
    });
  });

  it('only warns about the employee page when the week is approved, shared and gives her work', () => {
    const base = {
      entries,
      absences: [],
      eaterIds: ['r'],
      employeeNotes: null,
      employeeHasLink: true,
      ideas: 0,
    };
    expect(weekDeleteSummary({ ...base, approved: false }).warnEmployee).toBe(false);
    expect(weekDeleteSummary({ ...base, approved: true, employeeHasLink: false }).warnEmployee).toBe(false);
    expect(
      weekDeleteSummary({ ...base, approved: true, entries: [{ day: 0, slot: 'lunch', assigned_cook: 'family' }] })
        .warnEmployee
    ).toBe(false);
    expect(weekDeleteSummary({ ...base, approved: true }).warnEmployee).toBe(true);
  });
});

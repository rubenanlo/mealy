import { fireEvent, render } from '@testing-library/react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/lib/theme';
import { SCHOOL_LUNCH_DAYS } from '@/lib/ai-week';
import type { PlanAbsence, PlanEntry } from '@/lib/plan';

import { AddMealSheet } from '../week/add-meal-sheet';
import { DayRows } from '../week/day-rows';
import { HomeSheet } from '../week/home-sheet';
import { MealSheet } from '../week/meal-sheet';
import { ReviewSheet } from '../week/review-sheet';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>
  );

const WEEK = '2026-11-16';
const eaters = [
  { id: 'r', name: 'Ruben' },
  { id: 'm', name: 'Marc' },
];

function entry(over: Partial<PlanEntry>): PlanEntry {
  return {
    id: 'e1',
    meal_plan_id: 'p1',
    day: 0,
    slot: 'dinner',
    recipe_id: 'salmon',
    custom_title: null,
    person_ids: [],
    guest_count: 0,
    assigned_cook: 'family',
    position: 0,
    instructions: null,
    cook_part: false,
    ...over,
  };
}

const recipeById = new Map([
  ['salmon', { id: 'salmon', title: 'Salmon with dill', cover_image_path: null }],
  ['soup', { id: 'soup', title: 'Lentil soup', cover_image_path: null }],
]);

describe('week page sheets', () => {
  beforeEach(() => {
    // Sunday before the shown week, so every day of it is in the future.
    jest.useFakeTimers({ now: new Date(2026, 10, 15, 12, 0), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => jest.useRealTimers());

  it('day rows show dishes, sides, cook, going out and add buttons', () => {
    const onAdd = jest.fn();
    const onOpen = jest.fn();
    const absences: PlanAbsence[] = [
      { day: 4, slot: 'dinner', person_id: 'r' },
      { day: 4, slot: 'dinner', person_id: 'm' },
    ];
    const { getByText, getAllByText, getByLabelText } = wrap(
      <DayRows
        weekIso={WEEK}
        entries={[
          entry({}),
          entry({ id: 'side', recipe_id: null, custom_title: 'Rice', position: 1 }),
          entry({ id: 'e2', day: 0, slot: 'lunch', recipe_id: 'soup', assigned_cook: 'employee', cook_part: true }),
        ]}
        absences={absences}
        eaters={eaters}
        recipeById={recipeById}
        todayIndex={-1}
        readOnly={false}
        onAdd={onAdd}
        onOpen={onOpen}
        onAddFor={() => {}}
        onHome={() => {}}
      />
    );
    expect(getByText(/Salmon with dill/)).toBeTruthy();
    expect(getByText(' + Rice')).toBeTruthy();
    expect(getByText('Employee · part')).toBeTruthy();
    expect(getByText('Going out')).toBeTruthy();
    expect(getAllByText('+ Add dinner').length).toBe(5);
    fireEvent.press(getAllByText('+ Add lunch')[0]!);
    expect(onAdd).toHaveBeenCalledWith(1, 'lunch');
    fireEvent.press(getByLabelText('Edit Salmon with dill'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });

  it('day rows say who a dish is for and offer a dish for the others', () => {
    const onAddFor = jest.fn();
    const { getByText } = wrap(
      <DayRows
        weekIso={WEEK}
        entries={[entry({ person_ids: ['m'] })]}
        absences={[]}
        eaters={eaters}
        recipeById={recipeById}
        todayIndex={-1}
        readOnly={false}
        onAdd={() => {}}
        onOpen={() => {}}
        onAddFor={onAddFor}
        onHome={() => {}}
      />
    );
    expect(getByText('For Marc')).toBeTruthy();
    fireEvent.press(getByText('+ Add a dish for Ruben'));
    expect(onAddFor).toHaveBeenCalledWith(0, 'dinner', ['r']);
  });

  it('meal sheet opens the recipe at the right servings and saves a part-only hand-off', () => {
    const onSave = jest.fn();
    const onOpenRecipe = jest.fn();
    const { getByText, getByPlaceholderText } = wrap(
      <MealSheet
        visible
        entry={entry({ guest_count: 1 })}
        sides={[]}
        heading="Monday · Dinner"
        title="Salmon with dill"
        coverPath={null}
        hasRecipe
        eaters={eaters}
        away={new Set()}
        employeeName="Rosa"
        sideTitle={() => ''}
        onOpenRecipe={onOpenRecipe}
        onSwap={() => {}}
        onAddSide={() => {}}
        onRemoveSide={() => {}}
        onSave={onSave}
        onRemove={() => {}}
        onClose={() => {}}
      />
    );
    fireEvent.press(getByText('Open recipe · Serves 3'));
    expect(onOpenRecipe).toHaveBeenCalledWith(3);
    fireEvent.press(getByText('Part of it'));
    fireEvent.changeText(getByPlaceholderText('Which part? e.g. marinate the salmon'), 'Marinate it');
    fireEvent.press(getByText('Done'));
    expect(onSave).toHaveBeenCalledWith({
      person_ids: [],
      guest_count: 1,
      assigned_cook: 'employee',
      cook_part: true,
      instructions: 'Marinate it',
    });
  });

  it('school chip marks the child away for the usual school lunches', () => {
    const onChange = jest.fn();
    const { getByRole } = wrap(
      <HomeSheet
        visible
        weekIso={WEEK}
        eaters={eaters}
        absences={[]}
        schoolChild={eaters[1]!}
        onChange={onChange}
        onClose={() => {}}
      />
    );
    fireEvent.press(getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(
      SCHOOL_LUNCH_DAYS.map((day) => ({ day, slot: 'lunch', personId: 'm', away: true }))
    );
  });

  it('add sheet: ideas first, one tap picks, typing adds a free-text meal', () => {
    const onPick = jest.fn();
    const recipes = [
      { id: 'hake', title: 'Hake in salsa verde', cover_image_path: null, category: 'fish', isSalad: false, weeksSince: 8, totalMinutes: 35 },
      { id: 'greek', title: 'Greek salad', cover_image_path: null, category: 'vegetarian', isSalad: true, weeksSince: null, totalMinutes: 15 },
    ];
    const { getByText, getByLabelText, getByPlaceholderText } = wrap(
      <AddMealSheet
        visible
        title="Tuesday · Dinner"
        recipes={recipes}
        suggestions={{ ideas: ['hake'], gaps: ['greek'], recent: [] }}
        customIdeas={[]}
        ideaIdByRecipe={new Map([['hake', 'idea-1']])}
        onPick={onPick}
        onClose={() => {}}
      />
    );
    expect(getByText('Ideas for this week')).toBeTruthy();
    expect(getByText('Salad · 15 min · not cooked yet')).toBeTruthy();
    fireEvent.press(getByLabelText('Add Hake in salsa verde'));
    expect(onPick).toHaveBeenCalledWith({ recipeId: 'hake', ideaId: 'idea-1' });
    fireEvent.changeText(getByPlaceholderText('Search or type a meal'), 'Pizza night');
    fireEvent.press(getByText('Add “Pizza night” as a meal'));
    expect(onPick).toHaveBeenLastCalledWith({ customTitle: 'Pizza night' });
  });

  it('review sheet lists her dishes and tasks and approves', () => {
    const onApprove = jest.fn();
    const onTasksChange = jest.fn();
    const { getByText, getByPlaceholderText } = wrap(
      <ReviewSheet
        visible
        approved={false}
        mealsCount={12}
        tally={['Meat 3', 'Fish 2']}
        employeeName="Rosa"
        canSend
        items={[{ id: 'e2', heading: 'Mon · Lunch', title: 'Lentil soup', coverPath: null, part: true, note: 'Only the stock' }]}
        tasks={['Iron shirts']}
        busy={false}
        onTasksChange={onTasksChange}
        onOpenItem={() => {}}
        onApprove={onApprove}
        onSendLink={() => {}}
        onClose={() => {}}
      />
    );
    expect(getByText('Rosa prepares (1)')).toBeTruthy();
    expect(getByText('Part: Only the stock')).toBeTruthy();
    fireEvent.changeText(getByPlaceholderText('e.g. Iron shirts'), 'Sew a button');
    fireEvent(getByPlaceholderText('e.g. Iron shirts'), 'submitEditing');
    expect(onTasksChange).toHaveBeenCalledWith(['Iron shirts', 'Sew a button']);
    fireEvent.press(getByText('Approve and send Rosa the link'));
    expect(onApprove).toHaveBeenCalledWith(true);
  });
});

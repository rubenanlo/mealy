import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AskChatSheet, EditChatSheet, ManageVersionSheet } from '@/components/ai-assist';
import { ThemeProvider } from '@/lib/theme';
import { aiAskRecipe, aiEditRecipe } from '@/lib/worker';

jest.mock('@/lib/worker', () => ({
  aiEditRecipe: jest.fn(),
  aiAskRecipe: jest.fn(),
}));

const mockEdit = aiEditRecipe as jest.Mock;
const mockAsk = aiAskRecipe as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const wrap = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>
  );

const line = (raw: string, name: string) => ({ raw, name, quantity: null, unit: null, group: null, fodmap: null });

const soup = {
  title: 'Red lentil soup',
  language: 'en',
  servings: 4,
  ingredients: [line('2 tbsp olive oil', 'olive oil'), line('1 onion', 'onion')],
  steps: ['Soften the onion.', 'Simmer.'],
};

const proposal = {
  summary: 'Chorizo goes in first.',
  title_suffix: 'with chorizo',
  ingredients: [
    { ...line('150 g chorizo', 'chorizo'), change: 'added', was: null },
    { ...line('1 tsp olive oil', 'olive oil'), change: 'changed', was: '2 tbsp olive oil' },
    { ...line('1 onion', 'onion'), change: 'same', was: null },
  ],
  removed: [],
  steps: [
    { text: 'Fry the chorizo, then soften the onion.', change: 'changed' },
    { text: 'Simmer.', change: 'same' },
  ],
  extra_minutes: 5,
};

beforeEach(() => {
  mockEdit.mockReset();
  mockAsk.mockReset();
});

describe('EditChatSheet', () => {
  const base = {
    visible: true,
    recipeTitle: 'Red lentil soup',
    base: soup,
    replacesExisting: false,
    saving: false,
    saveError: false,
    onClose: jest.fn(),
  };

  it('sends the request, shows only what changed, and saves the proposal', async () => {
    mockEdit.mockResolvedValue(proposal);
    const onSave = jest.fn();
    const screen = wrap(<EditChatSheet {...base} onSave={onSave} />);
    fireEvent.changeText(screen.getByLabelText('What would you like to change?'), 'add chorizo');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByText('Chorizo goes in first.')).toBeTruthy());
    expect(mockEdit).toHaveBeenCalledWith(soup, 'add chorizo', []);
    expect(screen.getByText('150 g chorizo')).toBeTruthy();
    expect(screen.getByText('Step 1 · changed')).toBeTruthy();
    expect(screen.queryByText('Step 2 · changed')).toBeNull();
    expect(screen.getByText('Everything else stays the same. Adds about 5 minutes.')).toBeTruthy();
    fireEvent.press(screen.getByText('Save as my version'));
    expect(onSave).toHaveBeenCalledWith(proposal, 'add chorizo');
  });

  it('a follow-up edits the latest proposal, with the conversation so far', async () => {
    mockEdit.mockResolvedValue(proposal);
    const screen = wrap(<EditChatSheet {...base} onSave={jest.fn()} />);
    fireEvent.press(screen.getByText('Make it spicier'));
    await waitFor(() => expect(screen.getByText('Chorizo goes in first.')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Tweak it further, e.g. less spicy'), 'less oil');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(mockEdit).toHaveBeenCalledTimes(2));
    const [current, request, history] = mockEdit.mock.calls[1];
    expect(current.ingredients.map((i: { raw: string }) => i.raw)).toEqual(['150 g chorizo', '1 tsp olive oil', '1 onion']);
    expect(current.ingredients[0]).not.toHaveProperty('change');
    expect(request).toBe('less oil');
    expect(history).toEqual([
      { role: 'user', text: 'Make it spicier' },
      { role: 'assistant', text: 'Chorizo goes in first.' },
    ]);
  });

  it('offers a retry when the worker fails', async () => {
    mockEdit.mockResolvedValueOnce(null).mockResolvedValueOnce(proposal);
    const screen = wrap(<EditChatSheet {...base} onSave={jest.fn()} />);
    fireEvent.press(screen.getByText('Make it vegetarian'));
    await waitFor(() => expect(screen.getByText(/couldn’t rewrite/)).toBeTruthy());
    fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByText('Chorizo goes in first.')).toBeTruthy());
  });

  it('warns when saving replaces an existing version', async () => {
    mockEdit.mockResolvedValue(proposal);
    const screen = wrap(<EditChatSheet {...base} replacesExisting onSave={jest.fn()} />);
    fireEvent.press(screen.getByText('Make it lighter'));
    await waitFor(() => expect(screen.getByText('Replace my version')).toBeTruthy());
    expect(screen.getByText(/replaces your current version/)).toBeTruthy();
  });
});

describe('AskChatSheet', () => {
  it('answers and hands a suggested change to the change chat', async () => {
    mockAsk.mockResolvedValue({ answer: 'Yes, simmer 40 min.', suggested_change: 'Use green lentils' });
    const onApply = jest.fn();
    const screen = wrap(
      <AskChatSheet visible recipeTitle="Soup" recipe={soup} onApply={onApply} onClose={jest.fn()} />
    );
    fireEvent.changeText(screen.getByLabelText('Ask about this recipe'), 'Green lentils?');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByText('Yes, simmer 40 min.')).toBeTruthy());
    fireEvent.press(screen.getByText('Apply this to my version'));
    expect(onApply).toHaveBeenCalledWith('Use green lentils');
  });
});

describe('ManageVersionSheet', () => {
  it('shows the note and routes the actions', () => {
    const handlers = { onChangeAgain: jest.fn(), onStartOver: jest.fn(), onDelete: jest.fn() };
    const screen = wrap(<ManageVersionSheet visible note="add chorizo" onClose={jest.fn()} {...handlers} />);
    expect(screen.getByText('add chorizo')).toBeTruthy();
    fireEvent.press(screen.getByText('Change it again with Mealy AI'));
    fireEvent.press(screen.getByText('Start over from the original'));
    fireEvent.press(screen.getByText('Delete my version'));
    for (const fn of Object.values(handlers)) expect(fn).toHaveBeenCalledTimes(1);
  });
});

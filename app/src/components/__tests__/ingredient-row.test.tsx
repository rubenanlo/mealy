import { render } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import { IngredientRow } from '../ingredient-row';

describe('IngredientRow', () => {
  it('shows name left and quantity right, with the raw line beneath', async () => {
    const { getByText } = await render(
      <ThemeProvider>
        <IngredientRow
          ingredient={{
            raw: '200 g de farine de blé T55',
            quantity: 200,
            unit: 'g',
            name: 'farine',
            group: null,
            fodmap: null,
          }}
        />
      </ThemeProvider>
    );
    expect(getByText('farine')).toBeTruthy();
    expect(getByText('200 g')).toBeTruthy();
    expect(getByText('200 g de farine de blé T55')).toBeTruthy();
  });

  it('renders name only when quantity is missing', async () => {
    const { getAllByText, queryByText } = await render(
      <ThemeProvider>
        <IngredientRow
          ingredient={{ raw: 'sel', quantity: null, unit: null, name: 'sel', group: null, fodmap: null }}
        />
      </ThemeProvider>
    );
    // raw === name → single line, no duplicate muted line
    expect(getAllByText('sel')).toHaveLength(1);
    expect(queryByText('null')).toBeNull();
  });
});

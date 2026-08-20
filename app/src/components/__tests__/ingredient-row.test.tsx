import { render } from '@testing-library/react-native';

import { ThemeProvider } from '@/lib/theme';

import { IngredientRow } from '../ingredient-row';

describe('IngredientRow', () => {
  it('shows quantity + unit + name with the raw line beneath', async () => {
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
    expect(getByText('200 g farine')).toBeTruthy();
    expect(getByText('200 g de farine de blé T55')).toBeTruthy();
  });

  it('renders name only when quantity is missing', async () => {
    const { getByText, queryByText } = await render(
      <ThemeProvider>
        <IngredientRow
          ingredient={{ raw: 'sel', quantity: null, unit: null, name: 'sel', group: null, fodmap: null }}
        />
      </ThemeProvider>
    );
    expect(getByText('sel')).toBeTruthy();
    // raw === headline → no duplicate muted line
    expect(queryByText('sel', { exact: true })).toBeTruthy();
  });
});

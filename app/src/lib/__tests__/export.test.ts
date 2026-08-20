import { buildShoppingText } from '../export';

describe('buildShoppingText', () => {
  it('groups by aisle, lists unchecked only, ends with the Mealy footer', () => {
    const text = buildShoppingText([
      {
        aisle: 'Fruits & Légumes',
        items: [
          { label: 'Carottes — 450 g', checked: false },
          { label: 'Oignons — 2', checked: true },
        ],
      },
      {
        aisle: 'Crèmerie',
        items: [{ label: 'Crème — 200 ml', checked: false }],
      },
    ]);
    expect(text).toBe(
      'Fruits & Légumes\n- Carottes — 450 g\n\nCrèmerie\n- Crème — 200 ml\n\n— Mealy'
    );
  });

  it('skips aisles whose items are all checked', () => {
    const text = buildShoppingText([
      { aisle: 'Boucherie', items: [{ label: 'Poulet — 1 kg', checked: true }] },
      { aisle: 'Épicerie salée', items: [{ label: 'Riz — 500 g', checked: false }] },
    ]);
    expect(text).not.toContain('Boucherie');
    expect(text).toContain('Épicerie salée\n- Riz — 500 g');
  });

  it('returns an empty string when everything is checked or empty', () => {
    expect(buildShoppingText([])).toBe('');
    expect(
      buildShoppingText([{ aisle: 'X', items: [{ label: 'a', checked: true }] }])
    ).toBe('');
  });
});

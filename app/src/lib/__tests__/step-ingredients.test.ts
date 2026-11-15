import { amountLabel, mapStepIngredients } from '@/lib/step-ingredients';

const ing = (name: string) => ({ name });

describe('mapStepIngredients', () => {
  const ingredients = [
    ing('Basmati rice'),
    ing('Pork chops'),
    ing('Olive oil'),
    ing('Fresh ginger'),
    ing('Sweet soy sauce'),
    ing('Fresh basil'),
    ing('Salt'),
  ];
  const steps = [
    'Rinse the basmati rice, cook it for 10 minutes in salted boiling water.',
    'Debone the pork chops, cut the meat into strips, then brown it in a very hot pan with the oil.',
    'Grate the ginger, add it to the pork with the soy sauce.',
    'Add the rice to the pan, then the chopped basil off the heat.',
  ];

  it('finds what each step uses', () => {
    const { byStep, firstStep } = mapStepIngredients(steps, ingredients);
    expect(byStep).toEqual([[0, 6], [1, 2], [1, 3, 4], [0, 5]]);
    expect(firstStep).toEqual([0, 1, 1, 2, 2, 3, 0]);
  });

  it('ignores a generic word shared by two ingredients', () => {
    const { byStep } = mapStepIngredients(['Pour in the sauce.', 'Add the fish sauce.'], [
      ing('Soy sauce'),
      ing('Fish sauce'),
    ]);
    expect(byStep).toEqual([[], [1]]);
  });

  it('works in French with elisions and plurals', () => {
    const { byStep } = mapStepIngredients(
      ["Faites chauffer l'huile d'olive, ajoutez les oignons émincés."],
      [ing("Huile d'olive"), ing('Oignon'), ing('Tomates')]
    );
    expect(byStep).toEqual([[0, 1]]);
  });

  it('does not let a short word prefix-match a longer one', () => {
    const { byStep } = mapStepIngredients(['Toast the peanuts.'], [ing('Peas')]);
    expect(byStep).toEqual([[]]);
  });
});

describe('amountLabel', () => {
  it('joins quantity and unit', () => {
    expect(amountLabel({ quantity: 300, unit: 'g' })).toBe('300 g');
    expect(amountLabel({ quantity: 4, unit: null })).toBe('4');
    expect(amountLabel({ quantity: null, unit: null })).toBe('');
  });
});

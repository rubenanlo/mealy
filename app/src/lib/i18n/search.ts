// Strings for the search screen. `en` is the source of truth; the other
// languages are typed against it so a missing entry is a compile error.

const en = {
  title: 'Search',
  placeholder: 'Search recipes',
  filterAll: 'All',
  filterFish: 'Fish',
  filterMeat: 'Meat',
  filterVegan: 'Vegan',
  filterVegetarian: 'Vegetarian',
  filterLegume: 'Legume',
  filterMain: 'Lunch/dinner',
  filterBreakfast: 'Breakfast',
  filterSide: 'Side',
  filterDessert: 'Dessert',
  filterNeedsReview: 'Needs review',
  emptyLibrary: 'Your cooking notebook starts here.',
  addFirstRecipe: 'Add your first recipe',
  noMatches: 'No recipes match.',
  clearFilters: 'Clear filters',
};

const es: typeof en = {
  title: 'Buscar',
  placeholder: 'Buscar recetas',
  filterAll: 'Todas',
  filterFish: 'Pescado',
  filterMeat: 'Carne',
  filterVegan: 'Vegano',
  filterVegetarian: 'Vegetariano',
  filterLegume: 'Legumbres',
  filterMain: 'Comida/cena',
  filterBreakfast: 'Desayuno',
  filterSide: 'Guarnición',
  filterDessert: 'Postre',
  filterNeedsReview: 'Por revisar',
  emptyLibrary: 'Tu cuaderno de cocina empieza aquí.',
  addFirstRecipe: 'Añade tu primera receta',
  noMatches: 'Ninguna receta coincide.',
  clearFilters: 'Quitar filtros',
};

const fr: typeof en = {
  title: 'Rechercher',
  placeholder: 'Rechercher des recettes',
  filterAll: 'Toutes',
  filterFish: 'Poisson',
  filterMeat: 'Viande',
  filterVegan: 'Végétalien',
  filterVegetarian: 'Végétarien',
  filterLegume: 'Légumineuses',
  filterMain: 'Déjeuner/dîner',
  filterBreakfast: 'Petit-déjeuner',
  filterSide: 'Accompagnement',
  filterDessert: 'Dessert',
  filterNeedsReview: 'À vérifier',
  emptyLibrary: 'Votre carnet de cuisine commence ici.',
  addFirstRecipe: 'Ajoutez votre première recette',
  noMatches: 'Aucune recette ne correspond.',
  clearFilters: 'Effacer les filtres',
};

const it: typeof en = {
  title: 'Cerca',
  placeholder: 'Cerca ricette',
  filterAll: 'Tutte',
  filterFish: 'Pesce',
  filterMeat: 'Carne',
  filterVegan: 'Vegano',
  filterVegetarian: 'Vegetariano',
  filterLegume: 'Legumi',
  filterMain: 'Pranzo/cena',
  filterBreakfast: 'Colazione',
  filterSide: 'Contorno',
  filterDessert: 'Dolce',
  filterNeedsReview: 'Da rivedere',
  emptyLibrary: 'Il tuo quaderno di cucina inizia qui.',
  addFirstRecipe: 'Aggiungi la tua prima ricetta',
  noMatches: 'Nessuna ricetta corrisponde.',
  clearFilters: 'Cancella i filtri',
};

export const search = { en, es, fr, it };

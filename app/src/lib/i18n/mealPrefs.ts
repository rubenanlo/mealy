// Strings for the mealPrefs screens. Filled during the i18n sweep.

const en = {
  backToSettings: 'Back to settings',
  settings: 'Settings',
  title: 'Meal preferences',
  quotasHint: 'Protein quotas per person, per week (min – max).',
  categoryFish: 'Fish',
  categoryMeat: 'Meat',
  categoryVegetarian: 'Vegetarian',
  decrease: 'Decrease {label}',
  increase: 'Increase {label}',
  minimumOf: 'minimum {label}',
  maximumOf: 'maximum {label}',
  noPeople: 'No people yet — add your household under Manage your account.',
  suggestions: 'Suggestions',
  suggestionsHint:
    'Weeks a recipe rests after being planned before it reappears in Suggested for you. 0 hides only this week’s picks.',
  restWeeks: 'Rest weeks',
  mealTimes: 'Meal times',
  mealTimesHint:
    'When lunch and dinner happen. The week page uses the end time to know a meal is done.',
  timesError: 'Times must be HH:MM, e.g. 13:30.',
  saved: 'Saved',
  saveMealTimes: 'Save meal times',
  otherRequirements: 'Other requirements',
  otherRequirementsHint: 'Free text for the whole household, used as-is when planning.',
  otherRequirementsPlaceholder: 'e.g. no pork, light dinner on Sundays…',
};

const es: typeof en = {
  backToSettings: 'Volver a ajustes',
  settings: 'Ajustes',
  title: 'Preferencias de comidas',
  quotasHint: 'Cuotas de proteína por persona y semana (mín – máx).',
  categoryFish: 'Pescado',
  categoryMeat: 'Carne',
  categoryVegetarian: 'Vegetariano',
  decrease: 'Reducir {label}',
  increase: 'Aumentar {label}',
  minimumOf: 'mínimo de {label}',
  maximumOf: 'máximo de {label}',
  noPeople: 'Aún no hay personas. Añade tu hogar en Gestionar tu cuenta.',
  suggestions: 'Sugerencias',
  suggestionsHint:
    'Semanas que descansa una receta tras planificarse antes de reaparecer en Sugerencias para ti. 0 oculta solo las de esta semana.',
  restWeeks: 'Semanas de descanso',
  mealTimes: 'Horarios de comida',
  mealTimesHint:
    'Cuándo son la comida y la cena. La página de la semana usa la hora de fin para saber que una comida terminó.',
  timesError: 'Las horas deben ser HH:MM, p. ej. 13:30.',
  saved: 'Guardado',
  saveMealTimes: 'Guardar horarios',
  otherRequirements: 'Otros requisitos',
  otherRequirementsHint: 'Texto libre para todo el hogar, se usa tal cual al planificar.',
  otherRequirementsPlaceholder: 'p. ej. sin cerdo, cena ligera los domingos…',
};

const fr: typeof en = {
  backToSettings: 'Retour aux réglages',
  settings: 'Réglages',
  title: 'Préférences de repas',
  quotasHint: 'Quotas de protéines par personne et par semaine (min – max).',
  categoryFish: 'Poisson',
  categoryMeat: 'Viande',
  categoryVegetarian: 'Végétarien',
  decrease: 'Diminuer {label}',
  increase: 'Augmenter {label}',
  minimumOf: 'minimum de {label}',
  maximumOf: 'maximum de {label}',
  noPeople: 'Pas encore de personnes. Ajoutez votre foyer sous Gérer votre compte.',
  suggestions: 'Suggestions',
  suggestionsHint:
    'Semaines de repos d’une recette après avoir été planifiée avant de réapparaître dans Suggestions pour vous. 0 masque uniquement les choix de cette semaine.',
  restWeeks: 'Semaines de repos',
  mealTimes: 'Horaires des repas',
  mealTimesHint:
    'Quand ont lieu le déjeuner et le dîner. La page de la semaine utilise l’heure de fin pour savoir qu’un repas est terminé.',
  timesError: 'Les heures doivent être au format HH:MM, p. ex. 13:30.',
  saved: 'Enregistré',
  saveMealTimes: 'Enregistrer les horaires',
  otherRequirements: 'Autres exigences',
  otherRequirementsHint:
    'Texte libre pour tout le foyer, utilisé tel quel pour la planification.',
  otherRequirementsPlaceholder: 'p. ex. pas de porc, dîner léger le dimanche…',
};

const it: typeof en = {
  backToSettings: 'Torna alle impostazioni',
  settings: 'Impostazioni',
  title: 'Preferenze dei pasti',
  quotasHint: 'Quote di proteine per persona, a settimana (min – max).',
  categoryFish: 'Pesce',
  categoryMeat: 'Carne',
  categoryVegetarian: 'Vegetariano',
  decrease: 'Diminuisci {label}',
  increase: 'Aumenta {label}',
  minimumOf: 'minimo di {label}',
  maximumOf: 'massimo di {label}',
  noPeople: 'Ancora nessuna persona. Aggiungi la tua famiglia in Gestisci il tuo account.',
  suggestions: 'Suggerimenti',
  suggestionsHint:
    'Settimane di riposo di una ricetta dopo essere stata pianificata prima di riapparire in Suggeriti per te. 0 nasconde solo le scelte di questa settimana.',
  restWeeks: 'Settimane di riposo',
  mealTimes: 'Orari dei pasti',
  mealTimesHint:
    'Quando si pranza e si cena. La pagina della settimana usa l’orario di fine per sapere che un pasto è concluso.',
  timesError: 'Gli orari devono essere HH:MM, es. 13:30.',
  saved: 'Salvato',
  saveMealTimes: 'Salva gli orari',
  otherRequirements: 'Altri requisiti',
  otherRequirementsHint:
    'Testo libero per tutta la famiglia, usato così com’è nella pianificazione.',
  otherRequirementsPlaceholder: 'es. niente maiale, cena leggera la domenica…',
};

export const mealPrefs = { en, es, fr, it };

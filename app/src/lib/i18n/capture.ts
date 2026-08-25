// Strings for the capture screens. Filled during the i18n sweep.
// NOTE: capture.test.tsx asserts the English values of `title`, `createManual`
// and `captureButton` — keep those exact.

const en = {
  title: 'Add a recipe',
  creating: 'Creating “{title}”.',
  manualSection: 'Manual input',
  manualHint: 'Start from a blank recipe and fill in the details yourself.',
  createManual: 'Create it yourself',
  autoSection: 'Automatic',
  autoHint: 'Paste a link (website, Instagram, TikTok) or the full recipe text.',
  pastePlaceholder: 'Paste a link or text',
  fetchFailed: 'Could not fetch the recipe. Paste the text below.',
  captureButton: 'Capture',
  photos: 'Photos',
  pdf: 'PDF',
  importPhotos: 'Import from photos',
  importPdf: 'Import a PDF',
  analyzing: 'Analyzing…',
  createError: 'Could not create the recipe. Try again.',
  importError: 'Something went wrong during the import. Try again.',
  sessionExpired: 'Session expired — sign in again.',
};

const es: typeof en = {
  title: 'Añadir una receta',
  creating: 'Creando «{title}».',
  manualSection: 'Entrada manual',
  manualHint: 'Empieza con una receta en blanco y rellena tú los detalles.',
  createManual: 'Créala tú mismo',
  autoSection: 'Automático',
  autoHint: 'Pega un enlace (web, Instagram, TikTok) o el texto completo de la receta.',
  pastePlaceholder: 'Pega un enlace o texto',
  fetchFailed: 'No se pudo obtener la receta. Pega el texto abajo.',
  captureButton: 'Capturar',
  photos: 'Fotos',
  pdf: 'PDF',
  importPhotos: 'Importar desde fotos',
  importPdf: 'Importar un PDF',
  analyzing: 'Analizando…',
  createError: 'No se pudo crear la receta. Inténtalo de nuevo.',
  importError: 'Algo salió mal durante la importación. Inténtalo de nuevo.',
  sessionExpired: 'La sesión ha caducado — inicia sesión de nuevo.',
};

const fr: typeof en = {
  title: 'Ajouter une recette',
  creating: 'Création de « {title} ».',
  manualSection: 'Saisie manuelle',
  manualHint: 'Partez d’une recette vierge et remplissez les détails vous-même.',
  createManual: 'Créez-la vous-même',
  autoSection: 'Automatique',
  autoHint: 'Collez un lien (site web, Instagram, TikTok) ou le texte complet de la recette.',
  pastePlaceholder: 'Collez un lien ou un texte',
  fetchFailed: 'Impossible de récupérer la recette. Collez le texte ci-dessous.',
  captureButton: 'Capturer',
  photos: 'Photos',
  pdf: 'PDF',
  importPhotos: 'Importer depuis des photos',
  importPdf: 'Importer un PDF',
  analyzing: 'Analyse en cours…',
  createError: 'Impossible de créer la recette. Réessayez.',
  importError: 'Une erreur est survenue pendant l’importation. Réessayez.',
  sessionExpired: 'Session expirée — reconnectez-vous.',
};

const it: typeof en = {
  title: 'Aggiungi una ricetta',
  creating: 'Creazione di “{title}”.',
  manualSection: 'Inserimento manuale',
  manualHint: 'Parti da una ricetta vuota e compila tu i dettagli.',
  createManual: 'Creala tu',
  autoSection: 'Automatico',
  autoHint: 'Incolla un link (sito web, Instagram, TikTok) o il testo completo della ricetta.',
  pastePlaceholder: 'Incolla un link o del testo',
  fetchFailed: 'Impossibile recuperare la ricetta. Incolla il testo qui sotto.',
  captureButton: 'Cattura',
  photos: 'Foto',
  pdf: 'PDF',
  importPhotos: 'Importa da foto',
  importPdf: 'Importa un PDF',
  analyzing: 'Analisi in corso…',
  createError: 'Impossibile creare la ricetta. Riprova.',
  importError: 'Qualcosa è andato storto durante l’importazione. Riprova.',
  sessionExpired: 'Sessione scaduta — accedi di nuovo.',
};

export const capture = { en, es, fr, it };

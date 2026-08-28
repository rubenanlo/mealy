// Strings for the onboarding screens. Filled during the i18n sweep.

const en = {
  welcome: 'Welcome to Mealy',
  startFamily: 'Start your family',
  startBody: 'Create your family’s cooking notebook. You can invite everyone else next.',
  namePlaceholder: 'Family name (e.g. The Andinos)',
  createFamily: 'Create family',
  createError: 'Could not create the family. Try again.',
  joining: 'Joining a family?',
  joiningBody: 'Ask a family member to invite {email} from Settings → Family, then check again.',
  checkInvite: 'Check for an invite',
  noInvite: 'No invite for {email} yet.',
  signOut: 'Sign out',
  emailFallback: 'your email address',
};

const es: typeof en = {
  welcome: 'Te damos la bienvenida a Mealy',
  startFamily: 'Crea tu familia',
  startBody: 'Crea el cuaderno de cocina de tu familia. Después podrás invitar a los demás.',
  namePlaceholder: 'Nombre de la familia (p. ej. Los Andino)',
  createFamily: 'Crear familia',
  createError: 'No se pudo crear la familia. Inténtalo de nuevo.',
  joining: '¿Te unes a una familia?',
  joiningBody: 'Pide a un miembro de la familia que invite a {email} desde Ajustes → Familia y vuelve a comprobarlo.',
  checkInvite: 'Comprobar si hay invitación',
  noInvite: 'Todavía no hay ninguna invitación para {email}.',
  signOut: 'Cerrar sesión',
  emailFallback: 'tu correo electrónico',
};

const fr: typeof en = {
  welcome: 'Bienvenue sur Mealy',
  startFamily: 'Créez votre famille',
  startBody: 'Créez le carnet de cuisine de votre famille. Vous pourrez ensuite inviter les autres.',
  namePlaceholder: 'Nom de la famille (p. ex. Les Andino)',
  createFamily: 'Créer la famille',
  createError: 'Impossible de créer la famille. Réessayez.',
  joining: 'Vous rejoignez une famille ?',
  joiningBody: 'Demandez à un membre de la famille d’inviter {email} depuis Réglages → Famille, puis vérifiez à nouveau.',
  checkInvite: 'Vérifier les invitations',
  noInvite: 'Pas encore d’invitation pour {email}.',
  signOut: 'Se déconnecter',
  emailFallback: 'votre adresse e-mail',
};

const it: typeof en = {
  welcome: 'Ti diamo il benvenuto su Mealy',
  startFamily: 'Crea la tua famiglia',
  startBody: 'Crea il quaderno di cucina della tua famiglia. Poi potrai invitare tutti gli altri.',
  namePlaceholder: 'Nome della famiglia (es. Gli Andino)',
  createFamily: 'Crea famiglia',
  createError: 'Impossibile creare la famiglia. Riprova.',
  joining: 'Ti unisci a una famiglia?',
  joiningBody: 'Chiedi a un membro della famiglia di invitare {email} da Impostazioni → Famiglia, poi controlla di nuovo.',
  checkInvite: 'Controlla se c’è un invito',
  noInvite: 'Ancora nessun invito per {email}.',
  signOut: 'Esci',
  emailFallback: 'il tuo indirizzo email',
};

export const onboarding = { en, es, fr, it };

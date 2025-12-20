/**
 * German Translations
 * Deutsche Übersetzungen für GigaPDF
 */

export default {
  common: {
    loading: 'Wird geladen...',
    error: 'Fehler',
    success: 'Erfolg',
    cancel: 'Abbrechen',
    confirm: 'Bestätigen',
    delete: 'Löschen',
    save: 'Speichern',
    edit: 'Bearbeiten',
    done: 'Fertig',
    back: 'Zurück',
    next: 'Weiter',
    skip: 'Überspringen',
    retry: 'Wiederholen',
    close: 'Schließen',
    search: 'Suchen',
    filter: 'Filtern',
    sort: 'Sortieren',
    share: 'Teilen',
    download: 'Herunterladen',
    upload: 'Hochladen',
    create: 'Erstellen',
    update: 'Aktualisieren',
    remove: 'Entfernen',
    yes: 'Ja',
    no: 'Nein',
    ok: 'OK',
  },

  auth: {
    login: 'Anmelden',
    logout: 'Abmelden',
    register: 'Registrieren',
    email: 'E-Mail',
    password: 'Passwort',
    confirmPassword: 'Passwort bestätigen',
    forgotPassword: 'Passwort vergessen?',
    resetPassword: 'Passwort zurücksetzen',
    name: 'Name',
    loginButton: 'Einloggen',
    registerButton: 'Registrieren',
    alreadyHaveAccount: 'Haben Sie bereits ein Konto?',
    dontHaveAccount: 'Haben Sie noch kein Konto?',
    loginWithGoogle: 'Mit Google fortfahren',
    loginWithApple: 'Mit Apple fortfahren',
    rememberMe: 'Angemeldet bleiben',

    errors: {
      invalidCredentials: 'Ungültige E-Mail oder Passwort',
      emailRequired: 'E-Mail ist erforderlich',
      passwordRequired: 'Passwort ist erforderlich',
      nameRequired: 'Name ist erforderlich',
      emailInvalid: 'E-Mail ist ungültig',
      passwordTooShort: 'Passwort muss mindestens 8 Zeichen lang sein',
      passwordsDoNotMatch: 'Passwörter stimmen nicht überein',
      emailAlreadyExists: 'Diese E-Mail wird bereits verwendet',
    },

    success: {
      loginSuccess: 'Anmeldung erfolgreich',
      registerSuccess: 'Registrierung erfolgreich',
      passwordResetSent: 'Zurücksetzungs-E-Mail gesendet',
      passwordResetSuccess: 'Passwort erfolgreich zurückgesetzt',
    },
  },

  documents: {
    title: 'Meine Dokumente',
    myDocuments: 'Meine Dokumente',
    recentDocuments: 'Kürzliche Dokumente',
    favorites: 'Favoriten',
    trash: 'Papierkorb',
    allDocuments: 'Alle Dokumente',
    noDocuments: 'Keine Dokumente',
    noDocumentsDescription: 'Laden Sie Ihr erstes PDF-Dokument hoch',
  },

  tools: {
    title: 'PDF-Werkzeuge',
    allTools: 'Alle Werkzeuge',
    popularTools: 'Beliebte Werkzeuge',
  },

  settings: {
    title: 'Einstellungen',
    account: 'Konto',
    profile: 'Profil',
    preferences: 'Präferenzen',
    security: 'Sicherheit',
    subscription: 'Abonnement',
    about: 'Über',
  },

  errors: {
    networkError: 'Netzwerkfehler. Überprüfen Sie Ihre Verbindung.',
    serverError: 'Serverfehler. Bitte versuchen Sie es erneut.',
    unknownError: 'Ein unerwarteter Fehler ist aufgetreten',
    fileTooBig: 'Datei ist zu groß',
    invalidFileType: 'Ungültiger Dateityp',
    operationFailed: 'Operation fehlgeschlagen',
    unauthorized: 'Nicht autorisiert',
    forbidden: 'Zugriff verweigert',
    notFound: 'Ressource nicht gefunden',
    timeout: 'Zeitüberschreitung',
  },

  validation: {
    required: 'Dieses Feld ist erforderlich',
    email: 'Ungültige E-Mail',
    minLength: 'Mindestens {{min}} Zeichen',
    maxLength: 'Maximal {{max}} Zeichen',
    passwordMatch: 'Passwörter müssen übereinstimmen',
    invalidFormat: 'Ungültiges Format',
  },
};

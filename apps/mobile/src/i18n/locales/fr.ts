/**
 * French Translations
 * Traductions françaises pour GigaPDF
 */

export default {
  // Common
  common: {
    loading: 'Chargement...',
    error: 'Erreur',
    success: 'Succès',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    delete: 'Supprimer',
    save: 'Enregistrer',
    edit: 'Modifier',
    done: 'Terminé',
    back: 'Retour',
    next: 'Suivant',
    skip: 'Passer',
    retry: 'Réessayer',
    close: 'Fermer',
    search: 'Rechercher',
    filter: 'Filtrer',
    sort: 'Trier',
    share: 'Partager',
    download: 'Télécharger',
    upload: 'Téléverser',
    create: 'Créer',
    update: 'Mettre à jour',
    remove: 'Retirer',
    yes: 'Oui',
    no: 'Non',
    ok: 'OK',
  },

  // Authentication
  auth: {
    login: 'Connexion',
    logout: 'Déconnexion',
    register: 'Inscription',
    email: 'Email',
    password: 'Mot de passe',
    confirmPassword: 'Confirmer le mot de passe',
    forgotPassword: 'Mot de passe oublié ?',
    resetPassword: 'Réinitialiser le mot de passe',
    name: 'Nom',
    loginButton: 'Se connecter',
    registerButton: "S'inscrire",
    alreadyHaveAccount: 'Vous avez déjà un compte ?',
    dontHaveAccount: "Vous n'avez pas de compte ?",
    loginWithGoogle: 'Continuer avec Google',
    loginWithApple: 'Continuer avec Apple',
    rememberMe: 'Se souvenir de moi',

    errors: {
      invalidCredentials: 'Email ou mot de passe invalide',
      emailRequired: "L'email est requis",
      passwordRequired: 'Le mot de passe est requis',
      nameRequired: 'Le nom est requis',
      emailInvalid: "L'email est invalide",
      passwordTooShort: 'Le mot de passe doit contenir au moins 8 caractères',
      passwordsDoNotMatch: 'Les mots de passe ne correspondent pas',
      emailAlreadyExists: 'Cet email est déjà utilisé',
    },

    success: {
      loginSuccess: 'Connexion réussie',
      registerSuccess: 'Inscription réussie',
      passwordResetSent: 'Email de réinitialisation envoyé',
      passwordResetSuccess: 'Mot de passe réinitialisé avec succès',
    },
  },

  // Documents
  documents: {
    title: 'Mes Documents',
    myDocuments: 'Mes Documents',
    recentDocuments: 'Documents récents',
    favorites: 'Favoris',
    trash: 'Corbeille',
    allDocuments: 'Tous les documents',
    noDocuments: 'Aucun document',
    noDocumentsDescription: 'Commencez par téléverser votre premier document PDF',
    createDocument: 'Créer un document',
    uploadDocument: 'Téléverser un document',
    renameDocument: 'Renommer le document',
    deleteDocument: 'Supprimer le document',
    restoreDocument: 'Restaurer le document',
    duplicateDocument: 'Dupliquer le document',
    moveToFolder: 'Déplacer vers un dossier',
    addToFavorites: 'Ajouter aux favoris',
    removeFromFavorites: 'Retirer des favoris',
    documentDetails: 'Détails du document',

    properties: {
      name: 'Nom',
      size: 'Taille',
      pages: 'Pages',
      created: 'Créé le',
      modified: 'Modifié le',
      format: 'Format',
      author: 'Auteur',
    },

    actions: {
      open: 'Ouvrir',
      share: 'Partager',
      download: 'Télécharger',
      delete: 'Supprimer',
      rename: 'Renommer',
      duplicate: 'Dupliquer',
      favorite: 'Favori',
      move: 'Déplacer',
      restore: 'Restaurer',
    },

    errors: {
      uploadFailed: 'Échec du téléversement',
      deleteFailed: 'Échec de la suppression',
      renameFailed: 'Échec du renommage',
      notFound: 'Document introuvable',
    },

    success: {
      uploaded: 'Document téléversé avec succès',
      deleted: 'Document supprimé avec succès',
      renamed: 'Document renommé avec succès',
      duplicated: 'Document dupliqué avec succès',
      restored: 'Document restauré avec succès',
    },
  },

  // PDF Tools
  tools: {
    title: 'Outils PDF',
    allTools: 'Tous les outils',
    popularTools: 'Outils populaires',

    categories: {
      organize: 'Organiser',
      optimize: 'Optimiser',
      convert: 'Convertir',
      secure: 'Sécuriser',
      edit: 'Éditer',
    },

    merge: {
      title: 'Fusionner PDF',
      description: 'Combiner plusieurs fichiers PDF en un seul',
      selectFiles: 'Sélectionner les fichiers',
      reorderFiles: 'Réorganiser les fichiers',
      mergeButton: 'Fusionner',
    },

    split: {
      title: 'Diviser PDF',
      description: 'Extraire des pages ou diviser un PDF',
      selectPages: 'Sélectionner les pages',
      splitBy: 'Diviser par',
      pages: 'Pages',
      ranges: 'Plages',
      splitButton: 'Diviser',
    },

    compress: {
      title: 'Compresser PDF',
      description: 'Réduire la taille du fichier PDF',
      quality: 'Qualité',
      low: 'Basse (fichier plus petit)',
      medium: 'Moyenne (équilibré)',
      high: 'Haute (meilleure qualité)',
      compressButton: 'Compresser',
    },

    convert: {
      title: 'Convertir PDF',
      description: 'Convertir PDF vers/depuis d\'autres formats',
      selectFormat: 'Sélectionner le format',
      convertButton: 'Convertir',
      formats: {
        jpg: 'Image JPG',
        png: 'Image PNG',
        word: 'Document Word',
        excel: 'Feuille Excel',
        ppt: 'Présentation PowerPoint',
        txt: 'Fichier texte',
        html: 'Page web HTML',
      },
    },

    rotate: {
      title: 'Faire pivoter PDF',
      description: 'Faire pivoter les pages du PDF',
      selectPages: 'Sélectionner les pages',
      allPages: 'Toutes les pages',
      rotation: 'Rotation',
      rotateButton: 'Faire pivoter',
    },

    watermark: {
      title: 'Ajouter filigrane',
      description: 'Ajouter un filigrane de texte ou image',
      text: 'Texte',
      image: 'Image',
      position: 'Position',
      opacity: 'Opacité',
      addButton: 'Ajouter filigrane',
    },

    protect: {
      title: 'Protéger PDF',
      description: 'Ajouter un mot de passe au PDF',
      setPassword: 'Définir le mot de passe',
      permissions: 'Permissions',
      allowPrinting: 'Autoriser impression',
      allowCopying: 'Autoriser copie',
      allowModification: 'Autoriser modification',
      protectButton: 'Protéger',
    },

    unlock: {
      title: 'Déverrouiller PDF',
      description: 'Retirer le mot de passe du PDF',
      enterPassword: 'Entrer le mot de passe',
      unlockButton: 'Déverrouiller',
    },

    ocr: {
      title: 'OCR',
      description: 'Extraire le texte des images',
      selectLanguage: 'Sélectionner la langue',
      processButton: 'Traiter',
    },

    sign: {
      title: 'Signer PDF',
      description: 'Ajouter une signature au PDF',
      draw: 'Dessiner',
      type: 'Taper',
      upload: 'Téléverser',
      signButton: 'Signer',
    },
  },

  // Settings
  settings: {
    title: 'Paramètres',
    account: 'Compte',
    profileTitle: 'Profil',
    preferencesTitle: 'Préférences',
    securityTitle: 'Sécurité',
    subscriptionTitle: 'Abonnement',
    aboutTitle: 'À propos',

    profile: {
      editProfile: 'Modifier le profil',
      changeName: 'Modifier le nom',
      changeEmail: 'Modifier l\'email',
      changePassword: 'Modifier le mot de passe',
      currentPassword: 'Mot de passe actuel',
      newPassword: 'Nouveau mot de passe',
      confirmNewPassword: 'Confirmer le nouveau mot de passe',
    },

    preferences: {
      language: 'Langue',
      theme: 'Thème',
      notifications: 'Notifications',
      autoSave: 'Sauvegarde automatique',
      defaultQuality: 'Qualité par défaut',
      light: 'Clair',
      dark: 'Sombre',
      auto: 'Automatique',
    },

    quota: {
      title: 'Quota gratuit',
      openSource: 'Open Source',
      free: 'Gratuit',
      usage: 'Utilisation',
      storage: 'Stockage',
      storageLimit: 'Limite de stockage',
      apiCalls: 'Appels API',
      apiCallsLimit: 'Appels API par mois',
      unlimited: 'Illimité',
    },

    security: {
      changePassword: 'Modifier le mot de passe',
      twoFactorAuth: 'Authentification à deux facteurs',
      enable2FA: 'Activer 2FA',
      disable2FA: 'Désactiver 2FA',
      deleteAccount: 'Supprimer le compte',
      deleteAccountWarning: 'Cette action est irréversible',
    },

    about: {
      version: 'Version',
      termsOfService: 'Conditions d\'utilisation',
      privacyPolicy: 'Politique de confidentialité',
      contactSupport: 'Contacter le support',
      rateApp: 'Noter l\'application',
    },
  },

  // Errors
  errors: {
    networkError: 'Erreur réseau. Vérifiez votre connexion.',
    serverError: 'Erreur serveur. Veuillez réessayer.',
    unknownError: 'Une erreur inattendue s\'est produite',
    fileTooBig: 'Le fichier est trop volumineux',
    invalidFileType: 'Type de fichier invalide',
    operationFailed: 'L\'opération a échoué',
    unauthorized: 'Non autorisé',
    forbidden: 'Accès refusé',
    notFound: 'Ressource introuvable',
    timeout: 'Délai d\'attente dépassé',
  },

  // Validation
  validation: {
    required: 'Ce champ est requis',
    email: 'Email invalide',
    minLength: 'Minimum {{min}} caractères',
    maxLength: 'Maximum {{max}} caractères',
    passwordMatch: 'Les mots de passe doivent correspondre',
    invalidFormat: 'Format invalide',
  },
};

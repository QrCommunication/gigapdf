# Architecture GigaPDF Mobile

## Vue d'ensemble

Application React Native avec Expo Router pour la gestion et manipulation de documents PDF.

## Stack Technique

### Core
- **React Native 0.81.5** - Framework mobile cross-platform
- **Expo ~54.0** - Plateforme de développement et déploiement
- **TypeScript 5.9** - Typage statique pour la robustesse du code
- **Expo Router ~6.0** - Navigation basée sur le système de fichiers

### État et Données
- **Zustand 5.0** - Gestion d'état global légère et performante
- **@tanstack/react-query 5.59** - Cache, synchronisation et gestion des requêtes serveur
- **Axios 1.7** - Client HTTP avec intercepteurs

### UI/UX
- **React Native Gesture Handler 2.28** - Gestion native des gestes
- **React Native Reanimated 4.1** - Animations 60fps natives
- **React Native Safe Area Context 5.6** - Gestion des zones sûres (notch, etc.)

## Architecture des Dossiers

```
/home/rony/Projets/gigapdf/apps/mobile/
│
├── app/                          # Routes Expo Router (file-based routing)
│   ├── _layout.tsx              # Layout racine avec providers
│   ├── index.tsx                # Point d'entrée (redirection auth)
│   │
│   ├── (auth)/                   # Groupe d'authentification
│   │   ├── _layout.tsx          # Layout sans tabs
│   │   ├── login.tsx            # Écran de connexion
│   │   ├── register.tsx         # Écran d'inscription
│   │   └── forgot-password.tsx  # Récupération mot de passe
│   │
│   ├── (tabs)/                   # Groupe avec navigation tabs
│   │   ├── _layout.tsx          # Layout avec TabBar
│   │   ├── index.tsx            # Documents (onglet 1)
│   │   ├── tools.tsx            # Outils PDF (onglet 2)
│   │   └── settings.tsx         # Paramètres (onglet 3)
│   │
│   └── document/
│       └── [id].tsx             # Vue détaillée d'un document
│
├── src/
│   ├── components/              # Composants réutilisables
│   │   ├── DocumentCard.tsx    # Carte de document
│   │   ├── ToolCard.tsx        # Carte d'outil PDF
│   │   ├── SearchBar.tsx       # Barre de recherche
│   │   ├── FAB.tsx             # Floating Action Button
│   │   ├── EmptyState.tsx      # État vide
│   │   └── SettingsItem.tsx    # Item de paramètre
│   │
│   ├── constants/               # Constantes de l'application
│   │   ├── api.ts              # URLs et endpoints API
│   │   ├── colors.ts           # Palette de couleurs (light/dark)
│   │   ├── spacing.ts          # Espacements standardisés
│   │   ├── tools.ts            # Définition des outils PDF
│   │   └── config.ts           # Configuration générale
│   │
│   ├── contexts/
│   │   └── ThemeContext.tsx    # Contexte de thème
│   │
│   ├── hooks/                   # Hooks personnalisés
│   │   ├── useDocuments.ts     # Hook pour documents (React Query)
│   │   ├── usePDF.ts           # Hook pour opérations PDF
│   │   └── useTheme.ts         # Hook pour le thème
│   │
│   ├── i18n/                    # Internationalisation
│   │   ├── i18n.config.ts      # Configuration i18next
│   │   ├── index.ts            # Exports
│   │   └── locales/
│   │       ├── en.ts           # Anglais
│   │       ├── fr.ts           # Français (complet)
│   │       ├── es.ts           # Espagnol
│   │       └── de.ts           # Allemand
│   │
│   ├── services/                # Services API
│   │   ├── api.ts              # Client Axios avec intercepteurs
│   │   ├── auth.ts             # Service d'authentification
│   │   ├── documents.ts        # Service de documents
│   │   ├── pages.ts            # Service de pages PDF
│   │   ├── elements.ts         # Service d'éléments (texte, image, etc.)
│   │   ├── annotations.ts      # Service d'annotations
│   │   ├── pdf.ts              # Service d'opérations PDF
│   │   ├── types.ts            # Types pour services
│   │   └── index.ts            # Exports
│   │
│   ├── stores/                  # États Zustand
│   │   ├── authStore.ts        # État d'authentification
│   │   ├── documentStore.ts    # État des documents
│   │   ├── settingsStore.ts    # État des paramètres
│   │   └── index.ts            # Exports
│   │
│   ├── types/                   # Types TypeScript
│   │   ├── api.ts              # Types API génériques
│   │   ├── user.ts             # Types utilisateur et auth
│   │   ├── document.ts         # Types documents et dossiers
│   │   ├── pdf.ts              # Types opérations PDF
│   │   ├── tools.ts            # Types d'outils
│   │   └── index.ts            # Exports
│   │
│   └── utils/                   # Fonctions utilitaires
│       ├── formatting.ts       # Formatage (dates, tailles, etc.)
│       ├── validation.ts       # Validation de formulaires
│       └── helpers.ts          # Fonctions helpers
│
├── assets/                      # Ressources statiques
├── app.json                     # Configuration Expo
├── package.json                 # Dépendances npm
├── tsconfig.json               # Configuration TypeScript
└── README.md                    # Documentation

```

## Flux de Données

### 1. Authentification

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│   Login     │────>│  authStore   │────>│ authService │────>│   API    │
│   Screen    │     │  (Zustand)   │     │   (Axios)   │     │  Server  │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────┘
                            │                                       │
                            │<──────── JWT Tokens ─────────────────┘
                            │
                            v
                    ┌──────────────┐
                    │ SecureStore  │
                    │ (encrypted)  │
                    └──────────────┘
```

### 2. Documents

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Documents  │────>│ documentStore│────>│  React      │
│   Screen    │     │  (Zustand)   │     │  Query      │
└─────────────┘     └──────────────┘     └─────────────┘
                                                  │
                                                  v
                                          ┌──────────────┐
                                          │documentsService
                                          │   (Axios)    │
                                          └──────────────┘
                                                  │
                                                  v
                                          ┌──────────────┐
                                          │   API        │
                                          │   Server     │
                                          └──────────────┘
```

### 3. Paramètres

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Settings   │────>│settingsStore │────>│ AsyncStorage │
│   Screen    │     │  (Zustand)   │     │   (local)    │
└─────────────┘     └──────────────┘     └──────────────┘
```

## Stores Zustand

### authStore

**État:**
- `user: User | null` - Utilisateur connecté
- `isAuthenticated: boolean` - Statut de connexion
- `isLoading: boolean` - Chargement en cours
- `error: string | null` - Erreur d'authentification

**Actions:**
- `login(credentials)` - Connexion
- `register(data)` - Inscription
- `logout()` - Déconnexion
- `loadUser()` - Charger l'utilisateur depuis le token
- `updateUser(data)` - Mettre à jour le profil
- `clearError()` - Effacer l'erreur
- `setUser(user)` - Définir l'utilisateur manuellement

**Fichier:** `/home/rony/Projets/gigapdf/apps/mobile/src/stores/authStore.ts`

### documentStore

**État:**
- `documents: Document[]` - Liste des documents
- `currentDocument: Document | null` - Document actuel
- `folders: Folder[]` - Liste des dossiers
- `currentFolder: Folder | null` - Dossier actuel
- `filter: DocumentFilter` - Filtres appliqués
- `isLoading: boolean` - Chargement en cours
- `error: string | null` - Erreur
- `uploadProgress: number` - Progression upload (0-100)

**Actions:**
- Documents: `setDocuments`, `addDocument`, `updateDocument`, `removeDocument`, `setCurrentDocument`, `toggleFavorite`
- Dossiers: `setFolders`, `addFolder`, `updateFolder`, `removeFolder`, `setCurrentFolder`
- Filtres: `setFilter`, `resetFilter`
- État: `setLoading`, `setError`, `setUploadProgress`, `clearError`

**Fichier:** `/home/rony/Projets/gigapdf/apps/mobile/src/stores/documentStore.ts`

### settingsStore

**État:**
- `language: SupportedLanguage` - Langue ('en' | 'fr' | 'es' | 'de')
- `theme: ThemeMode` - Thème ('light' | 'dark' | 'auto')
- `notificationsEnabled: boolean` - Notifications activées
- `autoSave: boolean` - Sauvegarde automatique
- `defaultQuality: DefaultQuality` - Qualité par défaut ('low' | 'medium' | 'high')
- `isLoading: boolean` - Chargement en cours

**Actions:**
- `setLanguage(language)` - Changer la langue
- `setTheme(theme)` - Changer le thème
- `setNotificationsEnabled(enabled)` - Activer/désactiver notifications
- `setAutoSave(enabled)` - Activer/désactiver sauvegarde auto
- `setDefaultQuality(quality)` - Définir qualité par défaut
- `loadSettings()` - Charger les paramètres sauvegardés
- `resetSettings()` - Réinitialiser aux valeurs par défaut

**Fichier:** `/home/rony/Projets/gigapdf/apps/mobile/src/stores/settingsStore.ts`

## Services API

### API Client (`api.ts`)

Client Axios centralisé avec:

**Features:**
- Intercepteurs de requête (ajout automatique du token)
- Intercepteurs de réponse (gestion erreurs)
- Refresh token automatique
- Gestion timeout
- Upload/Download avec progression
- Logging en développement

**Token Management:**
- Stockage sécurisé avec `expo-secure-store`
- Refresh automatique sur 401
- File d'attente pour requêtes pendant refresh

**Fichier:** `/home/rony/Projets/gigapdf/apps/mobile/src/services/api.ts`

### Auth Service (`auth.ts`)

**Méthodes:**
- `login(credentials)` - Connexion email/password
- `register(data)` - Inscription
- `logout()` - Déconnexion
- `refreshToken()` - Rafraîchir le token
- `getCurrentUser()` - Obtenir l'utilisateur actuel
- `updateProfile(data)` - Mettre à jour le profil
- `changePassword()` - Changer le mot de passe
- `requestPasswordReset(email)` - Demander réinitialisation
- `resetPassword()` - Réinitialiser le mot de passe
- `verifyEmail(token)` - Vérifier l'email
- `deleteAccount(password)` - Supprimer le compte

**Social Auth:**
- `loginWithGoogle(idToken)` - Connexion Google
- `loginWithFacebook(accessToken)` - Connexion Facebook
- `loginWithApple(identityToken, authCode)` - Connexion Apple

**2FA:**
- `enable()` - Activer 2FA
- `confirm(code)` - Confirmer 2FA
- `disable(password)` - Désactiver 2FA
- `verify(code, tempToken)` - Vérifier code 2FA
- `getRecoveryCodes()` - Obtenir codes de récupération
- `regenerateRecoveryCodes(password)` - Régénérer codes

**Fichier:** `/home/rony/Projets/gigapdf/apps/mobile/src/services/auth.ts`

## API Endpoints

Base URL: `https://giga-pdf.com/api/v1`

### Authentication
```
POST   /auth/login              - Connexion
POST   /auth/register           - Inscription
POST   /auth/logout             - Déconnexion
POST   /auth/refresh            - Rafraîchir le token
GET    /auth/me                 - Utilisateur actuel
POST   /auth/password/change    - Changer mot de passe
POST   /auth/password/reset/request - Demander réinitialisation
POST   /auth/password/reset     - Réinitialiser mot de passe
POST   /auth/email/verify       - Vérifier email
```

### Documents
```
GET    /documents               - Liste des documents
POST   /documents               - Créer un document
GET    /documents/:id           - Obtenir un document
PATCH  /documents/:id           - Mettre à jour un document
DELETE /documents/:id           - Supprimer un document
GET    /documents/:id/download  - Télécharger un document
POST   /documents/upload        - Upload un document
POST   /documents/:id/share     - Partager un document
POST   /documents/:id/favorite  - Marquer comme favori
GET    /documents/recent        - Documents récents
GET    /documents/favorites     - Documents favoris
GET    /documents/trash         - Corbeille
POST   /documents/:id/restore   - Restaurer un document
```

### PDF Operations
```
POST   /pdf/merge               - Fusionner PDFs
POST   /pdf/split               - Diviser un PDF
POST   /pdf/compress            - Compresser un PDF
POST   /pdf/convert             - Convertir vers PDF
POST   /pdf/export              - Convertir depuis PDF
POST   /pdf/rotate              - Faire pivoter
POST   /pdf/extract-pages       - Extraire des pages
POST   /pdf/watermark           - Ajouter filigrane
POST   /pdf/protect             - Protéger par mot de passe
POST   /pdf/unlock              - Déverrouiller
POST   /pdf/ocr                 - OCR (reconnaissance texte)
POST   /pdf/sign                - Signer
POST   /pdf/form-fill           - Remplir formulaire
```

### Folders
```
GET    /folders                 - Liste des dossiers
POST   /folders                 - Créer un dossier
GET    /folders/:id             - Obtenir un dossier
PATCH  /folders/:id             - Mettre à jour un dossier
DELETE /folders/:id             - Supprimer un dossier
POST   /folders/move            - Déplacer documents
```

**Fichier de configuration:** `/home/rony/Projets/gigapdf/apps/mobile/src/constants/api.ts`

## Internationalisation

### Langues supportées
- **Français (fr)** - Traduction complète
- **Anglais (en)** - Traduction complète
- **Espagnol (es)** - Traduction de base
- **Allemand (de)** - Traduction de base

### Configuration

Fichier: `/home/rony/Projets/gigapdf/apps/mobile/src/i18n/i18n.config.ts`

### Utilisation

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t, i18n } = useTranslation();

  return (
    <View>
      <Text>{t('common.loading')}</Text>
      <Text>{t('auth.login')}</Text>
    </View>
  );
}
```

### Changer la langue

```typescript
import { changeLanguage } from '@i18n/i18n.config';

await changeLanguage('fr');
```

### Structure des traductions

```typescript
{
  common: { loading, error, success, cancel, confirm, ... },
  auth: { login, register, errors, success, ... },
  documents: { title, actions, errors, success, ... },
  tools: { title, merge, split, compress, ... },
  settings: { title, profile, preferences, ... },
  errors: { networkError, serverError, ... },
  validation: { required, email, minLength, ... }
}
```

## Performance

### Optimisations
- **React Query** pour cache et mise à jour optimiste
- **Reanimated** pour animations 60fps natives
- **Liste virtualisée** pour grandes listes
- **Image lazy loading** pour performances
- **Code splitting** avec Expo Router

### Métriques cibles
- App launch: < 2 secondes
- Frame rate: 60fps constant
- Memory: < 150MB baseline
- Battery: Impact minimal

## Sécurité

### Tokens
- Stockage: `expo-secure-store` (encrypted)
- Type: JWT Bearer
- Refresh: Automatique sur expiration

### Données sensibles
- Mots de passe: Jamais stockés localement
- Tokens: Chiffrés dans SecureStore
- Documents: Cache local chiffré

## Tests

### Structure
```
src/
  __tests__/
    services/
      api.test.ts
    stores/
      authStore.test.ts
    components/
      DocumentCard.test.tsx
```

### Commandes
```bash
npm test                 # Tous les tests
npm test -- --watch     # Mode watch
npm test -- --coverage  # Avec couverture
```

## Déploiement

### Development
```bash
npm start
npm run android
npm run ios
```

### Production
```bash
eas build --platform android
eas build --platform ios
eas submit --platform android
eas submit --platform ios
```

## Fichiers importants

| Fichier | Chemin | Description |
|---------|--------|-------------|
| Layout racine | `/home/rony/Projets/gigapdf/apps/mobile/app/_layout.tsx` | Provider et configuration app |
| Auth store | `/home/rony/Projets/gigapdf/apps/mobile/src/stores/authStore.ts` | État d'authentification |
| API client | `/home/rony/Projets/gigapdf/apps/mobile/src/services/api.ts` | Client HTTP configuré |
| API endpoints | `/home/rony/Projets/gigapdf/apps/mobile/src/constants/api.ts` | Tous les endpoints |
| i18n config | `/home/rony/Projets/gigapdf/apps/mobile/src/i18n/i18n.config.ts` | Configuration i18n |
| Types | `/home/rony/Projets/gigapdf/apps/mobile/src/types/` | Tous les types TS |
| README | `/home/rony/Projets/gigapdf/apps/mobile/README.md` | Documentation utilisateur |

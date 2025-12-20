# GigaPDF Mobile

Application mobile React Native pour GigaPDF - Gestion et manipulation de documents PDF.

## Architecture

### Structure des dossiers

```
/home/rony/Projets/gigapdf/apps/mobile/
├── app/                          # Routes Expo Router
│   ├── (auth)/                   # Groupe d'authentification
│   │   ├── _layout.tsx          # Layout des écrans d'authentification
│   │   ├── login.tsx            # Écran de connexion
│   │   ├── register.tsx         # Écran d'inscription
│   │   └── forgot-password.tsx  # Écran mot de passe oublié
│   │
│   ├── (tabs)/                   # Groupe avec navigation par onglets
│   │   ├── _layout.tsx          # Layout avec TabBar
│   │   ├── index.tsx            # Documents (onglet principal)
│   │   ├── tools.tsx            # Outils PDF
│   │   └── settings.tsx         # Paramètres
│   │
│   ├── document/                 # Routes de documents
│   │   └── [id].tsx             # Vue détaillée d'un document
│   │
│   ├── _layout.tsx              # Layout racine de l'application
│   └── index.tsx                # Point d'entrée (redirection)
│
├── src/
│   ├── components/              # Composants réutilisables
│   │   ├── buttons/
│   │   ├── cards/
│   │   ├── forms/
│   │   └── layout/
│   │
│   ├── constants/               # Constantes de l'application
│   │   ├── api.ts              # Configuration API et endpoints
│   │   └── colors.ts           # Palette de couleurs (light/dark)
│   │
│   ├── hooks/                   # Hooks personnalisés
│   │   ├── useDocuments.ts
│   │   ├── usePDF.ts
│   │   └── useTheme.ts
│   │
│   ├── i18n/                    # Internationalisation
│   │   ├── i18n.config.ts      # Configuration i18next
│   │   ├── locales/
│   │   │   ├── en.ts           # Anglais
│   │   │   ├── fr.ts           # Français
│   │   │   ├── es.ts           # Espagnol
│   │   │   └── de.ts           # Allemand
│   │   └── index.ts
│   │
│   ├── services/                # Services API
│   │   ├── api.ts              # Client Axios configuré
│   │   ├── auth.ts             # Service d'authentification
│   │   ├── documents.ts        # Service de gestion des documents
│   │   ├── pdf.ts              # Service d'opérations PDF
│   │   ├── types.ts            # Types pour les services
│   │   └── index.ts
│   │
│   ├── stores/                  # États Zustand
│   │   ├── authStore.ts        # État d'authentification
│   │   ├── documentStore.ts    # État des documents
│   │   ├── settingsStore.ts    # État des paramètres
│   │   └── index.ts
│   │
│   ├── types/                   # Types TypeScript
│   │   ├── api.ts              # Types API génériques
│   │   ├── user.ts             # Types utilisateur et auth
│   │   ├── document.ts         # Types documents et dossiers
│   │   ├── pdf.ts              # Types opérations PDF
│   │   └── index.ts
│   │
│   └── utils/                   # Utilitaires
│       ├── formatting.ts
│       ├── validation.ts
│       └── helpers.ts
│
├── assets/                      # Assets (images, fonts, etc.)
├── app.json                     # Configuration Expo
├── package.json                 # Dépendances
└── tsconfig.json               # Configuration TypeScript

```

## Technologies utilisées

### Core
- **React Native 0.81.5** - Framework mobile
- **Expo ~54.0** - Plateforme de développement
- **TypeScript 5.9** - Typage statique
- **Expo Router ~6.0** - Navigation basée sur les fichiers

### État et Données
- **Zustand 5.0** - Gestion d'état global
- **@tanstack/react-query 5.59** - Gestion du cache et requêtes
- **Axios 1.7** - Client HTTP

### UI/UX
- **React Native Gesture Handler 2.28** - Gestions des gestes
- **React Native Reanimated 4.1** - Animations performantes
- **React Native Screens 4.16** - Navigation native
- **React Native Safe Area Context 5.6** - Gestion des zones sûres

### Internationalisation
- **i18next 25.7** - Framework i18n
- **react-i18next 16.5** - Bindings React
- **expo-localization 17.0** - Détection de la langue

### Stockage
- **@react-native-async-storage/async-storage** - Stockage asynchrone
- **expo-secure-store** - Stockage sécurisé (tokens)

### PDF et Documents
- **react-native-pdf 7.0** - Visualisation PDF
- **expo-document-picker** - Sélection de documents
- **expo-file-system** - Système de fichiers
- **expo-image-picker** - Sélection d'images
- **expo-sharing** - Partage de fichiers

### Autres
- **react-native-toast-message** - Notifications toast

## Configuration

### Variables d'environnement

L'API est configurée sur `https://giga-pdf.com`

Configuration dans `/home/rony/Projets/gigapdf/apps/mobile/src/constants/api.ts`:

```typescript
export const API_CONFIG = {
  BASE_URL: 'https://giga-pdf.com',
  API_VERSION: 'v1',
  TIMEOUT: 30000,
};
```

### Endpoints API disponibles

Tous les endpoints sont documentés dans `/home/rony/Projets/gigapdf/apps/mobile/src/constants/api.ts`:

- **AUTH**: Login, Register, Logout, Refresh, Password Reset
- **USER**: Profile, Preferences, Change Password
- **DOCUMENTS**: CRUD, Upload, Download, Share, Favorites
- **PDF**: Merge, Split, Compress, Convert, Rotate, Watermark, Protect, OCR, Sign
- **FOLDERS**: CRUD, Move
- **SHARING**: Create, Manage, Accept
- **SUBSCRIPTION**: Plans, Usage, Subscribe

## Stores Zustand

### AuthStore (`/home/rony/Projets/gigapdf/apps/mobile/src/stores/authStore.ts`)

Gère l'état d'authentification:
- `user: User | null` - Utilisateur connecté
- `isAuthenticated: boolean` - État de connexion
- `login()` - Connexion utilisateur
- `register()` - Inscription
- `logout()` - Déconnexion
- `loadUser()` - Charger l'utilisateur depuis le token
- `updateUser()` - Mettre à jour le profil

### DocumentStore (`/home/rony/Projets/gigapdf/apps/mobile/src/stores/documentStore.ts`)

Gère l'état des documents:
- `documents: Document[]` - Liste des documents
- `currentDocument: Document | null` - Document actuel
- `folders: Folder[]` - Liste des dossiers
- `filter: DocumentFilter` - Filtres actifs
- `setDocuments()`, `addDocument()`, `updateDocument()`, `removeDocument()`
- `toggleFavorite()` - Basculer le statut favori

### SettingsStore (`/home/rony/Projets/gigapdf/apps/mobile/src/stores/settingsStore.ts`)

Gère les paramètres:
- `language: SupportedLanguage` - Langue de l'app
- `theme: ThemeMode` - Thème (light/dark/auto)
- `notificationsEnabled: boolean`
- `autoSave: boolean`
- `defaultQuality: DefaultQuality`
- Fonctions pour modifier et persister les paramètres

## Services API

### AuthService (`/home/rony/Projets/gigapdf/apps/mobile/src/services/auth.ts`)

Service complet d'authentification:
- Login/Register avec email et mot de passe
- Authentification sociale (Google, Apple, Facebook)
- 2FA (Two-Factor Authentication)
- Gestion des tokens (access + refresh)
- Réinitialisation de mot de passe
- Vérification d'email

### API Client (`/home/rony/Projets/gigapdf/apps/mobile/src/services/api.ts`)

Client Axios configuré avec:
- Intercepteurs pour ajouter automatiquement le token
- Gestion automatique du refresh token
- Gestion centralisée des erreurs
- Support upload/download avec progression
- Timeout configurables
- Logging en mode développement

## Internationalisation

Langues supportées: **Français (fr)**, **Anglais (en)**, Espagnol (es), Allemand (de)

### Configuration

Fichier: `/home/rony/Projets/gigapdf/apps/mobile/src/i18n/i18n.config.ts`

```typescript
import { changeLanguage, getCurrentLanguage } from '@i18n/i18n.config';

// Changer la langue
await changeLanguage('fr');

// Obtenir la langue actuelle
const lang = getCurrentLanguage();
```

### Utilisation dans les composants

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();

  return <Text>{t('common.loading')}</Text>;
}
```

### Traductions disponibles

Fichier complet: `/home/rony/Projets/gigapdf/apps/mobile/src/i18n/locales/fr.ts`

Sections:
- `common` - Textes communs
- `auth` - Authentification
- `documents` - Gestion de documents
- `tools` - Outils PDF
- `settings` - Paramètres
- `errors` - Messages d'erreur
- `validation` - Validation de formulaires

## Types TypeScript

### Document (`/home/rony/Projets/gigapdf/apps/mobile/src/types/document.ts`)

```typescript
interface Document {
  id: string;
  user_id: string;
  name: string;
  file_path: string;
  file_size: number;
  page_count?: number;
  is_favorite: boolean;
  is_trashed: boolean;
  tags?: string[];
  metadata?: DocumentMetadata;
  // ...
}
```

### PDF Operations (`/home/rony/Projets/gigapdf/apps/mobile/src/types/pdf.ts`)

Types pour toutes les opérations PDF:
- `MergePDFRequest`, `SplitPDFRequest`
- `CompressPDFRequest`, `ConvertToPDFRequest`
- `RotatePDFRequest`, `AddWatermarkRequest`
- `ProtectPDFRequest`, `SignPDFRequest`
- etc.

## Commandes

```bash
# Démarrer l'application
npm start

# Démarrer sur Android
npm run android

# Démarrer sur iOS
npm run ios

# Démarrer sur Web
npm run web

# Type checking
npm run type-check

# Linting
npm run lint
```

## Routes de l'application

### Routes publiques (non authentifiées)
- `/` - Redirection automatique
- `/(auth)/login` - Connexion
- `/(auth)/register` - Inscription
- `/(auth)/forgot-password` - Mot de passe oublié

### Routes privées (authentifiées)
- `/(tabs)/` - Documents (accueil)
- `/(tabs)/tools` - Outils PDF
- `/(tabs)/settings` - Paramètres
- `/document/[id]` - Vue détaillée d'un document

## Prochaines étapes

1. **Compléter les écrans d'authentification**
   - Finaliser register.tsx
   - Créer forgot-password.tsx

2. **Créer les écrans principaux**
   - Documents list (/(tabs)/index.tsx)
   - Outils PDF (/(tabs)/tools.tsx)
   - Paramètres (/(tabs)/settings.tsx)
   - Vue document (/document/[id].tsx)

3. **Créer les composants réutilisables**
   - Buttons (Primary, Secondary, Icon)
   - Cards (DocumentCard, ToolCard)
   - Forms (Input, Select, FileUpload)
   - Layout (Screen, Container, Header)

4. **Implémenter les hooks personnalisés**
   - useDocuments (avec React Query)
   - usePDF (opérations PDF)
   - useTheme (gestion du thème)

5. **Ajouter les fonctionnalités PDF**
   - Service documents.ts complet
   - Service pdf.ts complet
   - Intégration react-native-pdf

6. **Tests et optimisation**
   - Tests unitaires
   - Tests d'intégration
   - Optimisation des performances

## Notes importantes

- **Tokens**: Stockés de manière sécurisée avec `expo-secure-store`
- **Offline-first**: Utiliser React Query pour le cache
- **Performance**: 60fps minimum, utiliser Reanimated pour les animations
- **Accessibilité**: Support VoiceOver/TalkBack
- **Thème**: Support automatique light/dark mode
- **i18n**: Toutes les chaînes doivent être traduites

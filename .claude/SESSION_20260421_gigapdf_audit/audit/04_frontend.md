# Audit Frontend GigaPDF — SESSION_20260421

Date : 2026-04-21  
Scope : apps/web, apps/admin, packages/editor, packages/canvas, packages/ui, packages/pdf-engine

---

## 1. Stack Frontend

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework | Next.js | ^16.1.2 |
| UI Library | React | 19.2.3 (override monorepo) |
| Language | TypeScript | ^5.9.3 |
| Styling | Tailwind CSS | ^4.0.0 |
| State | Zustand | ^5.0.10 (+ immer ^11.1.3) |
| Primitives UI | Radix UI | multiple packages |
| Icons | lucide-react | ^0.562.0 |
| i18n | next-intl | ^4.7.0 |
| Auth | better-auth | ^1.4.13 |
| Canvas / Dessin | Fabric.js | ^7.1.0 |
| Rendu PDF | pdfjs-dist | ^5.4.530 (canvas), ^4.10.38 (pdf-engine) |
| Data fetching | fetch natif uniquement (pas de TanStack Query, pas de SWR) |
| Charts (admin) | recharts | ^3.6.0 |
| Tables (admin) | @tanstack/react-table | ^8.21.3 |
| ORM | Prisma | ^7.2.0 |
| Bundler | Turbopack (défaut Next.js 16) |
| Package Manager | pnpm ^10.28.0 |
| Monorepo | Turbo ^2.7.4 |

TypeScript config (`packages/typescript-config/base.json`) : `strict: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals: true`, `noUnusedParameters: true` — config solide.

---

## 2. Structure des Apps et Packages

### Monorepo Turbo
```
apps/
├── web/          Next.js 16 — éditeur PDF, dashboard utilisateur
├── admin/        Next.js 16 — backoffice admin
├── mobile/       React Native / Expo (hors scope audit actuel)
└── api/          Backend Python (FastAPI, hors scope)

packages/
├── editor/       Zustand stores + actions + selectors + middleware
├── canvas/       Fabric.js + pdfjs-dist — composant React FabricCanvas
├── pdf-engine/   Node.js — pdf-lib, playwright, sharp (côté serveur)
├── ui/           Design system — Radix UI + shadcn-like components
├── types/        Contrats TypeScript partagés
├── api/          Client HTTP + hooks Socket.io
└── ...
```

### App Web — Structure pages (App Router)
```
app/
├── layout.tsx                          # RootLayout — force-dynamic globale
├── (auth)/                             # Login, register, verify-email
├── (dashboard)/                        # Dashboard, documents, billing, settings
├── editor/[id]/                        # Éditeur PDF principal
├── embed/[[...params]]/               # Widget embeddable
└── api/pdf/*                          # Route Handlers Next.js (proxy vers FastAPI)
```

---

## 3. Éditeur PDF — Hiérarchie de Composants

```
EditorPage (app/editor/[id]/page.tsx)           ~1107 lignes — "use client"
├── EditorToolbar                               (editor-toolbar.tsx)
│   ├── MergeDialog, SplitDialog, EncryptDialog
│   ├── MetadataDialog, ConvertDialog
│   └── FontPicker (@giga-pdf/ui)
├── PagesSidebar                                (pages-sidebar.tsx)
├── DocumentInfoSidebar                         (document-info-sidebar.tsx)
│   ├── FormsPanel, LayersPanel, TOCPanel
│   ├── EmbeddedFilesPanel
│   └── PropertiesPanel
├── EditorCanvas                                (editor-canvas.tsx) ~1182 lignes — Fabric.js
├── ContentEditLayer                            (content-edit-layer.tsx) ~1545 lignes
│   └── Overlay HTML positionné sur le canvas pour édition native
├── CollaborationOverlay                        (collaboration-overlay.tsx)
└── FormsPanel                                  (forms-panel.tsx)
```

**Lib de rendu** : Fabric.js v7 pour l'édition interactive, pdfjs-dist v5 pour le rendu du fond PDF.  
Approche : canvas Fabric.js double-couche (fond PDF en image non-sélectionnable, éléments éditables par-dessus).

---

## 4. State Management

### Stores Zustand (packages/editor/src/stores/)

| Store | Responsabilité |
|-------|---------------|
| `useDocumentStore` | Métadonnées doc, pages, dirty, version, lastSaved |
| `useCanvasStore` | Zoom, pan, tool actif, viewport, grid, currentPageIndex |
| `useUIStore` | Sidebar, modals, notifications, contextMenu, theme |
| `useSelectionStore` | Sélection multi-éléments |
| `useHistoryStore` | Undo/redo (snapshots) |
| `useCollaborationStore` | Utilisateurs actifs, curseurs, état WebSocket |

Tous les stores utilisent `immer` middleware — immutabilité garantie par convention.

**Observation** : Les stores Zustand du package `@giga-pdf/editor` ne sont **pas utilisés** par `apps/web`. L'éditeur principal (`editor-canvas.tsx`, `editor/[id]/page.tsx`) gère son propre état local via `useState`/`useRef`. Le package `@giga-pdf/editor` semble être un artefact ou une refactorisation en cours non connectée au rendu réel.

### État local dans EditorPage (editor/[id]/page.tsx)
- 14 `useState` + 1 `useRef` pour le handle canvas
- `useDocument` hook (local) — document, pages, currentPageIndex
- `useDocumentSave` hook — saving, debounce 2s, auto-save 30s
- `useCollaboration` hook — WebSocket Socket.io

---

## 5. Data Fetching

**Aucune librairie de data fetching** (pas de TanStack Query, pas de SWR). Tout se fait via `fetch` natif dans :
- `useDocument` hook : appels directs `api.getDocument()`, `api.loadDocument()`
- `lib/api.ts` : client HTTP maison (token en mémoire, `authToken` variable module)

**Problème** : Le token auth est stocké dans une variable module `let authToken: string | null = null` dans `lib/api.ts`. Pas de retry, pas de cache, pas de deduplication de requêtes, pas de stale-while-revalidate.

### Pattern data fetching dans useDocument
```
loadDocument() → useEffect([storedDocumentId, sessionDocumentId]) → setState
```
Appels séquentiels dans `loadDocument` : d'abord `api.loadDocument()` puis `api.getDocument()` — waterfall potentiel.

---

## 6. Rendu PDF

### Architecture de rendu
1. **Fond PDF** : pdfjs-dist rend la page en `<canvas>` HTML temporaire → `toDataURL()` → `FabricImage` non-sélectionnable placée à l'index 0 du canvas Fabric.js.
2. **Éléments éditables** : Fabric.js objects (IText, Rect, Circle, etc.) placés par-dessus.
3. **Scale HiDPI** : `renderScale = Math.min(window.devicePixelRatio || 2, 3)` — bonne pratique.

### Problèmes performance de rendu
- **Re-rendu PDF à chaque changement de page** : La fonction `loadPage` effectue un `fetch` complet du PDF binaire à chaque changement de page (`/backend-api/api/v1/documents/${docId}/download`). Pour un document de 50 pages, cela représente N fetches identiques.
- **renderAll() excessif** : 10 appels à `canvas.renderAll()` dans editor-canvas.tsx, dont certains dans des handlers d'événements qui se déclenchent en rafale.
- **Import dynamique Fabric.js à chaque changement de page** : `import("fabric")` est appelé dans l'useEffect `[page, loadPage]` à chaque navigation de page. Bien que les imports soient mis en cache par le bundler, cela ajoute une microtâche inutile.

### Versioning pdfjs-dist incohérent
- `@giga-pdf/canvas` : pdfjs-dist **^5.4.530**
- `@giga-pdf/pdf-engine` : pdfjs-dist **^4.10.38**
Deux versions majeures différentes dans le monorepo.

### Worker PDF.js (CDN externe)
```typescript
// packages/canvas/src/renderers/pdf-renderer.ts:10
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
```
Le worker est chargé depuis cdnjs.cloudflare.com. En cas d'indisponibilité CDN ou de blocage CSP, le rendu PDF échoue entièrement. Le worker devrait être servi localement (via `/public` ou `next.config.js` copy).

---

## 7. Édition — Annotations, Texte, Formulaires, Signatures

### Texte
- Fabric.js `IText` (édition en double-clic) — bonne approche
- `originalContentRef` pour tracker les modifications de contenu vs position
- Police par défaut : Arial (hardcodée)

### Formes
- Rect, Circle, Ellipse, Triangle, Line — via switch dans `handleMouseDown`

### Annotations
- Highlight : Rect transparent jaune
- Underline/Strikethrough : Line Fabric
- Note : Rect jaune
- Comment : Circle bleu

### Formulaires
- `form_field` créé comme `Group` Fabric.js (Rect + FabricText placeholder)
- Rendu non-interactif — le champ de formulaire n'est pas un vrai input HTML
- Pas de validation de formulaire implémentée côté canvas

### Signatures
- Non trouvé dans le code analysé — absent ou dans un module non audité.

### ContentEditLayer
- Couche HTML overlay positionnée absolument sur le canvas Fabric
- Approche intéressante : permet l'édition native HTML sur les éléments PDF
- ~1545 lignes — composant massif dépassant largement la règle des 300 lignes

---

## 8. Gestion des Polices

### Approche actuelle
- **FontPicker UI** (`packages/ui/src/components/editor/font-picker.tsx`) : liste statique de 20 polices système (Arial, Helvetica, Times New Roman, etc.)
- **Aucune API FontFace** utilisée — pas de chargement dynamique de polices Web
- **Pas de Google Fonts** chargées à la demande
- Les polices listées (Didot, Futura, Optima, Century Gothic) sont des polices système Mac/Windows qui ne sont **pas universellement disponibles** sur Linux ou Android

### Impact
- Rendu incohérent entre les systèmes : une police Didot choisie sur Mac sera substituée sur Linux, causant des décalages de mise en page dans le PDF final.
- Pas de fallback font stack documenté ni validé.
- Pas de `document.fonts.load()` pour garantir que la police est chargée avant le rendu Fabric.js.

---

## 9. Bundle Size

### Imports lucide-react (barrel imports)
Tous les composants importent depuis le barrel `lucide-react` :
```typescript
import { MousePointer2, Type, Image, Square, PenTool, ... } from "lucide-react";
```
L'`editor-toolbar.tsx` importe **33 icônes** depuis le barrel. Lucide-react supporte les imports directs depuis `lucide-react/dist/esm/icons/xxx` mais cette optimisation n'est pas appliquée.

Avec Turbopack (Next.js 16), le tree-shaking est meilleur, mais les barrel imports restent sous-optimaux pour les builds non-Turbopack.

### Fabric.js (7.1.0)
Fabric.js est importé dynamiquement (`import("fabric")`) dans `editor-canvas.tsx` — bonne pratique pour éviter le SSR. Le bundle Fabric.js représente ~300-400 KB minifié.

### pdfjs-dist
Importé statiquement dans `packages/canvas/src/renderers/pdf-renderer.ts` :
```typescript
import * as pdfjsLib from "pdfjs-dist";
```
Import statique (pas dynamique). Pour un package utilisé uniquement côté client, cela alourdit le bundle initial.

### Pas de React.lazy / next/dynamic sur les panels éditeur
`PagesSidebar`, `DocumentInfoSidebar`, `FormsPanel`, `ContentEditLayer` etc. sont importés statiquement dans `editor/[id]/page.tsx`. Ces composants ne sont utilisés que dans l'éditeur et pourraient être lazy-loadés.

### forwardRef dans React 19
- `FabricCanvas` dans `packages/canvas/src/fabric-canvas.tsx` utilise `forwardRef` (déprécié en React 19 — `ref` est maintenant une prop normale)
- `FontPicker` dans `packages/ui/src/components/editor/font-picker.tsx` utilise `React.forwardRef`

### `any` proliférant dans packages/canvas
12 utilisations de `any` dans `fabric-canvas.tsx`, 9+ fichiers dans le package canvas contiennent `any`. La plupart concernent le typage des objets Fabric.js (acceptable dans une certaine mesure mais à encadrer avec des types guards plutôt que `as any`).

---

## 10. Core Web Vitals — Problèmes Potentiels

### LCP (Largest Contentful Paint)
- **force-dynamic global** : `export const dynamic = "force-dynamic"` dans `app/layout.tsx` — **toute l'application est rendue en SSR dynamique**, empêchant tout bénéfice du cache statique Next.js. LCP sera systématiquement plus lent.
- Le canvas Fabric.js (LCP probable dans l'éditeur) n'est visible qu'après : chargement Fabric.js (dynamique) + fetch PDF binaire + rendu pdfjs + `FabricImage.fromURL()`.

### CLS (Cumulative Layout Shift)
- Le canvas est dimensionné via `canvasWidth * zoom` et `canvasHeight * zoom` (inline styles). Les dimensions ne sont disponibles qu'après le chargement du document, causant un layout shift.
- Le `ContentEditLayer` est positionné en `absolute` sur le canvas — sa hauteur dynamique peut générer un CLS si la page parente n'a pas de dimensions réservées.

### INP (Interaction to Next Paint)
- Les handlers Fabric.js `mouse:down` créent des objets (`new IText`, `new Rect`, etc.) dans le thread principal — peut impacter l'INP sur les actions rapides.
- `saveHistory()` appelle `JSON.stringify(canvas.toObject(["data"]))` sur chaque modification — sérialisation synchrone du canvas potentiellement lente sur des documents complexes.

---

## 11. Hooks Custom

| Hook | Localisation | Responsabilité |
|------|-------------|----------------|
| `useDocument` | `apps/web/src/hooks/use-document.ts` | Chargement doc, pagination, CRUD pages local |
| `useDocumentSave` | `apps/web/src/hooks/use-document-save.ts` | Auto-save debounce + priorité |
| `useCollaboration` | `apps/web/src/hooks/use-collaboration.ts` | WebSocket Socket.io, curseurs, événements |
| `useCanvas` | `packages/canvas/src/hooks/use-canvas.ts` | Init Fabric.js canvas |
| `useCanvasEvents` | `packages/canvas/src/hooks/use-canvas-events.ts` | Listeners Fabric.js |
| `useSelection` | `packages/canvas/src/hooks/use-selection.ts` | Sélection multi-objets |
| `useZoom` | `packages/canvas/src/hooks/use-zoom.ts` | Zoom canvas |

### Observations
- `useDocument` gère 10+ préoccupations distinctes (loading, pages CRUD, navigation, dirty state, outlines, layers, embeddedFiles) — devrait être découpé.
- Le hook `useCollaboration` utilise correctement `useCallback` pour stabiliser les callbacks passés aux hooks de bas niveau. Bien.
- `packages/editor/src/stores/` définit des hooks Zustand complets mais **non utilisés** dans `apps/web` — dette technique ou refactorisation inachevée.

---

## 12. Accessibilité

### Points positifs
- `ContentEditLayer` a des `aria-label` sur les boutons d'édition/suppression par type d'élément
- `SplitDialog` a `aria-modal`, `aria-labelledby`, `aria-label` sur les boutons
- `tabIndex={0}` présent sur les éléments interactifs custom

### Points manquants
- **Canvas Fabric.js** : le `<canvas>` n'a pas de `role`, `aria-label`, ni description pour les lecteurs d'écran. L'édition PDF est entièrement inaccessible aux utilisateurs de technologies assistives.
- **EditorToolbar** : les groupes de boutons outils (Shape, Annotation) ne sont pas wrappés dans un `role="toolbar"` avec `aria-label`.
- **Navigation clavier dans le canvas** : pas de support `onKeyDown` sur le canvas pour déplacer/redimensionner les éléments sélectionnés au clavier (Delete, Arrow keys).
- **Dialogs** : MergeDialog, MetadataDialog, ConvertDialog utilisent un `div` custom au lieu de Radix Dialog — pas de focus trap automatique.
- **FontPicker** : combobox Radix, accessible. Bien.
- **Contraste** : non audité dans ce rapport (nécessite un outil de rendu visuel).

---

## 13. Findings

### CRITIQUE

**C1 — Worker PDF.js chargé depuis CDN externe**  
`packages/canvas/src/renderers/pdf-renderer.ts:10`  
```typescript
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
```
Dépendance d'un CDN tiers pour le rendu PDF. En production avec une CSP stricte ou en cas d'indisponibilité CDN, tout rendu PDF échoue silencieusement. Corriger : servir le worker en local via `/public/pdf.worker.min.js` ou `next.config.js`.

**C2 — Token auth en variable module globale (memory leak + sécurité)**  
`apps/web/src/lib/api.ts:14`  
```typescript
let authToken: string | null = null;
```
Token stocké en mémoire JavaScript globale. En cas de rendu concurrent (Next.js), ce token pourrait fuir entre les requêtes. Remplacer par `cookies()` / `headers()` côté serveur ou par `useAuthStore` Zustand côté client.

**C3 — Fetch PDF binaire complet à chaque changement de page**  
`apps/web/src/components/editor/editor-canvas.tsx:987-1020`  
```typescript
const response = await fetch(`/backend-api/api/v1/documents/${docId}/download`, { credentials: "include" });
```
Ce fetch est re-déclenché à chaque `loadPage()` (changement de page). Pour un document de 50 pages, cela représente 50 fetches du même fichier PDF. Le `ArrayBuffer` devrait être mis en cache après le premier chargement.

---

### HAUT

**H1 — force-dynamic global désactive tout cache Next.js**  
`apps/web/src/app/layout.tsx:9`  
```typescript
export const dynamic = "force-dynamic";
```
Force le rendu SSR dynamique pour toutes les pages. Impacte le LCP et empêche tout ISR/SSG. À remplacer par une configuration granulaire par page.

**H2 — Composants God (> 300 lignes)**  
- `EditorCanvas` : 1182 lignes — logique Fabric.js, undo/redo, gestion outils, rendu page, exposition API ref
- `editor/[id]/page.tsx` : 1107 lignes — orchestrateur avec 14+ useState
- `ContentEditLayer` : 1545 lignes — overlay HTML pour tous les types d'éléments

Chacun de ces fichiers devrait être découpé en composants/hooks spécialisés.

**H3 — Deux versions de pdfjs-dist dans le monorepo**  
`@giga-pdf/canvas` : v5.4.530 | `@giga-pdf/pdf-engine` : v4.10.38  
Risque de double bundling, comportements divergents entre packages. Unifier sur la v5 (dernière stable).

**H4 — Stores Zustand du package @giga-pdf/editor non connectés à l'UI**  
`packages/editor/src/stores/` — 6 stores complets jamais importés dans `apps/web`.  
L'éditeur gère son état en `useState` local dans la page. Dette architecturale majeure : soit adopter les stores Zustand, soit supprimer le package pour éviter la confusion.

**H5 — Aucune lib de data fetching (pas de cache, pas de deduplication)**  
Tous les fetches se font via `fetch` natif sans cache. Chaque navigation dans l'éditeur re-fetche le document depuis zéro. TanStack Query ou SWR éliminerait ce problème avec un effort minimal.

**H6 — saveHistory sérialise le canvas complet à chaque modification**  
`apps/web/src/components/editor/editor-canvas.tsx:183`  
```typescript
const json = JSON.stringify(canvas.toObject(["data"]));
```
Sérialisation synchrone complète du canvas à chaque `object:modified`. Sur un document complexe, cela bloque le thread principal. Implémenter un undo/redo par patches différentiels.

---

### MOYEN

**M1 — forwardRef déprécié utilisé dans React 19**  
`packages/canvas/src/fabric-canvas.tsx:5,58`  
`packages/ui/src/components/editor/font-picker.tsx:54`  
Utiliser `ref` comme prop directe (React 19).

**M2 — Barrel imports lucide-react dans l'éditeur**  
`apps/web/src/components/editor/editor-toolbar.tsx:8-44`  
33 icônes importées depuis le barrel. Préférer les imports directs.

**M3 — pdfjs-dist importé statiquement dans le package canvas**  
`packages/canvas/src/renderers/pdf-renderer.ts:5`  
Import statique de `pdfjs-dist` (~600 KB) sans dynamic import. Ajouter `import()` dynamique.

**M4 — 18 console.log dans editor-canvas.tsx en production**  
`apps/web/src/components/editor/editor-canvas.tsx` — 18 occurrences  
Les logs de debug `[EditorCanvas]` sont présents dans le code de production. Remplacer par un logger conditionnel ou les supprimer.

**M5 — Polices système non universelles dans FontPicker**  
`packages/ui/src/components/editor/font-picker.tsx:17-38`  
Polices comme Didot, Futura, Optima non disponibles sur Linux/Android. Rendu incohérent cross-platform. Remplacer par des polices Web (Google Fonts ou self-hosted) avec FontFace API.

**M6 — ImportDynamique Fabric.js re-appelé à chaque changement de page**  
`apps/web/src/components/editor/editor-canvas.tsx:1043`  
```typescript
import("fabric").then((fabricModule) => { loadPage(page, fabricModule); });
```
Le module est déjà en cache après le premier import, mais l'appel `import()` est redondant. Stocker le module dans un ref après le premier chargement.

**M7 — Canvas Fabric.js inaccessible aux lecteurs d'écran**  
`apps/web/src/components/editor/editor-canvas.tsx:1177`  
Le `<canvas>` n'a pas de `role="img"` ni `aria-label`. Tout contenu PDF est invisible aux technologies assistives.

---

### BAS

**B1 — useDocument gère 10+ responsabilités**  
`apps/web/src/hooks/use-document.ts`  
Découper en `useDocumentLoader`, `usePageNavigation`, `usePageCRUD`.

**B2 — generateId() utilise Math.random().toString(36).substr(2, 9)**  
`apps/web/src/components/editor/editor-canvas.tsx:90`  
`Math.random()` n'est pas cryptographiquement sûr pour les IDs d'éléments. Utiliser `crypto.randomUUID()`.

**B3 — duplicatePage() utilise JSON.parse(JSON.stringify())**  
`apps/web/src/hooks/use-document.ts:333`  
Antipattern connu. Utiliser `structuredClone()` (disponible Node.js 17+, navigateurs modernes).

**B4 — Pas de skeleton/placeholder lors du chargement de l'éditeur**  
Pendant le chargement du document et l'init du canvas, l'utilisateur voit probablement une page blanche. Un skeleton CLS-neutre améliorerait la perceived performance.

**B5 — reactCompiler non configuré explicitement**  
Next.js 16 active le React Compiler par défaut. Le projet contient encore de nombreux `useMemo`/`useCallback` manuels (68 occurrences dans les composants editor) qui seront redondants avec le compilateur. Nettoyage progressif conseillé.

---

## Résumé des Priorités

| Priorité | Count | Exemples |
|----------|-------|---------|
| Critique | 3 | Worker CDN, token global, fetch PDF N fois |
| Haut | 6 | force-dynamic, God components, stores inutilisés |
| Moyen | 7 | forwardRef, console.log prod, barrel imports |
| Bas | 5 | generateId, structuredClone, skeleton |

Le chantier le plus impactant à court terme est **C3 + H5** : cacher le PDF binaire après le premier fetch et adopter TanStack Query. Ces deux changements élimineraient les waterfalls réseau les plus coûteux de l'éditeur.

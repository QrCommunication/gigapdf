# 12 — React Editor Architecture Review

> Read-only analysis. No source files modified.
> Stack: React 19.2.3 + Next.js ^16.1.2 + Zustand (editor store) + Fabric.js
> Files reviewed: editor-canvas.tsx (1281 LOC), page.tsx (1183 LOC), use-document.ts (432 LOC), use-document-save.ts (515 LOC), lib/api.ts (1595 LOC), next.config.ts, middleware.ts

---

## Top 15 fix cards

---

### P1-001 — lib/api.ts God file (1595 LOC)

**Problème** : `apps/web/src/lib/api.ts` est un fichier monolithique de 1595 lignes couvrant au moins 8 domaines métier distincts (storage/documents, session documents, elements, quota, plans, folders, organizations, billing + auth helpers). Un seul changement dans la couche billing force le re-test de tout le client API. L'import de `getAuthToken` depuis ce fichier dans 4 consommateurs distincts (editor-canvas, use-document, use-document-save, page.tsx) crée un couplage fort entre la présentation et la gestion de l'authentification.

**Fix** : Découper en modules par domaine + extraire le helper auth :

```
lib/api/
├── client.ts          # class APIClient + request() privé
├── auth.ts            # getAuthToken / setAuthToken (AUTH_TOKEN_KEY)
├── storage.ts         # listDocuments, saveDocument, loadDocument, versions, folders
├── documents.ts       # uploadDocument, getDocument, createElement, updateElement...
├── billing.ts         # subscription, plans, checkout, invoices
├── organization.ts    # tenants, members, invitations
├── quota.ts           # getQuota, getPlans, getEffectiveLimits
└── index.ts           # re-export sélectif (pas de barrel complet)
```

Chaque module crée son propre sous-scope de `APIClient` ou importe l'instance singleton. Les consommateurs importent uniquement le module dont ils ont besoin :

```typescript
// Avant
import { api, getAuthToken, type ElementCreateRequest } from "@/lib/api";

// Après
import { api } from "@/lib/api/documents";
import { getAuthToken } from "@/lib/api/auth";
import type { ElementCreateRequest } from "@/lib/api/documents";
```

**Effort** : M (medium — splitting mécanique, peu de logique à déplacer)
**Priorité** : P1

---

### P1-002 — editor-canvas.tsx God Component (1281 LOC, 11 responsabilités)

**Problème** : `EditorCanvas` cumule les responsabilités suivantes dans un seul composant :
1. Initialisation Fabric.js canvas
2. Gestion de l'historique undo/redo (historyStack, historyIndex)
3. Rendu du fond PDF (loadPage → PDFRenderer)
4. Rendu des éléments overlay (renderElementsOverlay — 288 lignes)
5. Création d'objets Fabric (mouse:down — 160 lignes de switch)
6. Conversion Fabric → Element (fabricObjectToElement — 130 lignes)
7. Gestion des événements texte (text:editing:entered/changed/exited)
8. Gestion du zoom via mouse:wheel
9. Gestion des liens hypertexte (mouse:dblclick)
10. Exposer l'handle impératif (onCanvasReady)
11. Synchronisation des 13 refs de closures stale

**Fix** : Découpage en couches séparées :

```
components/editor/canvas/
├── EditorCanvas.tsx           # Composant conteneur — mount/unmount Fabric, layout
├── useFabricCanvas.ts         # Hook : init/dispose, refs, event binding lifecycle
├── useCanvasHistory.ts        # Hook : historyStack, historyIndex, saveHistory, undo, redo
├── usePdfBackground.ts        # Hook : fetch PDF binary → PDFRenderer → dataUrl
├── renderElementsOverlay.ts   # Fonction pure : Element[] → FabricObject[]
├── createFabricObject.ts      # Fonction pure : tool + pointer → FabricObject
├── fabricToElement.ts         # Fonction pure : FabricObjectWithData → Element
└── types.ts                   # FabricObjectWithData, EditorCanvasHandle, etc.
```

**Effort** : L (large — couplage Fabric fort, refs croisées)
**Priorité** : P1

---

### P1-003 — page.tsx God Page (1183 LOC, violation SRP sévère)

**Problème** : `apps/web/src/app/editor/[id]/page.tsx` concentre dans un seul composant : orchestration des stores, gestion du PDF binary, édition du nom inline, gestion des raccourcis clavier, collaboration WebSocket, export, opérations de pages (rotate, extract, flatten), content-edit mode et le rendu JSX complet de l'éditeur. Le fichier a un score de dette cumulée #1 du projet (29 points) avec 15 console.log et 7 `as unknown as`.

**Fix** : Extraction en hooks spécialisés et sous-composants :

```
app/editor/[id]/
├── page.tsx                   # 150 LOC max — orchestration pure, rendu JSX minimal
├── hooks/
│   ├── useEditorKeyboard.ts   # Raccourcis clavier (useEffect + window.addEventListener)
│   ├── useEditorCollaboration.ts  # Wrapper mince autour de useCollaboration
│   ├── useEditorExport.ts     # handleExport, handleFlattenPdf
│   └── useEditorName.ts       # isEditingName, editedName, handleConfirmRename
├── components/
│   ├── EditorHeader.tsx        # Header avec nom + save status + collaborators
│   └── EditorLayout.tsx        # Layout flex avec toolbar/sidebar/canvas
```

Le `convertToApiElement` (helper pur de 50 lignes) doit être extrait dans `lib/editor/element-converter.ts`.

**Effort** : M (medium — logique déjà bien délimitée, extraction mécanique)
**Priorité** : P1

---

### P1-004 — getAuthToken() exposé et appelé directement dans les composants

**Problème** : `getAuthToken()` (qui lit `sessionStorage`) est importé et appelé directement dans 4 fichiers : editor-canvas.tsx, use-document.ts, use-document-save.ts et page.tsx. Ce pattern viole la Dependency Inversion : les composants et hooks de présentation dépendent directement d'un détail d'implémentation de l'auth (sessionStorage). Cela rend les tests unitaires difficiles (sessionStorage non disponible dans jsdom sans mock) et couplés à l'implémentation.

La sécurité est aussi en cause : `getAuthToken` expose la lecture de sessionStorage dans la couche de présentation, alors qu'il devrait être encapsulé dans le client HTTP.

**Fix** : Le token doit être injecté uniquement par `APIClient.request()` (c'est déjà le cas). Les appels `fetch()` directs hors du client (dans use-document, use-document-save, loadPage dans editor-canvas) doivent être migrés vers des méthodes du client API ou vers un hook `useAuthenticatedFetch` :

```typescript
// lib/api/auth.ts
export function useAuthenticatedFetch() {
  return useCallback(async (url: string, init?: RequestInit) => {
    const token = getAuthToken();
    return fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        ...init?.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }, []);
}
```

Supprimer toutes les importations directes de `getAuthToken` hors de `lib/api/`.

**Effort** : S (small)
**Priorité** : P1

---

### P1-005 — 43 console.log en production dans les composants éditeur

**Problème** : 19 `console.log/warn` dans editor-canvas.tsx + 24 dans page.tsx (soit 43 au total dans le seul éditeur) sont actifs en production. Ces logs exposent le workflow interne (IDs d'éléments, contenu texte avant/après édition, état du canvas) dans la console navigateur de tout utilisateur. Certains logs incluent directement le contenu des éléments : `console.log("[EditorCanvas] Text editing started, saved original content:", elementId, "\"${currentText}\""`. Les règles de sécurité du projet interdisent explicitement les logs prod avec données sensibles.

**Fix** : Remplacer par le logger structuré `useLogger` (déjà utilisé dans use-document-save.ts) :

```typescript
// Avant
console.log("[EditorCanvas] Object modified:", element.elementId, element.type);

// Après
const logger = useLogger({ component: 'EditorCanvas' });
logger.debug('Object modified', { elementId: element.elementId, type: element.type });
```

Les logs de debug Fabric (mouse:down, text:changed en temps réel) doivent être supprimés entièrement — ce ne sont pas des événements à logger même en debug.

**Effort** : S (small — mécanique)
**Priorité** : P1

---

### P1-006 — 7 occurrences de `as unknown as` dans page.tsx

**Problème** : `apps/web/src/app/editor/[id]/page.tsx` contient 7 casts `as unknown as Record<string, unknown>` (lignes 82–101) dans la fonction `convertToApiElement`, tous sur des champs `style`. Ces casts masquent une incompatibilité de types entre le type `Element.style` (discriminated union selon `element.type`) et le type `Record<string, unknown>` attendu par `ElementCreateRequest`. Ce n'est pas un problème de typage TypeScript difficile — c'est un contrat API non typé qui absorbe la complexité.

**Fix** : Typer correctement `ElementCreateRequest` avec une union discriminée :

```typescript
// Avant
export interface ElementCreateRequest {
  style?: Record<string, unknown>; // trop large
}

// Après
export type ElementCreateRequest =
  | { type: 'text'; style: TextElementStyle; content: string }
  | { type: 'shape'; style: ShapeElementStyle; shape_type: ShapeType }
  | { type: 'annotation'; style: AnnotationElementStyle; annotation_type: AnnotationType }
  // ...
```

**Effort** : M (medium — nécessite de revoir le contrat API complet)
**Priorité** : P1

---

### P2-007 — middleware.ts au lieu de proxy.ts (Next.js 16 non-compliant)

**Problème** : `apps/web/middleware.ts` existe et est utilisé pour la gestion d'authentification. Next.js 16 a renommé `middleware.ts` en `proxy.ts` pour clarifier que ce fichier est exclusivement dédié au proxy/routing réseau (Edge Runtime). La logique d'authentification (vérification de cookie, redirect) actuellement dans `middleware.ts` est correcte sur le fond mais dans le mauvais fichier selon les conventions Next.js 16.

De plus, la logique de vérification du cookie de session (`getSessionToken`) tente 4 noms de cookies différents en boucle — cette heuristique fragile devrait être centralisée.

**Fix** : Renommer `middleware.ts` en `proxy.ts`. Vérifier que next.config.ts n'a pas de configuration spécifique qui pointe vers `middleware.ts`. La logique de redirection auth reste valide.

**Effort** : T (trivial — rename + vérification)
**Priorité** : P2

---

### P2-008 — React Compiler non configuré (68 useMemo/useCallback manuels)

**Problème** : Next.js 16 avec React 19.2 active le React Compiler par défaut. Or `next.config.ts` ne contient aucune directive `reactCompiler` (ni activation ni désactivation explicite). Les 68 occurrences de `useMemo`/`useCallback`/`React.memo` dans `components/editor/` sont probablement redondantes si le compilateur est actif, ou au contraire le compilateur est désactivé implicitement par la config Sentry qui wrap le config.

Certaines utilisations de `useCallback` dans editor-canvas.tsx et page.tsx avec des dépendances incomplètes ou des refs-comme-dépendances créent des patterns que le compilateur ne peut pas optimiser (mutations de refs dans le render body).

**Fix** : 
1. Vérifier si le React Compiler est actif avec `NEXT_COMPILER_DEBUG=1 pnpm build`
2. Si actif : supprimer les `useMemo`/`useCallback` redondants et valider que les mutations de refs dans le render body sont isolées (ne pas muter dans le render, seulement dans les handlers)
3. Si inactif : activer explicitement dans next.config.ts :

```typescript
const nextConfig: NextConfig = {
  reactCompiler: true,
  // ...
};
```

**Effort** : M (medium — audit des mutations dans render requis avant activation)
**Priorité** : P2

---

### P2-009 — Fabric.js : memory leak potentiel sur page change et unmount

**Problème** : Dans `editor-canvas.tsx`, le useEffect d'initialisation Fabric (ligne ~490) dispose correctement le canvas à l'unmount (`fabricRef.current.dispose()`). Cependant :

1. `loadPage` lance un `fetch()` pour télécharger le PDF + instancie un `PDFRenderer` avec `await renderer.loadDocument(arrayBuffer)`. Si le composant est démonté pendant ce fetch async, le `cancelled` flag n'existe pas — `renderer.dispose()` est appelé dans le happy path seulement. En cas d'unmount pendant le chargement, `PDFRenderer` reste en mémoire.

2. `renderElementsOverlay` est une fonction `async` qui n'est pas un `useCallback` (définie directement dans le corps du composant) et lance des `FabricImage.fromURL()` promises sans gestion d'annulation. Si la page change pendant un chargement d'images en cours, les images se chargent sur le canvas de la page précédente puis appellent `canvas.add()` et `canvas.renderAll()` sur une référence potentiellement obsolète.

**Fix** :

```typescript
// Dans loadPage — ajouter AbortController
const loadPage = useCallback(async (pageData: PageObject, fabricModule: ...) => {
  const abortController = new AbortController();
  // Stocker dans une ref pour l'annuler si page change
  loadAbortControllerRef.current?.abort();
  loadAbortControllerRef.current = abortController;
  
  try {
    const response = await fetch(pdfUrl, {
      signal: abortController.signal,
      // ...
    });
    // ...
    renderer.dispose(); // dans finally
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    console.warn(e);
  } finally {
    renderer.dispose();
  }
}, []);
```

**Effort** : S (small)
**Priorité** : P2

---

### P2-010 — useDocument : fetch manuel + cast Record<string, unknown> au lieu de TanStack Query

**Problème** : `apps/web/src/hooks/use-document.ts` implémente manuellement le pattern fetch + useState + useEffect (loading, error, data) avec 10 hooks React pour gérer l'état serveur. Ce pattern est explicitement listé comme anti-pattern dans les règles frontend React du projet ("TanStack Query ou SWR pour la deduplication automatique"). Le résultat est :
- Pas de deduplication si deux composants montent `useDocument` avec le même ID
- Pas de cache (chaque montage refetch)
- Les casts `as Record<string, unknown>` (lignes 129–146) compensent l'absence de typage du payload retourné par `/api/pdf/parse-from-s3`

**Fix** : Migrer vers TanStack Query (déjà dans `optimizePackageImports` du next.config.ts, donc déjà dans le bundle) :

```typescript
export function useDocument({ storedDocumentId }: UseDocumentOptions) {
  const loadQuery = useQuery({
    queryKey: ['document', 'load', storedDocumentId],
    queryFn: () => api.loadDocument(storedDocumentId!),
    enabled: !!storedDocumentId,
    staleTime: Infinity, // session document = pas de refetch automatique
  });

  const parseQuery = useQuery({
    queryKey: ['document', 'parse', loadQuery.data?.document_id],
    queryFn: () => api.parseDocumentFromStorage(loadQuery.data!.document_id),
    enabled: !!loadQuery.data?.document_id,
    staleTime: Infinity,
  });
  // ...
}
```

`api.parseDocumentFromStorage()` existe déjà dans `lib/api.ts` (ligne 257) mais n'est pas utilisé par `useDocument` — le hook fait directement `fetch("/api/pdf/parse-from-s3", ...)` en contournant le client API.

**Effort** : M (medium)
**Priorité** : P2

---

### P2-011 — Historique undo/redo dans editor-canvas : anti-pattern React

**Problème** : L'historique undo/redo est implémenté avec `useState<string[]>` (historyStack) et `useState<number>` (historyIndex) dans `EditorCanvas`. À chaque modification, `setHistoryStack` est appelé avec `prev.slice(0, historyIndexRef.current + 1)` et `setHistoryIndex(prev => prev + 1)`. Ce pattern :
1. Stocke des snapshots JSON complets du canvas Fabric dans le state React → `JSON.stringify(canvas.toObject(["data"]))` peut produire plusieurs Mo pour un canvas chargé. Ces données en state React sont sérialisées par React DevTools et passent par le réconciliateur à chaque render.
2. Duplique l'état : `historyIndex` est dans le state React ET dans `historyIndexRef` (pour éviter les stale closures de `saveHistory`).
3. L'`useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex])` est une synchronisation state → ref qui est le symptôme d'un état qui devrait être entièrement en ref.

**Fix** : L'historique Fabric est un état impératif non-visuel. Il doit être entièrement en ref :

```typescript
const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });

const saveHistory = useCallback((canvas: FabricCanvas) => {
  const json = JSON.stringify(canvas.toObject(["data"]));
  const { stack, index } = historyRef.current;
  historyRef.current = {
    stack: [...stack.slice(0, index + 1), json],
    index: index + 1,
  };
  // Forcer un re-render uniquement pour mettre à jour canUndo/canRedo
  setHistoryVersion(v => v + 1); // state counter minimal
}, []);
```

`canUndo` et `canRedo` deviennent des getters qui lisent `historyRef.current` au moment de l'appel — ce qui est déjà l'intention de l'`EditorCanvasHandle`.

**Effort** : S (small)
**Priorité** : P2

---

### P2-012 — renderElementsOverlay : fonction async définie dans le corps du composant

**Problème** : `renderElementsOverlay` (ligne 775) est une fonction `async` définie directement dans le corps de `EditorCanvas` — ni `useCallback`, ni extraction hors du composant. Elle est appelée depuis `loadPage` (elle-même un `useCallback`). Cette définition dans le corps du composant crée une nouvelle référence à chaque render. Comme `loadPage` la capture dans sa closure initiale (sa deps list est `[]`), la version de `renderElementsOverlay` utilisée sera toujours celle du premier render — ce qui est accidentellement correct aujourd'hui car `renderElementsOverlay` ne dépend que de `fabricModule` passé en argument, mais rend le code fragile.

**Fix** : Extraire `renderElementsOverlay` comme fonction pure (pas de hook) hors du composant ou dans un fichier séparé `renderElementsOverlay.ts`. Elle ne dépend d'aucun state ou prop React — uniquement du canvas Fabric, des éléments et du module Fabric :

```typescript
// renderElementsOverlay.ts
export async function renderElementsOverlay(
  canvas: FabricCanvas,
  elements: Element[],
  fabricModule: typeof import("fabric")
): Promise<void> {
  // ... logique actuelle ...
}
```

**Effort** : T (trivial — copier-coller + ajout import)
**Priorité** : P2

---

### P2-013 — Serveur Components sous-exploités : page.tsx entièrement "use client"

**Problème** : `apps/web/src/app/editor/[id]/page.tsx` est marqué `"use client"` en tête de fichier, ce qui est justifié pour l'éditeur interactif. Cependant, la récupération du `storedDocumentId` depuis l'URL et la vérification d'accès au document pourraient être faites côté serveur pour :
1. Vérifier que le document existe et appartient à l'utilisateur avant d'envoyer le HTML de l'éditeur (éviter un flash d'éditeur vide)
2. Précharger les métadonnées du document (nom, page count) dans le payload initial sans round-trip client

**Fix** : Ajouter un Server Component wrapper :

```typescript
// app/editor/[id]/page.tsx (Server Component)
import { EditorClient } from './editor-client';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function EditorPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  
  // Métadonnées légères (nom, page count) pour le SSR initial
  const meta = await api.getDocumentMeta(params.id).catch(() => null);
  if (!meta) redirect('/documents');
  
  return <EditorClient storedDocumentId={params.id} initialMeta={meta} />;
}
```

**Effort** : M (medium — nécessite de séparer le composant serveur du client)
**Priorité** : P2 (amélioration d'expérience, pas critique)

---

### P2-014 — Collaboration WebSocket : 3 TODO non implémentés + logs en production

**Problème** : Dans page.tsx (lignes 329–341), les callbacks de collaboration `onElementCreate`, `onElementUpdate` et `onElementDelete` contiennent uniquement des `console.log` et des commentaires `// TODO: Ajouter l'élément au canvas`. La collaboration est donc non fonctionnelle : les événements WebSocket distants sont reçus mais ignorés silencieusement côté canvas. L'indicateur de connexion WebSocket (Wifi/WifiOff) donne à l'utilisateur une fausse impression de collaboration active.

**Fix** : Soit implémenter réellement les callbacks (application des éléments distants sur le canvas Fabric via l'handle impératif), soit masquer l'indicateur de collaboration jusqu'à ce que la feature soit complète. Les TODO en production avec console.log sont explicitement interdits par les règles du projet.

**Effort** : L (large — implémenter la sync canvas bidirectionnelle)
**Priorité** : P2

---

### P3-015 — Hooks critiques sans tests : use-document.ts, editor stores

**Problème** : D'après le rapport 04_test_gaps.md, `packages/editor/src/stores/document-store.ts` (store Zustand principal) a 0 test. `apps/web/src/hooks/use-document.ts` n'a pas de test (seul `use-document-save.ts` est testé). Or `useDocument` contient une logique de mapping API → `DocumentObject` avec 15+ champs dérivés manuellement via des casts `as unknown` — ce code est exactement le type de logique qui cache des bugs silencieux (cf. bug `LegacyDocumentProxy` côté Python qui était un problème de mapping similaire).

**Fix** : Créer `apps/web/src/hooks/__tests__/use-document.test.ts` :

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { useDocument } from '../use-document';
import { server } from '@/test/msw-server'; // Mock Service Worker
import { http, HttpResponse } from 'msw';

describe('useDocument', () => {
  it('maps API response to DocumentObject correctly', async () => {
    server.use(
      http.post('/api/v1/storage/documents/:id/load', () =>
        HttpResponse.json({ success: true, data: { document_id: 'sess-1', name: 'Test.pdf' } })
      ),
      http.post('/api/pdf/parse-from-s3', () =>
        HttpResponse.json({ data: MINIMAL_DOCUMENT_FIXTURE })
      )
    );
    
    const { result } = renderHook(() => useDocument({ storedDocumentId: 'stored-1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    
    expect(result.current.pages).toHaveLength(2);
    expect(result.current.name).toBe('Test.pdf');
  });
  
  it('sets error when load fails', async () => { /* ... */ });
  it('goToPage clamps to valid range', async () => { /* ... */ });
});
```

**Effort** : M (medium — nécessite setup MSW)
**Priorité** : P3

---

## Observations transverses

### Points positifs

**Architecture des stores Zustand** : L'utilisation de `useShallow` dans page.tsx pour tous les sélecteurs Zustand (`useCanvasStore`, `useSelectionStore`, `useUIStore`) est correcte et évite les re-renders inutiles. La séparation en 3 stores (canvas, selection, UI) respecte le principe "1 store = 1 domaine". C'est la meilleure pratique documentée dans les règles frontend React du projet.

**Cleanup du canvas Fabric** : Le useEffect d'initialisation Fabric dispose correctement (`fabricRef.current.dispose()`) lors de l'unmount du composant. Le pattern `cancelled` (booléen de closures) est correctement utilisé dans page.tsx pour le fetch du PDF binary (lignes 222–245).

**Sécurité des headers** : `next.config.ts` configure des headers de sécurité corrects (CSP, HSTS, X-Frame-Options, Permissions-Policy) avec une distinction embed/non-embed. Le tunnel Sentry `/monitoring` évite les ad-blockers.

**Logger structuré** : `use-document-save.ts` utilise `useLogger` du package `@giga-pdf/logger` pour tous ses logs — c'est le pattern correct à propager dans les autres fichiers.

**Debounce/immediate save** : La stratégie de sauvegarde hybride (immédiate pour les actions critiques, debounced pour les modifications mineures, auto-save de 30s) dans `use-document-save.ts` est architecturalement solide avec gestion de la queue offline.

### Problèmes systémiques

**Absence de TanStack Query dans l'éditeur** : Toute la couche de data fetching de l'éditeur (useDocument, fetch PDF binary dans page.tsx, fetch dans editor-canvas loadPage) utilise `fetch + useState + useEffect` manuels. TanStack Query est déjà dans le bundle (via `optimizePackageImports`). Son adoption éliminerait les patterns de fetch dupliqués, apporterait le cache et la deduplication, et simplifierait l'état de chargement.

**Contamination des console.log** : 43 `console.log` actifs dans les deux seuls fichiers éditeur (editor-canvas.tsx + page.tsx) contre un logger structuré existant (`@giga-pdf/logger`). C'est incohérent avec use-document-save.ts qui utilise correctement `useLogger`. Un lint rule ESLint `no-console` dans `apps/web/.eslintrc` résoudrait ce problème structurellement.

**"use cache" non adoptée** : Aucun usage de la directive `"use cache"` de Next.js 16 dans tout le projet web. Les données qui pourraient bénéficier d'un cache SWR côté serveur (liste des plans, quotas) sont fetched côté client sans cache. À considérer pour les prochaines features mais non bloquant pour l'éditeur.

**Séparation serveur/client** : L'éditeur est entièrement client-side (`"use client"`), ce qui est justifié pour Fabric.js. Cependant les métadonnées du document (nom, page count, droits d'accès) pourraient être préchargées côté serveur pour réduire le flash de chargement. Voir P2-013.

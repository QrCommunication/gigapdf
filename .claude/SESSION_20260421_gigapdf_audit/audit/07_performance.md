# GigaPDF — Audit Performance

**Session:** SESSION_20260421_gigapdf_audit
**Date:** 2026-04-21
**Périmètre:** Frontend bundle, Core Web Vitals, PDF rendering, Zustand, API latency, DB, Networking

---

## Légende de sévérité

| Niveau | Critère |
|--------|---------|
| CRITIQUE | Bloque la performance ou cause des crashes mémoire en production |
| HAUT | Impact mesurable sur LCP/INP/TTI, perceptible par l'utilisateur |
| MOYEN | Optimisation nette possible, pas d'urgence immédiate |
| BAS | Micro-optimisation ou dette technique mineure |

---

## 1. Frontend Bundle

### [CRITIQUE] PDF.js worker chargé depuis CDN externe — pas de fallback offline, latence réseau non maîtrisée

**Fichier :** `/packages/canvas/src/renderers/pdf-renderer.ts:10`

```typescript
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
```

Le worker PDF.js (~800KB gzippé) est chargé depuis cdnjs à chaque ouverture d'éditeur. Problèmes :
- Dépendance externe non versionnée de façon reproductible (CDN peut servir une version décalée)
- Latence de résolution DNS + TLS + download : +200-500ms sur connexion lente
- Pas de cache garanti (cache-busting implicite par version)
- Bloque le premier rendu PDF si le CDN répond lentement

**Correction :** Bundler le worker avec Next.js ou utiliser `pdfjs-dist/build/pdf.worker.min.mjs` en local via `/public/`.

```typescript
// Correct
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
// Copier le fichier : cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/
```

---

### [CRITIQUE] Double téléchargement du PDF binaire à chaque changement de page

**Fichier :** `/apps/web/src/components/editor/editor-canvas.tsx:987-1001`

À chaque navigation entre pages, `loadPage()` exécute :
1. `fetch('/backend-api/api/v1/documents/{docId}/download')` — télécharge le PDF entier
2. `new PDFRenderer()` → `renderer.loadDocument(arrayBuffer)` — re-parse tout le PDF
3. `renderer.renderPageToDataURL(pageNumber)` — re-rend la page
4. `renderer.dispose()` — détruit le renderer

Pour un PDF de 10MB et 50 pages, cela génère 50 × 10MB = 500MB de transfert réseau lors d'une navigation complète. Aucun cache du `ArrayBuffer`, aucun cache du `PDFDocumentProxy`.

**Correction :** Charger et parser le PDF une seule fois, mémoriser le `PDFRenderer` dans un ref, ne re-rendre que la page cible.

```typescript
// Dans editor-canvas.tsx — cache PDF au niveau du composant
const pdfRendererRef = useRef<PDFRenderer | null>(null);
const pdfBytesRef = useRef<ArrayBuffer | null>(null);

// Charger 1 seule fois
if (!pdfBytesRef.current) {
  const response = await fetch(pdfUrl, { credentials: 'include' });
  pdfBytesRef.current = await response.arrayBuffer();
  pdfRendererRef.current = new PDFRenderer();
  await pdfRendererRef.current.loadDocument(pdfBytesRef.current);
}
// Ne rendre que la page demandée
const dataUrl = await pdfRendererRef.current!.renderPageToDataURL(pageData.pageNumber, { scale: renderScale });
```

---

### [HAUT] Fabric.js (300KB+) et pdf-lib (1.2MB+) chargés dans le bundle initial

**Fichier :** `/apps/web/src/components/editor/editor-canvas.tsx:493`

```typescript
// Fabric chargé dynamiquement — correct
import("fabric").then((fabricModule) => { ... });
```

Fabric.js est bien chargé dynamiquement. Mais `pdf-lib` est dans `@giga-pdf/pdf-engine` qui est listé comme dépendance directe dans `apps/web/package.json` et non lazy-loadé. Le bundle initial embarque potentiellement pdf-lib (~1.2MB), pdfjs-dist (~700KB), et fabric (~300KB) dans le même chunk de route.

Vérifier avec `next build --analyze` (ajouter `@next/bundle-analyzer`) si pdf-lib arrive dans le chunk de route `/editor/[id]` avant l'interaction.

**Impact estimé :** TTI +1.5-3s sur connexion 4G moyenne si ces chunks ne sont pas splittés.

---

### [HAUT] 46 fichiers importent `lucide-react` avec barrel imports

**Fichiers :** 46 fichiers dans `/apps/web/src/` (constaté par grep)

```typescript
// Anti-pattern dans editor/[id]/page.tsx:9-21
import {
  ArrowLeft, Save, Download, Users, Loader2, AlertCircle,
  Wifi, WifiOff, Pencil, Check, X,
} from "lucide-react";
```

Les barrel imports depuis `lucide-react` importent le module entier avant tree-shaking. Avec 46 fichiers utilisant chacun plusieurs icônes, le risque de régression tree-shaking est élevé si Turbopack ne termine pas correctement l'analyse des re-exports.

**Correction :** Imports directs systématiques.

```typescript
// Correct
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Save from 'lucide-react/dist/esm/icons/save';
```

---

### [HAUT] `editor/[id]/page.tsx` est une page Client Component monolithique de 1100 lignes

**Fichier :** `/apps/web/src/app/editor/[id]/page.tsx:1-1107`

L'intégralité de la page éditeur est un seul Client Component avec `"use client"`. Cela empêche tout Server Component et tout streaming SSR. Au premier chargement, le navigateur reçoit le shell HTML vide + doit télécharger, parser et exécuter le bundle JS avant d'afficher quoi que ce soit.

**Impact LCP :** LCP estimé à >3s. La page entière est bloquée sur le JS.

---

### [MOYEN] Pas de `next/dynamic` sur les panneaux lourds de l'éditeur

**Fichier :** `/apps/web/src/app/editor/[id]/page.tsx:28-39`

Les composants `DocumentInfoSidebar`, `FormsPanel`, `CollaborationOverlay`, `CollaboratorsList`, `PropertiesPanel` sont importés statiquement. Ils ne sont utiles que si l'utilisateur les ouvre.

**Correction :**

```typescript
const FormsPanel = dynamic(() => import('@/components/editor/forms-panel').then(m => m.FormsPanel), { ssr: false });
const DocumentInfoSidebar = dynamic(() => import('@/components/editor/document-info-sidebar').then(m => m.DocumentInfoSidebar), { ssr: false });
```

---

### [MOYEN] Turbopack activé par défaut (Next.js 16) mais `next.config.ts` sans optimisation de cache

**Fichier :** `/apps/web/next.config.ts`

`ppr: false` est correct mais la configuration ne tire pas parti des nouvelles APIs de cache Next.js 16 (`"use cache"`, `cacheLife`, `cacheTag`). Le dashboard et les pages statiques ne bénéficient d'aucun cache component.

---

## 2. Core Web Vitals (Estimation)

### [CRITIQUE] LCP : estimé >4s — Lent

L'éditeur est un Client Component `"use client"` pur. Le LCP est la toile Fabric.js ou le rendu PDF. La chaîne bloquante est :

```
HTML shell → JS bundle download (~3-4MB non-gzippé estimé) 
→ React hydratation → useDocument (fetch API) → loadDocument (fetch PDF binaire)
→ PDFRenderer.renderPageToDataURL() → FabricImage.fromURL() → canvas.renderAll()
```

Estimation par étape sur connexion 4G (20Mbps, 50ms RTT) :
- JS bundle download : ~800ms (si split correct) à ~2s (si pas splittés)
- fetch API document : +150-300ms
- fetch PDF binaire : +200-800ms selon taille
- Rendu PDF canvas : +300-800ms

**LCP estimé : 2.5s — 4s+.** Sans split bundle, probablement dans la zone ROUGE.

---

### [HAUT] INP : interactions canvas potentiellement >200ms

**Fichier :** `/apps/web/src/components/editor/editor-canvas.tsx:389-429`

Sur chaque `object:modified` Fabric.js, la chaîne synchrone est :
1. `fabricObjectToElement()` — conversion objet Fabric → Element
2. `onElementModifiedRef.current?.(element)` → `handleElementModified()` dans page.tsx
3. `api.updateElement()` — fetch HTTP asynchrone (non-bloquant)
4. `saveHistory(canvas)` → `JSON.stringify(canvas.toObject())` — **SYNCHRONE sur le thread principal**

`JSON.stringify(canvas.toObject(["data"]))` sérialise tout le canvas à chaque modification. Pour un canvas avec 50+ éléments et une image PDF en fond, cela peut dépasser 10-20ms par appel, causant des jank visibles sur les interactions répétées (déplacement d'objet).

**Impact INP estimé : 100-300ms** sur documents complexes.

---

### [HAUT] CLS : thumbnails sans dimensions fixes dans la sidebar

**Fichier :** `/apps/web/src/components/editor/pages-sidebar.tsx:93-100`

```tsx
<div className="aspect-[8.5/11] bg-white flex items-center justify-center">
  {page.preview?.thumbnailUrl ? (
    <img
      src={`${previewBaseUrl}${page.preview.thumbnailUrl}`}
      alt={`Page ${index + 1}`}
      className="w-full h-full object-contain"
      loading="lazy"
    />
```

`aspect-[8.5/11]` maintient le ratio mais les images n'ont pas `width`/`height` explicites. La sidebar peut subir un CLS si les thumbnails arrivent après le layout initial.

**Manque également :** `decoding="async"` sur toutes les images thumbnail.

---

### [MOYEN] CLS potentiel lors du chargement du nom du document

**Fichier :** `/apps/web/src/app/editor/[id]/page.tsx:868-876`

```tsx
<h1 className="text-base font-semibold hover:text-primary transition-colors">
  {name || t("untitled")}
  {isDirty && <span className="ml-1 text-muted-foreground">*</span>}
</h1>
```

`name` est `""` au premier render puis mis à jour après le fetch API. Si le texte a une longueur variable, cela cause un layout shift dans le header.

---

## 3. PDF Rendering Performance

### [CRITIQUE] PDFRenderer sans cache : re-parse et re-render à chaque changement de page

**Fichier :** `/packages/canvas/src/renderers/pdf-renderer.ts:86-100`

La classe `PDFRenderer` possède un `pageCache: Map<number, PDFPageProxy>` interne — mais l'instance est détruite et recréée à chaque navigation (`renderer.dispose()` dans `loadPage()`). Le cache interne est donc inutile en pratique.

```typescript
// Dans editor-canvas.tsx:994-1001 — dispose à chaque page !
const renderer = new PDFRenderer();
await renderer.loadDocument(arrayBuffer);
const dataUrl = await renderer.renderPageToDataURL(pageData.pageNumber, { scale: renderScale });
renderer.dispose(); // ← Détruit le cache ET le PDFDocumentProxy
```

Pour un PDF de 100 pages, naviguer de la page 1 à la page 100 et revenir : 200 `loadDocument()` + 200 `renderPageToDataURL()` + 200 téléchargements réseau.

---

### [CRITIQUE] Aucun OffscreenCanvas ni Web Worker pour le rendu PDF

**Fichier :** `/packages/canvas/src/renderers/pdf-renderer.ts:105-139`

Le rendu PDF via PDF.js se fait entièrement sur le thread principal UI :
```typescript
const context = canvas.getContext("2d");
// ...
const renderTask = page.render({ canvasContext: context, viewport });
await renderTask.promise; // Bloque potentiellement le thread UI
```

Pour des PDF complexes (nombreuses images, polices embarquées), `renderTask.promise` peut prendre 200-800ms sur le thread principal, causant des freezes visibles.

**Correction :** Utiliser `OffscreenCanvas` transféré dans un Web Worker ou utiliser les PDF.js canvas workers.

```typescript
// Dans un worker dédié (pdf-render.worker.ts)
const offscreen = new OffscreenCanvas(width, height);
const ctx = offscreen.getContext('2d');
await page.render({ canvasContext: ctx, viewport }).promise;
const imageBitmap = offscreen.transferToImageBitmap();
self.postMessage({ imageBitmap }, [imageBitmap]);
```

---

### [HAUT] Thumbnails générées côté frontend sans cache persistant

**Fichier :** `/packages/canvas/src/renderers/pdf-renderer.ts:188-202`

```typescript
async createThumbnail(pageNumber, maxWidth, maxHeight): Promise<string> {
  // Calcule scale, render la page entière, retourne dataURL
  return this.renderPageToDataURL(pageNumber, { scale });
}
```

Les thumbnails sont générées à la volée côté client sans mise en cache persistante (aucun `sessionStorage`, `IndexedDB`, ou cache HTTP). Chaque ouverture du document régénère toutes les thumbnails visibles dans la sidebar.

**Impact :** Pour un PDF de 100 pages, la sidebar tente de générer 100 thumbnails. Même avec `loading="lazy"`, les premières thumbnails visibles bloquent le thread UI.

---

### [HAUT] `renderScale = Math.min(window.devicePixelRatio || 2, 3)` → image PNG en mémoire 3× surdimensionnée

**Fichier :** `/apps/web/src/components/editor/editor-canvas.tsx:999`

La page PDF est rendue à 2-3× la résolution native puis réduite via `scaleX/scaleY`. Pour une page A4 (595×842pt) à scale=3, le canvas intermédiaire fait 1785×2526px — soit ~18MB en mémoire pour une seule page. Cette dataURL PNG est ensuite encodée en base64 et stockée dans l'état Fabric.js via `historyStack` (voir point History Store).

---

### [MOYEN] Pas de virtualisation pour documents 100+ pages dans `PagesSidebar`

**Fichier :** `/apps/web/src/components/editor/pages-sidebar.tsx:78-201`

```tsx
{pages.map((page, index) => (
  <div key={page.pageId} ...>
    <img src={...} loading="lazy" />
  </div>
))}
```

La sidebar rend `pages.length` éléments DOM même pour les pages hors viewport. Pour un PDF de 200 pages, cela crée 200 nœuds DOM + 200 `<img>`. `loading="lazy"` aide pour le réseau mais pas pour le DOM.

**Correction :** Virtualiser avec `@tanstack/react-virtual`.

---

## 4. State Management (Zustand)

### [CRITIQUE] History store : deep clone JSON à chaque snapshot, dataURL d'image de 18MB incluse

**Fichier :** `/packages/editor/src/stores/history-store.ts:44-48`

```typescript
const snapshot: HistorySnapshot = {
  id: `snapshot-${Date.now()}-${Math.random()}`,
  pages: JSON.parse(JSON.stringify(pages)), // Deep clone ← PROBLÈME
  ...
};
```

Le `pages` array contient les `elements` de chaque page. Si la page contient un élément image avec `source.dataUrl` (base64 d'une image PNG de 18MB), le deep clone JSON duplique ce payload à chaque action. Avec 50 snapshots max, cela représente potentiellement 50 × 18MB = 900MB en mémoire pour un document avec des images.

**En pratique**, le history store de `packages/editor` stocke les `PageObject[]` du document mais pas le canvas Fabric. L'autre history store est le `historyStack` local dans `editor-canvas.tsx` (ligne 167) qui stocke `JSON.stringify(canvas.toObject())` — incluant la dataURL de l'image fond PDF.

**Fichier :** `/apps/web/src/components/editor/editor-canvas.tsx:183-190`

```typescript
const saveHistory = useCallback((canvas: FabricCanvas) => {
  const json = JSON.stringify(canvas.toObject(["data"])); // ← Inclut dataUrl de l'image fond
  setHistoryStack((prev) => {
    const newStack = prev.slice(0, historyIndexRef.current + 1);
    return [...newStack, json]; // ← Stocké dans le state React
  });
```

Ce `json` est la sérialisation complète du canvas Fabric incluant l'image fond PDF en base64. Pour 50 snapshots × 18MB (image fond 3× DPR) = jusqu'à **900MB de mémoire JS** pour l'historique seul.

**Correction :** Exclure l'image fond du canvas historique. Stocker séparément les objets éditables uniquement.

```typescript
// Exclure le fond PDF de l'historique
const editableObjects = canvas.getObjects().filter(
  obj => !(obj as FabricObjectWithData).data?.isPdfBackground
);
const json = JSON.stringify({ objects: editableObjects.map(o => o.toObject(['data'])) });
```

---

### [HAUT] `onCanvasReady` re-créé à chaque changement de `historyIndex` ou `historyStack`

**Fichier :** `/apps/web/src/components/editor/editor-canvas.tsx:1070-1160`

```typescript
useEffect(() => {
  if (!onCanvasReady) return;
  const handle: EditorCanvasHandle = {
    undo: () => { ... historyIndex ... historyStack ... },
    redo: () => { ... historyIndex ... historyStack ... },
    canUndo: () => historyIndex > 0,
    canRedo: () => historyIndex < historyStack.length - 1,
    ...
  };
  onCanvasReady(handle);
}, [historyIndex, historyStack, onCanvasReady]); // ← Se déclenche à chaque action !
```

Ce `useEffect` reconstruit et re-publie le `handle` à chaque modification du canvas (chaque ajout d'élément, chaque déplacement). Cela déclenche un setState dans le parent (`setCanvasHandle(handle)`) → re-render du parent → re-render de toute la toolbar.

**Impact INP :** Chaque interaction canvas cause 2 renders supplémentaires du parent.

---

### [HAUT] Aucun `useShallow` dans les stores Zustand

Les stores Zustand (`useDocumentStore`, `useHistoryStore`) n'utilisent pas `useShallow` pour les sélecteurs d'objets. Tout composant qui s'abonne à plusieurs propriétés d'un store se re-rend à chaque mutation du store, même si les propriétés sélectionnées n'ont pas changé.

**Exemple :** Si un composant sélectionne `{ pages, isDirty }` et que `lastSaved` change, le composant se re-rend inutilement.

**Correction :**

```typescript
import { useShallow } from 'zustand/react/shallow';

const { pages, isDirty } = useDocumentStore(
  useShallow(state => ({ pages: state.pages, isDirty: state.isDirty }))
);
```

---

### [MOYEN] `selectedElements` recalculé dans `editor/[id]/page.tsx` à chaque render

**Fichier :** `/apps/web/src/app/editor/[id]/page.tsx:286-291`

```typescript
const selectedElements = useMemo(() => {
  if (!currentPage) return [];
  return currentPage.elements.filter((el) =>
    selectedElementIds.includes(el.elementId)
  );
}, [currentPage, selectedElementIds]);
```

`selectedElementIds.includes()` est O(N×M) (N éléments de la page × M sélectionnés). Convertir `selectedElementIds` en `Set` pour O(1) lookup.

---

### [MOYEN] `handleMouseMove` envoie des positions à chaque `mousemove` sans throttle

**Fichier :** `/apps/web/src/app/editor/[id]/page.tsx:388-397`

```typescript
const handleMouseMove = useCallback(
  (event: React.MouseEvent) => {
    // ...
    sendCursorPosition({ x, y }, currentPage.pageId); // Emit WebSocket à chaque pixel
  },
  [zoom, currentPage, sendCursorPosition]
);
```

`mousemove` se déclenche à 60-240fps sur les écrans modernes, soit potentiellement 240 messages WebSocket/seconde par utilisateur. Cela sature le channel WebSocket et augmente la charge serveur en mode collaboratif.

**Correction :** Throttler à 30ms minimum (`requestAnimationFrame` ou `throttle` avec 30ms).

---

## 5. Backend API Latency

### [HAUT] `get_document` est synchrone malgré le contexte async FastAPI

**Fichier :** `/app/api/v1/documents.py:479-483`

```python
document = document_service.get_document(  # ← PAS await
    document_id=document_id,
    include_elements=include_elements,
    page_range=page_range,
)
```

`document_service.get_document()` est appelé sans `await` dans un endpoint `async`. Si l'implémentation dans `DocumentService` effectue des accès mémoire/Redis synchrones dans un thread async, cela bloque la boucle d'événements FastAPI.

---

### [HAUT] Double fetch sur chaque ouverture d'éditeur (waterfall séquentiel)

**Fichier :** `/apps/web/src/hooks/use-document.ts:101-115` + `/apps/web/src/app/editor/[id]/page.tsx:161-181`

Séquence actuelle :
1. `api.loadDocument(storedDocumentId)` → obtenir `document_id` de session
2. `api.getDocument(docId)` → obtenir structure document + pages + éléments
3. `fetch(downloadUrl)` → télécharger le PDF binaire (dans un `useEffect` séparé)

Ces 3 appels sont **séquentiels** : chacun attend la réponse du précédent. Sur un réseau à 100ms RTT, cela ajoute 300ms de latence pure de waterfall avant que le PDF puisse commencer à s'afficher.

**Correction :** Paralléliser les appels 2 et 3 via `Promise.all()` une fois le `document_id` obtenu.

---

### [MOYEN] Absence de cache Redis sur `GET /documents/{id}` — lecture session en mémoire uniquement

**Fichier :** `/app/repositories/document_repo.py:112-160`

Le `DocumentSessionManager` utilise un `OrderedDict` local + Redis optionnel pour la persistance cross-worker. Si le worker qui a chargé le document n'est pas celui qui reçoit la requête suivante (4 workers configurés dans `config.py:36`), la session doit être rechargée depuis Redis. Si Redis est indisponible, elle doit être rechargée depuis la DB.

Ce pattern peut causer des latences aléatoires de 500ms-2s sur la première requête cross-worker.

---

### [MOYEN] `max_sessions=100` avec `session_timeout_minutes=120`

**Fichier :** `/app/repositories/document_repo.py:128`

100 sessions maximum pour tout le serveur (4 workers). En cas de trafic, les sessions les plus anciennes sont évictées de la LRU et rechargées depuis Redis/DB à la requête suivante. Ce paramètre devrait être configuré par worker (100 × 4 workers = 400 sessions effectives).

---

### [MOYEN] Payload `GET /documents/{id}` non compressé pour les documents lourds

**Fichier :** `/app/api/v1/documents.py:487-494`

Le document entier (`model_dump(by_alias=True)`) est retourné en une seule réponse JSON incluant tous les éléments de toutes les pages. Pour un PDF de 100 pages avec du texte extrait, ce payload peut dépasser 5-10MB de JSON. Aucun streaming ni pagination côté éléments n'est implémenté pour `GET /documents/{id}`.

---

## 6. Base de Données

### [MOYEN] Index manquant sur `stored_documents.updated_at` pour les requêtes de liste triées

**Fichier :** `/app/models/database.py:81-84`

```python
__table_args__ = (
    Index("idx_stored_documents_owner", "owner_id"),
    Index("idx_stored_documents_folder", "folder_id"),
    Index("idx_stored_documents_deleted", "is_deleted"),
    # ← Pas d'index sur updated_at, created_at
)
```

Les listes de documents (dashboard) sont probablement triées par `updated_at DESC`. Sans index sur `updated_at`, PostgreSQL fait un `Seq Scan` sur toute la table filtrée par `owner_id` puis un sort.

**Correction :** Ajouter un index composé `(owner_id, updated_at DESC)` et `(owner_id, is_deleted, updated_at DESC)`.

---

### [MOYEN] Connection pool `pool_size=20` + `max_overflow=10` = 30 connexions max

**Fichier :** `/app/core/database.py:58-65`

Avec 4 workers Uvicorn (`app_workers: int = 4`), chaque worker a son propre pool de connexions : 4 × (20 + 10) = **120 connexions PostgreSQL maximum**. Pour une instance PostgreSQL standard (max_connections=100 par défaut), cela peut provoquer des `connection refused`.

**Correction :** Réduire `pool_size` à 5 par worker avec 4 workers, ou utiliser `pgBouncer`/`PgCat` en connection pooler.

---

### [BAS] Pas d'index JSONB sur `metadata_cache` dans `stored_documents`

**Fichier :** `/app/models/database.py:61`

Si des filtres ou recherches par metadata (titre, auteur) sont effectués, un index GIN sur `metadata_cache` serait nécessaire. À confirmer selon les patterns de requêtes réels.

---

## 7. Networking

### [HAUT] Worker PDF.js depuis CDN externe (cdnjs) — pas de contrôle sur les headers de cache

**Fichier :** `/packages/canvas/src/renderers/pdf-renderer.ts:10`

Déjà mentionné en section 1. Impact réseau en plus du bundle : le browser doit ouvrir une nouvelle connexion TLS vers cdnjs.cloudflare.com, ajoutant 50-200ms de handshake.

---

### [HAUT] Pas de compression Brotli/Gzip pour les réponses FastAPI

**Fichier :** `/app/main.py` — aucun middleware `GZipMiddleware`

FastAPI ne compresse pas les réponses JSON par défaut. La réponse `GET /documents/{id}` de 5-10MB est envoyée en clair. Avec Brotli, ce payload serait typiquement réduit de 70-80% (1-2MB).

**Correction :**

```python
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)
```

---

### [HAUT] Proxy Next.js → FastAPI sur chaque requête PDF

**Fichier :** `/apps/web/next.config.ts:37-42`

```typescript
rewrites() {
  return [{
    source: "/backend-api/:path*",
    destination: `${apiUrl}/:path*`,
  }];
}
```

Le téléchargement du PDF binaire (typiquement 1-50MB) transite par le serveur Next.js en tant que proxy. Cela double la bande passante consommée côté serveur et ajoute une latence de buffering. Pour les fichiers binaires lourds, le client devrait télécharger directement depuis le backend ou depuis S3 avec une URL signée.

---

### [MOYEN] HTTP/2 non vérifié — pas de configuration explicite

**Fichier :** `/app/main.py`, nginx (non inspecté dans cet audit)

Le code applicatif ne configure pas explicitement HTTP/2. Sans HTTP/2, le navigateur est limité à 6 connexions parallèles vers le même domaine, ce qui ralentit le chargement parallèle des thumbnails et assets.

**Action :** Vérifier la configuration nginx (`/etc/nginx/sites-available/`) pour `listen 443 ssl http2`.

---

### [MOYEN] Pas de CDN pour les assets statiques Next.js

**Fichier :** `/apps/web/next.config.ts` — pas de `assetPrefix` configuré

Les assets JS/CSS du bundle sont servis directement depuis le VPS (Scaleway d'après les mémoires projet). Sans CDN, les utilisateurs géographiquement distants ont des RTT élevés pour chaque asset.

---

### [BAS] `sendCursorPosition` WebSocket non throttlé — jusqu'à 240 messages/seconde

Voir section 4 (Zustand). Impact réseau additionnel en collaboration multi-utilisateurs.

---

## Résumé des Priorités

### Actions immédiates (CRITIQUE)

| # | Finding | Fichier | Impact estimé |
|---|---------|---------|---------------|
| 1 | Worker PDF.js depuis CDN externe | `pdf-renderer.ts:10` | +200-500ms TTFB PDF |
| 2 | Double téléchargement PDF binaire par page | `editor-canvas.tsx:987` | ×N MB réseau par navigation |
| 3 | History store inclut dataURL 18MB dans JSON.stringify | `editor-canvas.tsx:183` | Jusqu'à 900MB mémoire JS |
| 4 | OffscreenCanvas absent — rendu PDF sur thread UI | `pdf-renderer.ts:132` | Freezes 200-800ms |

### Actions prioritaires (HAUT)

| # | Finding | Fichier | Impact estimé |
|---|---------|---------|---------------|
| 5 | LCP >4s (Client Component pur, no split) | `page.tsx` | LCP hors zone verte |
| 6 | Barrel imports lucide-react (46 fichiers) | Multiple | Bundle +20-50KB |
| 7 | onCanvasReady re-créé à chaque action canvas | `editor-canvas.tsx:1070` | +2 renders parent/action |
| 8 | Aucun useShallow sur stores Zustand | Stores | Re-renders inutiles |
| 9 | Waterfall séquentiel 3 fetches à l'ouverture | `use-document.ts:101` | +200-300ms TTI |
| 10 | Pas de GZipMiddleware FastAPI | `main.py` | Payloads JSON 5-10× plus lourds |
| 11 | Proxy Next.js pour téléchargements PDF | `next.config.ts:37` | Double bande passante |

### Améliorations recommandées (MOYEN/BAS)

- Virtualiser PagesSidebar pour documents 100+ pages
- Index composé `(owner_id, updated_at DESC)` sur `stored_documents`
- Réduire `pool_size` par worker ou ajouter pgBouncer
- Vérifier HTTP/2 nginx
- Throttler `sendCursorPosition` WebSocket à 30ms
- Ajouter CDN prefix pour assets statiques
- `decoding="async"` + dimensions explicites sur thumbnails

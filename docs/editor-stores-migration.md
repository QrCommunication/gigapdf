# Migration des Stores Zustand — Éditeur PDF

**Date :** 2026-04-21  
**Session :** HAUT-PERF-05 (XL)  
**Statut :** Phase 1 complète — Domaines 1, 2, 3 migrés

---

## Résumé de la Phase 1

### useState supprimés (10 sur 15)

| # | useState supprimé | Store cible | Action utilisée |
|---|-------------------|-------------|-----------------|
| 1 | `activeTool` | `canvas-store` | `setActiveTool` |
| 2 | `zoom` | `canvas-store` | `setZoom` (avec clamping min/max intégré) |
| 3 | `shapeType` | `canvas-store` | `setShapeType` (nouveau) |
| 4 | `annotationType` | `canvas-store` | `setAnnotationType` (nouveau) |
| 5 | `strokeColor` | `canvas-store` | `setStrokeColor` (nouveau) |
| 6 | `fillColor` | `canvas-store` | `setFillColor` (nouveau) |
| 7 | `strokeWidth` | `canvas-store` | `setStrokeWidth` (nouveau) |
| 8 | `selectedElementIds` | `selection-store` | `selectElements` / `clearSelection` / `deselectElement` |
| 9 | `showFormsPanel` | `ui-store` | `toggleFormsPanel` / `setShowFormsPanel` (nouveau) |
| 10 | `isContentEditActive` | `ui-store` | `setContentEditActive` / `toggleContentEdit` (nouveau) |

### useState conservés localement (5 — justifiés)

| useState conservé | Raison |
|-------------------|--------|
| `canvasHandle` | Handle impératif Fabric.js — non-sérialisable, transient |
| `currentPdfFile` | Objet `File` JS — non-sérialisable dans un store Zustand |
| `contentModifications` | État éditeur transitoire — pas de valeur à persister inter-session |
| `isEditingName` | État UI d'input contrôlé — transitoire, pas partagé |
| `editedName` | Valeur controlled input — transitoire, pas partagée |

---

## Fichiers modifiés

### `packages/editor/src/types.ts`
- `CanvasState` étendu avec : `shapeType`, `annotationType`, `strokeColor`, `fillColor`, `strokeWidth`
- `UIState` étendu avec : `showFormsPanel`, `isContentEditActive`
- Import ajouté : `ShapeType`, `AnnotationType` depuis `@giga-pdf/types`

### `packages/editor/src/stores/canvas-store.ts`
- `CanvasStore` interface étendue : `setShapeType`, `setAnnotationType`, `setStrokeColor`, `setFillColor`, `setStrokeWidth`
- `initialState` complété avec les valeurs par défaut
- Actions immer ajoutées avec validation (`strokeWidth` clamped à 0.5 min)

### `packages/editor/src/stores/ui-store.ts`
- `UIStore` interface étendue : `toggleFormsPanel`, `setShowFormsPanel`, `toggleContentEdit`, `setContentEditActive`
- `initialState` complété avec `showFormsPanel: false`, `isContentEditActive: false`
- Actions immer ajoutées

### `apps/web/src/app/editor/[id]/page.tsx`
- Import ajouté : `useShallow` depuis `zustand/react/shallow`
- Import ajouté : `useCanvasStore`, `useSelectionStore`, `useUIStore` depuis `@giga-pdf/editor`
- Import retiré : `Tool`, `ShapeType`, `AnnotationType` (plus nécessaires directement)
- 3 blocs `useShallow` selectors avec les 3 stores
- `selectedElementIds` dérivé via `useMemo(() => Array.from(selectedElementIdsSet), [selectedElementIdsSet])`
- `handleSelectionChanged` migré : utilise `selectElements(ids, currentPage.pageId)` / `clearSelection()`
- `handleElementRemoved` migré : utilise `deselectElement(elementId)`
- `handleToggleContentEdit` migré : utilise `setContentEditActive(true/false)` + clear modifications
- `onToggleFormsPanel` inline migré → `toggleFormsPanel` direct
- Zoom shortcuts : `setZoom((z) => ...)` → `setZoom(zoom + delta)` (clamping dans le store)
- Dépendances `useEffect` keyboard complétées : `zoom`, `clearSelection`, `setActiveTool`, `setZoom`

---

## Patterns appliqués

### `useShallow` pour les selectors d'objets (Zustand 5)

```typescript
// Pattern obligatoire pour éviter les re-renders infinis
const { zoom, setZoom } = useCanvasStore(
  useShallow((s) => ({
    zoom: s.zoom,
    setZoom: s.setZoom,
  }))
);
```

### Dérivation `Set` → `Array` pour compatibilité downstream

```typescript
// selection-store stocke un Set<UUID> (plus efficace pour has/add/delete)
// Mais les composants downstream (EditorCanvas, PropertiesPanel) attendent string[]
const selectedElementIds = useMemo(
  () => Array.from(selectedElementIdsSet),
  [selectedElementIdsSet]
);
```

### Actions stables Zustand (pas besoin de useCallback pour les actions du store)

Les actions Zustand sont des références stables — pas besoin de `useCallback` pour les wraper.
Exception : les handlers qui combinent plusieurs actions ou ont une logique métier locale.

---

## Domaines différés (Phase 2)

### Domaine 4 — `document-store` (complexité élevée)

Le `useDocument` hook gère actuellement :
- Pages, currentPage, currentPageIndex (via `goToPage`)
- isDirty, setDirty
- name, setName
- outlines, layers, embeddedFiles
- addPage, deletePage, reorderPages, duplicatePage

**Raison du report :**
- `useDocument` fait des appels API (fetch PDF metadata) — il faudrait soit migrer ces appels vers un middleware Zustand, soit garder le hook et alimenter le store en parallèle
- `goToPage` synchronise avec le `canvas-store.currentPageIndex` — risque de double source of truth
- `setDirty` / `isDirty` sont déjà dans `document-store` mais `useDocumentSave` les lit depuis `useDocument`

**Plan Phase 2 :**
1. Supprimer `useDocument` et migrer l'hydratation initiale vers `document-store.setDocument()`
2. `goToPage` → `canvas-store.setCurrentPage()`
3. `setDirty` / `isDirty` → `document-store.setDirty()` / `document-store.isDirty`
4. Adapter `useDocumentSave` pour lire depuis `document-store`

### Domaine 5 — `history-store` (bloqué par architecture Fabric.js)

- `canUndo` / `canRedo` / `undo` / `redo` sont actuellement fournis par `EditorCanvasHandle` (Fabric.js)
- Le `history-store` Zustand est une implémentation parallèle non connectée à Fabric.js
- **Décision : Garder `canvasHandle?.canUndo()` en attendant la refactoring du canvas**

### Domaine 6 — `collaboration-store`

- `useCollaboration` hook gère le WebSocket (Socket.io)
- Le `collaboration-store` existe mais n'est pas alimenté par le hook
- Phase 3 : Connecter `useCollaboration` pour écrire dans `collaboration-store`

---

## Résultats

| Métrique | Avant | Après |
|----------|-------|-------|
| `useState` dans page.tsx | 15 | 5 |
| `useState` migrés | — | 10 |
| Stores utilisés | 0 | 3 |
| `useShallow` selectors | 0 | 3 |
| Erreurs TypeScript nouvelles | — | 0 |
| Tests cassés | — | 0 |

---

## Roadmap Phase 2 (prochaine session)

1. **Migrer `useDocument` → `document-store`** (4-6h estimé)
   - Hydratation initiale via `setDocument()`
   - `goToPage` → `canvas-store.setCurrentPage()`
   - Adapter `useDocumentSave` pour lire depuis le store
   - Supprimer `useDocument` ou le transformer en "loader only"

2. **Connecter `useCollaboration` → `collaboration-store`** (2-3h estimé)
   - Écrire `setConnected`, `addUser`, `updateCursor` depuis le hook
   - `CollaborationOverlay` lit depuis `collaboration-store`

3. **Aligner `canvasHandle` undo/redo → `history-store`** (3-4h estimé)
   - Écouter les events Fabric.js pour `pushSnapshot()`
   - `canUndo` / `canRedo` depuis `history-store` au lieu du handle

4. **Nettoyer le `page.tsx`** (1h)
   - `isEditingName` / `editedName` → composant `DocumentTitleEditor` dédié
   - `currentPdfFile` → contexte React dédié si partagé entre composants

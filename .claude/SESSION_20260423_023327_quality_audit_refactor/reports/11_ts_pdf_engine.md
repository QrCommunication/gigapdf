# 11 — TS pdf-engine Review

> Zone scannée : `packages/pdf-engine/src/` (parse/, render/, engine/, merge-split/, encrypt/, forms/, utils/, errors/, index.ts)
> Basé sur : rapports Phase 1 (01_tech_debt_markers.md, 03_dead_code.md) + lecture complète des sources.
> Status tests au moment du review : 6 fichiers de test FAIL, dont 3 tests directement dans packages/pdf-engine.

---

## Top 15 fix cards

---

### P1-001 — Exports superflus dans index.ts (API surface inutile)

**Problème** : 20 symboles sont exportés depuis `packages/pdf-engine/src/index.ts` sans aucun consommateur dans `apps/web/src/` ni `packages/editor/src/`. Ils agrandissent l'API publique du package, complexifient les mises à jour (breaking change à gérer), et augmentent le bundle côté consommateur.

**Liste précise à retirer de l'export public** :
- `closeDocument` — lifecycle non géré côté Next.js serverless
- `getPageDimensions` — dimensions disponibles via `parseDocument`
- `setCanvasPoolSize`, `destroyCanvasPool` — configuration pool, jamais appelée
- `setPlaywrightPoolSize`, `destroyPlaywightPool` — idem Playwright
- `parseMetadata`, `parseBookmarks` — remplacés par `getMetadata` dans les routes
- `updateFormFieldValue` — non exposé dans les API routes Next.js
- `clearFontCache` — gestion implicite du cache
- `rgbToHex`, `normalizeColor` — 0 usage dans apps
- `webToPdf`, `pdfToWeb`, `scaleRect` — utilisés uniquement en interne au package
- `normalizeFontName`, `resolveStandardFont`, `isStandardFont`, `mapPdfFontToStandard` — utilisés uniquement en interne
- `engineLogger` — logger interne, non consommé hors du package
- `markDirty` — exporté depuis `engine/index.ts` mais absent de `index.ts` root ; les renderers l'importent directement, correct

**Correction** : Retirer ces symboles des exports dans `src/index.ts`. Ne pas supprimer les implémentations — elles restent utiles en interne. Les renderers et parsers les importent déjà directement par chemin relatif.

**Priorité** : P1 (API surface / surface d'attaque breaking change)

---

### P1-002 — RT-02 : Fallback silencieux Helvetica dans text-renderer.ts (régression active)

**Problème** : `addText()` et `updateText()` ignorent `element.style.originalFont`. Quand `fontFamily` est une police non-standard (ex. "Calibri") et `originalFont` est défini (ex. "ABCDEF+Calibri"), le renderer fait un fallback silencieux sur Helvetica via `resolveStandardFont()` qui retourne `null`, puis chute sur `embedFont(StandardFonts.Helvetica)`. Aucun warning n'est émis. Le champ `originalFont` dans `TextElement` est complètement ignoré à l'écriture.

**Tests concernés** (actuellement RED) :
- `addText — police non-standard sans originalFont (régression RT-02)` → FAIL
- `addText — originalFont propagation (RÉGRESSION PRINCIPALE RT-02)` → FAIL
- `updateText — originalFont propagation` → FAIL

**Localisation** : `/packages/pdf-engine/src/render/text-renderer.ts` — fonction `resolveFont()` lignes 50-98.

**Correction** : La logique de `resolveFont()` est déjà correcte avec la Stratégie 1 (`FONT_EMBED_CUSTOM_ENABLED`). Le problème : la Stratégie 3 (fallback Helvetica) n'émet pas de warning quand `originalFont` est défini et non-null. Ajouter une branche : si `originalFont !== null` et `FONT_EMBED_CUSTOM_ENABLED === false`, émettre un `engineLogger.warn` explicite mentionnant `originalFont`. Les tests vérifient `process.stderr.write` (via `engineLogger`), pas `console.warn` — le spy actuellement utilise `vi.spyOn(console, 'warn')` alors que le logger écrit sur `process.stderr`. Il faut soit corriger le spy dans les tests (utiliser `vi.spyOn(process.stderr, 'write')`), soit que le renderer émette un `console.warn` en dev — le plus propre est de corriger le test spy ET d'ajouter le warning dans le renderer.

**Priorité** : P1 (bug de perte de données silencieux, 3 tests RED)

---

### P1-003 — `flattenAnnotations` est un no-op non documenté côté appelant

**Problème** : `packages/pdf-engine/src/render/flatten.ts` — `flattenAnnotations()` appelle uniquement `markDirty()` sans aucune opération réelle. Le commentaire interne est correct ("pdf-lib does not support flattening annotations natively"), mais l'export public laisse croire à l'appelant que les annotations sont aplaties. Les annotations PDF réelles (highlights, notes pdfjs) restent présentes dans le document en tant qu'objets séparés après sauvegarde.

**Perte de données potentielle** : Non pour les éléments dessinés via `addAnnotation()` (ils sont dans le content stream, donc effectivement "aplatis"). Mais les annotations PDF natives existantes dans le document source ne sont pas supprimées. Un appelant qui attend `flattenAnnotations()` pour neutraliser des annotations sensibles avant export sera trompé.

**Correction** : Soit (A) implémenter la suppression réelle via `handle._pdfDoc.getPages().forEach(p => p.node.delete(PDFName.of('Annots')))` pour les annotations natives, soit (B) renommer en `markContentStreamAnnotationsAsFlat()` et documenter clairement la limite dans le JSDoc public. Option A est la correction correcte.

**Priorité** : P1 (comportement trompeur de l'API publique)

---

### P2-004 — `as any` dans `preview/renderer.ts:146` — ArrayBuffer potentiellement détaché (bug RT-11)

**Problème** : Dans `extractImage()` (`src/preview/renderer.ts:146`) :
```ts
const imgData = await (page.objs as any).get(imageName);
```
Puis ligne 158 :
```ts
const rawBuffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
```
`data` est `Uint8ClampedArray | Uint8Array`. `Buffer.from(data.buffer, ...)` partage l'ArrayBuffer sous-jacent. Si pdfjs détruit la page (`page.cleanup()`) ou si l'objet imgData est récupéré par le GC, le `ArrayBuffer` peut être transféré/détaché entre la ligne 158 et l'appel sharp qui suit — conduisant à un `TypeError: Cannot perform %TypedArray%.prototype.set on a detached ArrayBuffer`. Ce bug est documenté dans les tests Phase 1 (RT-11).

**Localisation** : `src/preview/renderer.ts` lignes 146, 158-185.

**Correction** :
1. Remplacer `as any` par un type local : `interface PdfjsImageData { data: Uint8ClampedArray; width: number; height: number; }` et caster proprement.
2. Copier les données immédiatement après résolution : `const copy = Buffer.from(data)` (copie profonde, pas de partage d'ArrayBuffer). Utiliser ensuite `copy` dans les appels sharp avec `raw: { width, height, channels: 4 }`.

**Priorité** : P2 (crash runtime potentiel sous charge)

---

### P2-005 — `as unknown as` dans form-extractor.ts — 4 casts sur API privée pdf-lib

**Problème** : `src/parse/form-extractor.ts` contient 4 `as unknown as` pour accéder à des propriétés privées de pdf-lib :
- ligne 154 : `dict` cast pour `dictString()`
- ligne 212 : `page.ref` cast pour extraire `objectNumber`
- ligne 292 : `field.acroField` cast (dict + getDefaultAppearance)
- ligne 301 : `acroField.getWidgets()` cast

Ces casts sont nécessaires car pdf-lib n'expose pas ces APIs publiquement. Ils sont documentés par des commentaires. Cependant le cast ligne 149 (`dictString` paramètre) utilise un type ReturnType générique non-résolu qui est difficile à lire.

**Correction** : Extraire un fichier `src/parse/form-extractor-types.ts` avec les interfaces privées de pdf-lib :
```ts
interface AcroField {
  dict: PdfLibDict;
  getDefaultAppearance(): string | undefined;
  getWidgets(): Widget[];
}
interface PdfLibDict {
  get(key: PDFName): unknown;
}
interface Widget {
  getRectangle(): { x: number; y: number; width: number; height: number };
  P(): { objectNumber: number } | undefined;
}
```
Utiliser ces interfaces dans les casts. Remplacer le type `ReturnType<...>` complexe de `dictString` par `PdfLibDict`. Réduire la surface de `unknown` sans perdre la vérification TS.

**Priorité** : P2 (maintenabilité, type safety)

---

### P2-006 — `buildPageObject` dupliqué dans parser.ts (deux implémentations identiques)

**Problème** : `src/parse/parser.ts` contient deux fonctions distinctes qui font exactement la même chose avec des différences mineures :
- `buildPageObject()` (ligne 154) — utilisée uniquement par `parsePage()`, sans timeout ni graceful degradation
- `buildPageObjectSafe()` (ligne 226) — utilisée par `parseDocument()`, avec `safeExtract` + timeouts

La logique de construction de `PageObject` (mediaBox, cropBox, rotation, preview) est copiée-collée entre les deux. Toute modification de la structure de retour doit être faite aux deux endroits.

**Correction** : Extraire la construction du `PageObject` final dans une fonction `assemblePageObject(pageNumber, viewport, elements, options)`. Conserver les deux fonctions orchestratrices mais leur faire appeler `assemblePageObject`. Réduire la duplication de ~50 lignes.

**Priorité** : P2 (DRY, risque de divergence future)

---

### P2-007 — `extractTextBlocks` et `extractImages` non exposés dans index.ts mais documentés comme APIs publiques

**Problème** : Deux nouvelles APIs standalone sont déclarées `export` dans leurs fichiers respectifs et documentées pour le "Fabric.js editor" :
- `extractTextBlocks()` dans `src/parse/text-extractor.ts:438`
- `extractImages()` dans `src/parse/image-extractor.ts:515`
- `extractFormFields()` dans `src/parse/form-extractor.ts:186`

Aucune n'est exportée depuis `src/index.ts` ni depuis `src/parse/index.ts`. Elles sont inaccessibles aux consommateurs du package. Si des tests les importent directement par chemin, cela crée des imports d'implémentation interne contournant le barrel.

**Correction** : Décider explicitement : (A) les exposer dans `src/index.ts` si elles sont destinées à des consommateurs externes, ou (B) les marquer `@internal` dans leur JSDoc et les laisser non-exportées si elles sont réservées à usage interne. Ne pas laisser le statut ambigu.

**Priorité** : P2 (API intent non clair)

---

### P2-008 — `extractTextBlocks` traite les pages séquentiellement au lieu de paralleliser

**Problème** : Dans `src/parse/text-extractor.ts:461-660`, la boucle principale de `extractTextBlocks()` est :
```ts
for (const pgNum of pagesToProcess) {
  const page = await pdfDoc.getPage(pgNum);
  // ... traitement séquentiel
}
```
Pour un PDF de 100 pages, les pages sont traitées une par une. `extractImages()` a le même pattern (ligne 554). En revanche, `parseDocument()` dans parser.ts utilise correctement `Promise.all` pour paralléliser les pages.

**Impact performance** : Sur un PDF de 100 pages, `extractTextBlocks()` peut prendre 10× plus de temps que si les pages étaient traitées en parallèle. C'est un hot path côté Fabric.js editor.

**Correction** : Refactoriser `extractTextBlocks()` pour extraire le traitement d'une page en `processPage(pdfDoc, pgNum)` et exécuter `await Promise.all(pagesToProcess.map(processPage))`. Attention : le second pass d'alignement (détection de paragraphes) opère sur `allBlocks` — il devra être exécuté après le `Promise.all`. Même pattern pour `extractImages()`.

**Priorité** : P2 (performance critique sur hot path)

---

### P3-009 — `image-extractor.ts` — duplication de la boucle d'opérateurs (698 lignes, 2 boucles identiques)

**Problème** : `src/parse/image-extractor.ts` (700 lignes) contient deux fonctions publiques (`extractImageElements` et `extractImages`) qui partagent une boucle d'opérateurs quasi-identique (gestion CTM, sauvegarde/restauration, setGState, paintImageXObject). La logique est copiée-collée entre les lignes 307-447 et 590-680.

Tout bug dans la gestion des matrices (ex. erreur de multiplyMatrices) doit être corrigé aux deux endroits.

**Correction** : Extraire une interface interne :
```ts
interface ImageHit {
  ctm: number[];
  resourceName: string;
  opacity: number;
}
```
Et une fonction `scanOperatorsForImages(ops, pageHeight): ImageHit[]` qui parcourt les opérateurs une seule fois. Les deux fonctions publiques appellent `scanOperatorsForImages` puis font leur logique propre (résolution objet, dataUrl pour extractImages vs dataUrl via URL pour extractImageElements).

**Priorité** : P3 (DRY, fichier > 500 LOC)

---

### P3-010 — `as any` dans `preview/renderer.ts:146` — seul `as any` dans src/ (hors tests)

**Problème** : `(page.objs as any).get(imageName)` dans `extractImage()` est le seul `as any` restant dans les fichiers source du package (hors tests). Il bypass le typage de pdfjs. Voir P2-004 pour le risque de détachement ArrayBuffer associé.

**Localisation** : `src/preview/renderer.ts:146`.

**Correction** : Définir une interface locale `PdfjsPageObjs` avec la signature `get(name: string): Promise<PdfjsImageData | null>` (pdfjs retourne une Promise sur `.get()` pour les objets asynchrones). Remplacer `as any` par ce type. Traité conjointement avec P2-004.

**Priorité** : P3 (type safety, faible risque isolé)

---

### P3-011 — `PDFDocumentHandle._pdfDoc` exposé publiquement dans l'interface

**Problème** : `src/engine/document-handle.ts:17` :
```ts
export interface PDFDocumentHandle {
  readonly _pdfDoc: PDFDocument;
}
```
Le préfixe `_` signale une propriété privée par convention, mais l'exposer dans l'interface publique permet à tout consommateur externe d'accéder directement aux internals de pdf-lib et de bypasser la logique `markDirty`. Actuellement les renderers l'utilisent par nécessité (imports internes), mais si le package est consommé par un tiers, la tentation d'utiliser `handle._pdfDoc` directement est forte.

**Correction** : Séparer l'interface publique de l'interface interne :
```ts
// Interface publique (export depuis index.ts)
export interface PDFDocumentHandle {
  readonly id: string;
  readonly pageCount: number;
  readonly isDirty: boolean;
  readonly wasEncrypted: boolean;
}

// Interface interne (uniquement dans engine/)
export interface PDFDocumentHandleInternal extends PDFDocumentHandle {
  readonly _pdfDoc: PDFDocument;
}
```
Les renderers importent `PDFDocumentHandleInternal`, les consommateurs extérieurs voient `PDFDocumentHandle`.

**Priorité** : P3 (encapsulation API publique)

---

### P3-012 — `form-extractor.ts` — 2 extracteurs dans le même fichier avec types incompatibles

**Problème** : `src/parse/form-extractor.ts` contient deux extracteurs avec des types de retour différents :
1. `extractFormFields()` (ligne 186) — retourne `FormField[]` (type local riche, défini dans le même fichier)
2. `extractFormFieldElements()` (ligne 421) — retourne `FormFieldElement[]` (type depuis `@giga-pdf/types`)

Ces deux extracteurs utilisent des types de champ distincts (`FormFieldType` vs `FieldType`), des méthodes différentes (pdf-lib vs pdfjs-dist), et des schémas de coordonnées différents. Leur cohabitation dans le même fichier crée une confusion sur lequel utiliser.

**Test failing** : `extractFormFieldElements > finds exactly 4 form fields on page 1` — retourne 6 au lieu de 4. Le fixture `with-forms.pdf` a été généré avec 4 champs mais le legacy extractor compte également les widgets de radio buttons individuellement (cf. `widgetsToProcess` dans extractFormFields). Le test attend le comportement pdfjs-based (4 annotations Widget), mais obtient 6 — ce qui indique que le fixture lui-même a 6 annotations Widget (2 champs avec plusieurs widgets chacun). **La correction du test est de mettre à jour l'assertion à `6` ou de recréer le fixture.**

**Correction** : Séparer en deux fichiers :
- `src/parse/form-extractor-legacy.ts` — `extractFormFieldElements()` (pdfjs-based, `@giga-pdf/types`)
- `src/parse/form-extractor.ts` — `extractFormFields()` (pdf-lib based, `FormField` local)

**Priorité** : P3 (séparation des responsabilités)

---

### P3-013 — Test `form-extractor.test.ts` : assertion hardcodée sur le nombre de champs (4 vs réalité 6)

**Problème** : Le test `finds exactly 4 form fields on page 1` échoue car l'extractor retourne 6 éléments. L'investigation montre que `with-forms.pdf` contient 4 champs AcroForm mais chaque radio button ou champ multi-widget génère plusieurs annotations Widget. Le test suppose 4 annotations = 4 champs, ce qui est incorrect pour les PDFs avec radio buttons ou multi-widgets.

**Fix** : Deux options :
- A) Changer l'assertion à `toHaveLength(6)` si le fixture `with-forms.pdf` est fiable et le comportement attendu est "une entrée par widget".
- B) Recréer le fixture avec un PDF qui a exactement 4 champs simples (text, textarea, checkbox, dropdown) sans radio groups pour que `4` soit correct.

Option B est préférée — elle rend le test précis et prévisible.

**Priorité** : P3 (3 tests RED dans pdf-engine, corrigeables en < 30 min)

---

### P3-014 — `openDocument` avec Buffer : risque de détachement ArrayBuffer partagé

**Problème** : `src/engine/document-handle.ts:50` :
```ts
data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
```
`source` est un `Buffer`. `Buffer.buffer` retourne l'ArrayBuffer sous-jacent qui peut être partagé (Node.js pooled buffers). Si le buffer source est réutilisé ou GC après l'appel, pdf-lib qui tient une référence à `data` peut voir un ArrayBuffer invalide.

Même pattern dans `preview/renderer.ts:27`.

**Correction** : Copier de façon défensive : `data = new Uint8Array(source)` (copie le contenu, crée un nouveau ArrayBuffer). Le coût CPU est marginal pour des documents < 100 MB, la sécurité mémoire est garantie. Alternativement : `data = Uint8Array.from(source)`.

**Priorité** : P3 (risque théorique mais documenté, pattern cohérent à corriger)

---

### P3-015 — `text-extractor.ts` exporte `TextBlock` et `extractTextBlocks` sans les exposer via le barrel

**Problème** : `src/parse/text-extractor.ts` exporte deux symboles en plus de `extractTextElements` :
- `TextBlock` (interface, ligne 28)
- `extractTextBlocks` (fonction, ligne 438)

Ni l'un ni l'autre n'est réexporté dans `src/parse/index.ts` (qui n'exporte que `extractTextElements` via parser.ts). Le type `TextBlock` est donc inaccessible aux consommateurs du package — impossible de typer le retour d'`extractTextBlocks` sans import par chemin relatif.

**Correction** : Ajouter dans `src/parse/index.ts` (ou `src/index.ts`) :
```ts
export type { TextBlock } from './text-extractor';
export { extractTextBlocks } from './text-extractor';
```
Conditionnel sur la décision P2-007 (exposer publiquement ou documenter comme interne).

**Priorité** : P3 (cohérence API)

---

## Observations transverses

### Type safety — bilan

- **`as any`** dans les sources : 1 occurrence (`preview/renderer.ts:146`). Toutes les autres occurrences citées dans le rapport Phase 1 sont dans d'autres packages (canvas, mobile, editor). Le package pdf-engine est donc propre sur ce point sauf ce cas.
- **`as unknown as`** dans les sources : 4 occurrences, toutes dans `form-extractor.ts`, toutes justifiées par l'accès aux internals non-typés de pdf-lib. Documentées par des commentaires explicites. Acceptable mais extractibles dans des types locaux (P2-005).
- **`as number[]`** et autres casts primitifs** : utilisés raisonnablement pour les APIs pdfjs dont les types sont `unknown[]` ou `number[] | undefined`. Pattern cohérent, non problématique.

### Memory management — bilan

- Le pattern `new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)` est utilisé à 3 endroits (document-handle.ts, parser.ts:toUint8Array, renderer.ts:loadDocument). Ce pattern est correct si le Buffer n'est pas un buffer poolé Node.js. En pratique, les Buffers créés par `readFile` ou `Buffer.from(bytes)` ont leur propre ArrayBuffer — risque faible. Le risque réel est dans `extractImage()` avec `Buffer.from(data.buffer, ...)` sur les données imgData de pdfjs (P2-004).
- Pas d'autres `new Uint8Array(buffer.buffer, ...)` sur des données pdfjs internes — le risque RT-11 est isolé à `renderer.ts:158`.

### Async patterns — bilan

- **Loops séquentielles** : `extractTextBlocks` et `extractImages` standalone utilisent des boucles `for...of` avec `await` séquentiels pour les pages. C'est le principal problème de performance pour des PDFs multi-pages (P2-008).
- **parseDocument** : correctement parallélisé via `Promise.all` pour les pages et les extracteurs.
- **Pas d'`await` inutile dans les fonctions sync** : toutes les fonctions `async` contiennent effectivement des `await`. Pas de faux-async.

### Tests failants — résumé et actions

| Test | Fichier | Statut | Action |
|------|---------|--------|--------|
| `addText — police non-standard sans originalFont` | text-renderer-original-font.test.ts | RED | Fix RT-02 dans text-renderer.ts + corriger spy (process.stderr vs console) |
| `addText — originalFont propagation` | text-renderer-original-font.test.ts | RED | Idem RT-02 |
| `updateText — originalFont propagation` | text-renderer-original-font.test.ts | RED | Idem RT-02 |
| `finds exactly 4 form fields on page 1` | form-extractor.test.ts | RED | Recréer fixture with-forms.pdf avec 4 champs simples |
| `every field has unique elementIds` | form-extractor.test.ts | RED | Conséquence du test précédent (6 champs dont 2 partagent même stableUUID car même fieldName:pageNumber) |
| `parser > with-forms.pdf finds 4 form field elements on page 1` | parser.test.ts | RED | Idem fixture |

Les 3 tests `use-document-save`, `use-embedded-fonts`, `gigapdf-editor` sont hors scope pdf-engine.

### Architecture — bilan

- `parse/parser.ts` est bien architecturé (pipeline safeExtract + timeout, séparation buildPageObject vs buildPageObjectSafe). La duplication buildPageObject/buildPageObjectSafe est la seule entorse DRY significative.
- `engine/document-handle.ts` a une bonne séparation (handle vs pdfDoc), mais l'exposition de `_pdfDoc` dans l'interface publique est un défaut d'encapsulation (P3-011).
- `render/flatten.ts` est un stub à clarifier (P1-003).
- `parse/form-extractor.ts` mélange deux niveaux d'abstraction incompatibles dans le même fichier (P3-012).
- Pas de duplication entre `parse/text-extractor.ts` et `parse/parser.ts` — ils ont des rôles distincts (extractor de bas niveau vs orchestrateur de haut niveau).
